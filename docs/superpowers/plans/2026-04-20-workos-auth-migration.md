# WorkOS Auth Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@convex-dev/auth` with WorkOS AuthKit as Prism's identity provider, restructure signup to self-serve join-by-domain with approval-gated membership, and keep org/tenancy data in Convex.

**Architecture:** WorkOS is the identity provider; Convex verifies WorkOS-issued JWTs via JWKS and remains the source of truth for `users`, `organizations`, `orgMemberships`, and `orgInvitations`. A single Convex helper (`requireUser`) mirrors WorkOS identity into `users` on every authenticated call and resolves org placement on first sight (invite → domain policy → new solo org).

**Tech Stack:** Next.js App Router (client + server routes), Convex (schema + functions), WorkOS AuthKit (embedded React components) + WorkOS Node SDK server-side, TypeScript throughout.

**Design spec:** `docs/superpowers/specs/2026-04-20-workos-auth-migration-design.md` — read before starting.

**Scope note:** Only 2 real production users exist, with no email duplicates. Silent migration is trivial (one row per user), and there is no multi-phase backfill. Manual dashboard edits are the supported rollback mechanism.

---

## Prerequisites (do before Task 1)

1. Read the design spec in full: `docs/superpowers/specs/2026-04-20-workos-auth-migration-design.md`.
2. Confirm the worktree is `.worktrees/workos-auth` and you are on branch `feat/workos-auth`.
3. Confirm `npm install` succeeded and the app type-checks (`npm run typecheck` or `npx tsc --noEmit`).
4. Read `AGENTS.md` at repo root for project conventions.

---

## Task 0: Capture the current WorkOS + Convex integration surface

This migration depends on the WorkOS AuthKit React SDK and the WorkOS Node SDK. Method names and patterns change over time. Before writing any integration code, capture the current API surface into a cheatsheet so the rest of the plan can reference concrete names.

**Files:**
- Create: `docs/superpowers/notes/workos-integration-cheatsheet.md`

- [ ] **Step 1: Fetch current WorkOS AuthKit (Next.js) docs**

Visit and read:
- https://workos.com/docs/user-management
- https://workos.com/docs/user-management/nextjs
- https://workos.com/docs/user-management/authkit/react
- https://workos.com/docs/reference/user-management
- https://docs.convex.dev/auth/custom-jwt (Convex custom-JWT auth integration)

- [ ] **Step 2: Record the API surface in a cheatsheet**

Produce `docs/superpowers/notes/workos-integration-cheatsheet.md` with these sections populated from the docs (not from memory):

```markdown
# WorkOS Integration Cheatsheet (captured YYYY-MM-DD)

## Next.js SDK
- Package name + version used
- Provider component import + props
- Hook for client-side session access
- Import(s) for <SignIn /> / <SignUp /> embedded components
- Import(s) for server-side session helpers (getSession, withAuth, etc.)
- Callback route handler pattern

## Convex JWT verification
- auth.config.ts shape for WorkOS (issuer domain, JWKS URL, applicationID)
- Shape of the JWT claims we can rely on: sub, email, email_verified, given_name, family_name, picture, etc.

## Environment variables
- Client IDs (public vs secret)
- API key
- Redirect URI config
- Cookie password / session encryption env var

## Logout
- Server-side logout URL pattern or helper

## Embedded signup/signin options
- How method set (google, microsoft, password, passkey, TOTP) is configured
  (WorkOS dashboard vs. component props)
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/workos-integration-cheatsheet.md
git commit -m "docs: capture WorkOS integration cheatsheet for migration"
```

**Why this task:** every downstream task that references "call `authkitMiddleware(...)`" or "read `auth.user.id` from the provider" needs a single source of truth that was verified against current docs. Don't skip.

---

# PR 1 — WorkOS tenant setup (no code change)

This is operations work, tracked here as a checklist. Nothing in this PR lands code; it unblocks PR 2.

## Task 1.1: Provision WorkOS tenants and OAuth clients

- [ ] **Step 1:** Create two WorkOS organizations in the WorkOS dashboard: `Prism (non-prod)` and `Prism (production)`.
- [ ] **Step 2:** In each tenant, enable User Management → Authentication Methods: Google OAuth, Microsoft OAuth, Email + Password, Passkeys, TOTP MFA (user-opt-in).
- [ ] **Step 3:** Under each tenant's Google OAuth configuration, select "Bring your own Google OAuth client" and reuse the Google Cloud project already used for Gmail connect (see `components/settings/email-connections-section.tsx` for existing client reference). Same treatment for Microsoft.
- [ ] **Step 4:** In each tenant, set the redirect URI to the non-prod app URL + `/auth/callback` and the prod app URL + `/auth/callback` respectively.
- [ ] **Step 5:** Record the following env vars into the Convex env for each environment (use `npx convex env set`):
  - `WORKOS_API_KEY` (secret — server-side)
  - `WORKOS_CLIENT_ID` (public)
  - `WORKOS_JWKS_URL` (public — typically `https://api.workos.com/sso/jwks/<clientId>`)
  - `WORKOS_COOKIE_PASSWORD` (secret — 32+ chars, used for session cookie encryption)
- [ ] **Step 6:** In Vercel/Next env, add:
  - `NEXT_PUBLIC_WORKOS_CLIENT_ID`
  - `WORKOS_API_KEY` (server-only)
  - `WORKOS_COOKIE_PASSWORD` (server-only)
  - `WORKOS_REDIRECT_URI` (server-only)
- [ ] **Step 7:** Verify by loading the WorkOS dashboard → Authentication Methods shows the four methods enabled in both tenants.

No commit — these are infrastructure changes, no code.

---

# PR 2 — Schema + Convex helpers

## Task 2.1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install WorkOS SDKs**

Run (package names must match the cheatsheet from Task 0):

```bash
npm install @workos-inc/authkit-nextjs @workos-inc/node
```

- [ ] **Step 2: Verify install**

```bash
npm ls @workos-inc/authkit-nextjs @workos-inc/node
```

Expected: both packages listed without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install WorkOS SDKs for auth migration"
```

## Task 2.2: Add new schema fields (additive migration)

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add `workosUserId` + index to `users`; add new fields to `organizations` and `orgMemberships`**

Edit `convex/schema.ts`. Keep all existing fields on `users`; add `workosUserId` as optional for now (required after backfill). Add the `email` field already exists — leave it alone. Add the `by_workosUserId` index.

```ts
users: defineTable({
  // Existing auth-managed fields — leave in place for now; dropped in Task 2.8.
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  image: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  // Prism profile
  title: v.optional(v.string()),
  // Legacy company fields (removed in Task 2.8)
  companyName: v.optional(v.string()),
  insuranceBroker: v.optional(v.string()),
  companyWebsite: v.optional(v.string()),
  companyContext: v.optional(v.string()),
  brokerContactName: v.optional(v.string()),
  brokerContactEmail: v.optional(v.string()),
  coiHandling: v.optional(v.union(v.literal("broker"), v.literal("user"), v.literal("ignore"))),
  industry: v.optional(v.string()),
  industryVertical: v.optional(v.string()),
  onboardingComplete: v.optional(v.boolean()),
  isAdmin: v.optional(v.boolean()),
  agentHandle: v.optional(v.string()),
  // NEW
  workosUserId: v.optional(v.string()),
})
  .index("email", ["email"])
  .index("phone", ["phone"])
  .index("by_agentHandle", ["agentHandle"])
  .index("by_workosUserId", ["workosUserId"]),
```

On `organizations`, add:

```ts
primaryDomain: v.optional(v.string()),
domainJoinPolicy: v.optional(
  v.union(v.literal("auto"), v.literal("approval"), v.literal("off"))
),
```

Add index `.index("by_primaryDomain", ["primaryDomain"])`.

On `orgMemberships`, add:

```ts
status: v.optional(
  v.union(v.literal("active"), v.literal("pending"))
),
```

Do NOT remove `authTables` spread or any legacy field yet — that happens in Task 2.8 after everything depends on the new fields.

- [ ] **Step 2: Deploy to non-prod**

```bash
npx convex dev --once
```

Expected: schema deploy succeeds. No backfill ran yet; existing rows have all new fields undefined.

- [ ] **Step 3: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(schema): add workosUserId, primaryDomain, domainJoinPolicy, membership status"
```

## Task 2.3: Write the schema backfill (internal mutation)

**Files:**
- Create: `convex/internal/backfillWorkosMigration.ts`

- [ ] **Step 1: Write the internal mutation**

```ts
// convex/internal/backfillWorkosMigration.ts
import { internalMutation } from "../_generated/server";

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    // 1) Lowercase normalize users.email; coerce undefined to nothing (leave as-is).
    const users = await ctx.db.query("users").collect();
    for (const u of users) {
      if (u.email && u.email !== u.email.toLowerCase()) {
        await ctx.db.patch(u._id, { email: u.email.toLowerCase() });
      }
    }

    // 2) Backfill orgMemberships.status = "active".
    const memberships = await ctx.db.query("orgMemberships").collect();
    for (const m of memberships) {
      if (!m.status) {
        await ctx.db.patch(m._id, { status: "active" });
      }
    }

    // 3) For each org, set primaryDomain from the admin's email domain;
    //    set domainJoinPolicy = "approval".
    const orgs = await ctx.db.query("organizations").collect();
    for (const org of orgs) {
      const patch: Record<string, unknown> = {};
      if (!org.domainJoinPolicy) patch.domainJoinPolicy = "approval";
      if (!org.primaryDomain) {
        const adminMembership = await ctx.db
          .query("orgMemberships")
          .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
          .filter((q) => q.eq(q.field("role"), "admin"))
          .first();
        if (adminMembership) {
          const admin = await ctx.db.get(adminMembership.userId);
          const email = admin?.email?.toLowerCase();
          if (email?.includes("@")) {
            patch.primaryDomain = email.split("@")[1];
          }
        }
      }
      // 4) Move agentHandle from the admin's user row to the org, if not already set.
      if (!org.agentHandle) {
        const adminMembership = await ctx.db
          .query("orgMemberships")
          .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
          .filter((q) => q.eq(q.field("role"), "admin"))
          .first();
        if (adminMembership) {
          const admin = await ctx.db.get(adminMembership.userId);
          if (admin?.agentHandle) {
            patch.agentHandle = admin.agentHandle;
          }
        }
      }
      if (Object.keys(patch).length) {
        await ctx.db.patch(org._id, patch);
      }
    }
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add convex/internal/backfillWorkosMigration.ts
git commit -m "feat(migration): add backfill for WorkOS migration fields"
```

## Task 2.4: Run the backfill (non-prod)

- [ ] **Step 1: Deploy and run**

```bash
npx convex dev --once
npx convex run internal/backfillWorkosMigration:run
```

- [ ] **Step 2: Verify via dashboard**

Open the Convex dashboard → `organizations` — confirm both orgs have `primaryDomain` set and `domainJoinPolicy = "approval"`.

Open `orgMemberships` — confirm every row has `status: "active"`.

Open `users` — confirm emails are lowercased.

No commit — migration already committed.

## Task 2.5: Write `requireUser` helper — tests first

**Files:**
- Create: `convex/lib/__tests__/auth.test.ts` (if repo lacks convex-test, skip to Step 3 — note in the PR description that tests are deferred to integration QA in PR 4)
- Create: `convex/lib/auth.ts` (replaces existing file — back up contents first)

- [ ] **Step 1: Check for existing test harness**

```bash
ls convex/__tests__ 2>/dev/null; rg "convex-test" package.json
```

If `convex-test` is present, write the test first. If not, note this in the final PR description and write the helper directly (Step 3) — integration coverage happens in PR 4 QA.

- [ ] **Step 2 (if convex-test present): Write the failing test**

Tests exercise the internal mutation `_ensureCurrentUserCore` directly — it takes the verified profile as explicit args, which is exactly how the action will call it. No JWT mocking needed for the resolver logic.

```ts
// convex/lib/__tests__/auth.test.ts
import { convexTest } from "convex-test";
import { expect, test, describe } from "vitest";
import schema from "../../schema";
import { internal } from "../../_generated/api";

const VERIFIED_PROFILE = {
  workosUserId: "user_01ABC",
  email: "alice@acme.com",
  name: "Alice Example",
  image: undefined,
};

describe("ensureCurrentUserCore resolver", () => {
  test("creates new user and solo org when no invite + no domain match", async () => {
    const t = convexTest(schema);
    const result = await t.mutation(internal.users._ensureCurrentUserCore, VERIFIED_PROFILE);
    expect(result.onboardingComplete).toBe(false);
    expect(result.membershipStatus).toBe("active");
  });

  test("silent migration: matches existing users.email → attaches workosUserId", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "alice@acme.com" });
      const orgId = await ctx.db.insert("organizations", { name: "Acme", primaryDomain: "acme.com", domainJoinPolicy: "approval" });
      await ctx.db.insert("orgMemberships", { orgId, userId, role: "admin", status: "active" });
    });
    const result = await t.mutation(internal.users._ensureCurrentUserCore, VERIFIED_PROFILE);
    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);
    expect(users[0].workosUserId).toBe("user_01ABC");
    expect(result.membershipStatus).toBe("active");
  });

  test("invite beats domain policy", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("organizations", { name: "Acme A", primaryDomain: "acme.com", domainJoinPolicy: "approval" });
    });
    const invitedOrgId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { name: "Acme B", primaryDomain: "other.com", domainJoinPolicy: "approval" });
      await ctx.db.insert("orgInvitations", {
        orgId,
        email: "alice@acme.com",
        role: "member",
        expires_at: Date.now() + 1000 * 60 * 60 * 24,
      });
      return orgId;
    });
    const result = await t.mutation(internal.users._ensureCurrentUserCore, VERIFIED_PROFILE);
    expect(result.orgId).toBe(invitedOrgId);
    expect(result.membershipStatus).toBe("active");
  });

  test("domain policy approval → pending membership", async () => {
    const t = convexTest(schema);
    const orgId = await t.run(async (ctx) => {
      const o = await ctx.db.insert("organizations", { name: "Acme", primaryDomain: "acme.com", domainJoinPolicy: "approval" });
      const u = await ctx.db.insert("users", { email: "other@acme.com", workosUserId: "existing_admin" });
      await ctx.db.insert("orgMemberships", { orgId: o, userId: u, role: "admin", status: "active" });
      return o;
    });
    const result = await t.mutation(internal.users._ensureCurrentUserCore, VERIFIED_PROFILE);
    expect(result.orgId).toBe(orgId);
    expect(result.membershipStatus).toBe("pending");
  });

  test("domain policy auto → active membership", async () => {
    const t = convexTest(schema);
    const orgId = await t.run(async (ctx) => {
      const o = await ctx.db.insert("organizations", { name: "Acme", primaryDomain: "acme.com", domainJoinPolicy: "auto" });
      const u = await ctx.db.insert("users", { email: "other@acme.com", workosUserId: "existing_admin" });
      await ctx.db.insert("orgMemberships", { orgId: o, userId: u, role: "admin", status: "active" });
      return o;
    });
    const result = await t.mutation(internal.users._ensureCurrentUserCore, VERIFIED_PROFILE);
    expect(result.orgId).toBe(orgId);
    expect(result.membershipStatus).toBe("active");
  });

  test("domain policy off → new solo org", async () => {
    const t = convexTest(schema);
    const existingOrgId = await t.run(async (ctx) => {
      return await ctx.db.insert("organizations", { name: "Acme", primaryDomain: "acme.com", domainJoinPolicy: "off" });
    });
    const result = await t.mutation(internal.users._ensureCurrentUserCore, VERIFIED_PROFILE);
    expect(result.orgId).not.toBe(existingOrgId);
    expect(result.membershipStatus).toBe("active");
  });
});
```

- [ ] **Step 3: Write `requireUser` + `ensureCurrentUser` mutation**

Back up current `convex/lib/auth.ts` contents (copy into a comment block at the top of the new file for reference), then replace with:

```ts
// convex/lib/auth.ts
import { MutationCtx, QueryCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export type ResolvedUser = {
  userId: Id<"users">;
  orgId: Id<"organizations"> | null;
  onboardingComplete: boolean;
  membershipStatus: "active" | "pending" | null;
};

/**
 * Read-path helper. Returns the current user's resolved state without mutating.
 * Use in queries. Throws if unauthenticated OR if the user row has not yet been
 * materialized (first-call-after-login must go through ensureCurrentUser).
 */
export async function requireUser(ctx: QueryCtx): Promise<ResolvedUser> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  const workosUserId = identity.subject;
  const user = await ctx.db
    .query("users")
    .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
    .first();
  if (!user) throw new Error("User not yet initialized — call ensureCurrentUser first");
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .first();
  return {
    userId: user._id,
    orgId: membership?.orgId ?? null,
    onboardingComplete: user.onboardingComplete ?? false,
    membershipStatus: membership?.status ?? null,
  };
}
```

- [ ] **Step 4: Add `_ensureCurrentUserCore` internal mutation and `ensureCurrentUser` action in `convex/users.ts`**

WorkOS session JWTs carry only `sub`, so the resolver lives in an internal mutation that takes the verified profile as args. A public action reads `sub` from `ctx.auth`, fetches the canonical profile server-to-server from the WorkOS API, then calls the internal mutation.

Append to `convex/users.ts`:

```ts
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { ResolvedUser } from "./lib/auth";

const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com",
  "yahoo.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);

export const _ensureCurrentUserCore = internalMutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, { workosUserId, email: rawEmail, name, image }): Promise<ResolvedUser> => {
    const email = rawEmail.toLowerCase();

    // 1. Look up by workosUserId.
    let user = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .first();

    if (user) {
      await ctx.db.patch(user._id, { email, name, image });
    } else {
      // 2. Silent migration — match by email (no workosUserId yet).
      const legacy = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .filter((q) => q.eq(q.field("workosUserId"), undefined))
        .first();
      if (legacy) {
        await ctx.db.patch(legacy._id, { workosUserId, email, name, image });
        user = await ctx.db.get(legacy._id);
      } else {
        // 3. Brand new user.
        const userId = await ctx.db.insert("users", {
          workosUserId,
          email,
          name,
          image,
          onboardingComplete: false,
        });
        user = await ctx.db.get(userId);
      }
    }

    if (!user) throw new Error("Failed to materialize user");

    // 4. Org placement — only if user has no membership yet.
    const existingMembership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    if (existingMembership) {
      return {
        userId: user._id,
        orgId: existingMembership.orgId,
        onboardingComplete: user.onboardingComplete ?? false,
        membershipStatus: existingMembership.status ?? "active",
      };
    }

    const domain = email.split("@")[1];

    // 4a. Invite match?
    const invite = await ctx.db
      .query("orgInvitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (invite) {
      await ctx.db.insert("orgMemberships", {
        orgId: invite.orgId,
        userId: user._id,
        role: invite.role,
        status: "active",
      });
      await ctx.db.delete(invite._id);
      await ctx.db.patch(user._id, { onboardingComplete: true });
      return {
        userId: user._id,
        orgId: invite.orgId,
        onboardingComplete: true,
        membershipStatus: "active",
      };
    }

    // 4b. Domain policy (skip consumer domains entirely).
    if (domain && !CONSUMER_DOMAINS.has(domain)) {
      const org = await ctx.db
        .query("organizations")
        .withIndex("by_primaryDomain", (q) => q.eq("primaryDomain", domain))
        .first();
      if (org && org.domainJoinPolicy !== "off") {
        const status = org.domainJoinPolicy === "auto" ? "active" : "pending";
        await ctx.db.insert("orgMemberships", {
          orgId: org._id,
          userId: user._id,
          role: "member",
          status,
        });
        await ctx.db.patch(user._id, { onboardingComplete: true });
        return {
          userId: user._id,
          orgId: org._id,
          onboardingComplete: true,
          membershipStatus: status,
        };
      }
    }

    // 4c. New solo org.
    const orgId = await ctx.db.insert("organizations", {
      name: (name || email.split("@")[0]) + "'s Organization",
      primaryDomain: domain,
      domainJoinPolicy: "approval",
    });
    await ctx.db.insert("orgMemberships", {
      orgId,
      userId: user._id,
      role: "admin",
      status: "active",
    });
    return {
      userId: user._id,
      orgId,
      onboardingComplete: false,
      membershipStatus: "active",
    };
  },
});

/**
 * Called by the client once per sign-in, on /auth/bootstrap. Fetches the
 * authoritative WorkOS profile server-to-server (not trusting any client
 * arg), then delegates to the internal resolver.
 */
export const ensureCurrentUser = action({
  args: {},
  handler: async (ctx): Promise<ResolvedUser> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const workosUserId = identity.subject;

    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) throw new Error("WORKOS_API_KEY not set");

    const res = await fetch(`https://api.workos.com/user_management/users/${encodeURIComponent(workosUserId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`WorkOS user fetch failed: ${res.status} ${await res.text()}`);
    }
    const user = (await res.json()) as {
      id: string;
      email: string;
      first_name?: string | null;
      last_name?: string | null;
      profile_picture_url?: string | null;
    };

    const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || undefined;
    const image = user.profile_picture_url ?? undefined;

    return await ctx.runMutation(internal.users._ensureCurrentUserCore, {
      workosUserId,
      email: user.email,
      name,
      image,
    });
  },
});
```

- [ ] **Step 5: Run tests (if harness present)**

```bash
npx vitest run convex/lib/__tests__/auth.test.ts
```

Expected: all six tests pass. If tests aren't available, manual QA in PR 4 covers this.

- [ ] **Step 6: Commit**

```bash
git add convex/lib/auth.ts convex/users.ts convex/lib/__tests__/auth.test.ts 2>/dev/null || true
git commit -m "feat(auth): add requireUser + ensureCurrentUser resolver for WorkOS"
```

## Task 2.6: Configure Convex to verify WorkOS JWTs

**Files:**
- Modify: `convex/auth.config.ts` (may not exist — create if missing; today's auth is wired via `convex/auth.ts` + `@convex-dev/auth`)

- [ ] **Step 1: Write `auth.config.ts`**

Use the exact shape recorded in the cheatsheet from Task 0. Expected form (verify against docs before writing):

```ts
// convex/auth.config.ts
export default {
  providers: [
    {
      domain: "https://api.workos.com",
      applicationID: process.env.WORKOS_CLIENT_ID!,
    },
  ],
};
```

- [ ] **Step 2: Set Convex env vars for the non-prod deployment**

```bash
npx convex env set WORKOS_CLIENT_ID <non-prod-client-id>
npx convex env set WORKOS_API_KEY <non-prod-api-key>
npx convex env set WORKOS_JWKS_URL https://api.workos.com/sso/jwks/<non-prod-client-id>
```

- [ ] **Step 3: Deploy**

```bash
npx convex dev --once
```

Expected: deploy succeeds.

- [ ] **Step 4: Commit**

```bash
git add convex/auth.config.ts
git commit -m "feat(auth): configure Convex to verify WorkOS JWTs"
```

## Task 2.7: Migrate all Convex callers from `getAuthUserId` to `requireUser`

**Files:**
- Modify: every Convex function that currently calls `getAuthUserId(ctx)` or `requireAuth(ctx)` (server-side auth helpers from `@convex-dev/auth`).

- [ ] **Step 1: Enumerate callers**

```bash
rg -l "getAuthUserId|from \"@convex-dev/auth/server\"|requireAuth" convex/
```

Record the full file list. Expect ~20–40 files.

- [ ] **Step 2: Migrate in batches of 5 files per commit**

For each caller:

**If it was a query:**

```ts
// before
import { getAuthUserId } from "@convex-dev/auth/server";
const userId = await getAuthUserId(ctx);
if (!userId) throw new Error("Not authenticated");

// after
import { requireUser } from "./lib/auth"; // path varies by location
const { userId } = await requireUser(ctx);
```

**If it was a mutation that runs on first touch after login** (e.g., an onboarding page calls it before any other mutation): have the client call `ensureCurrentUser` first (handled in PR 3), then this mutation can use `requireUser` normally.

**If it was `requireAuth(ctx)` from `convex/lib/auth.ts`:** replace with `requireUser(ctx)`.

- [ ] **Step 3: Deploy and smoke test after each batch**

```bash
npx convex dev --once
```

Expected: no schema errors; deploy succeeds.

- [ ] **Step 4: Commit each batch**

```bash
git add convex/
git commit -m "refactor(auth): migrate callers batch N from getAuthUserId to requireUser"
```

- [ ] **Step 5: After all batches, verify no stale callers**

```bash
rg "getAuthUserId|requireAuth" convex/ | grep -v "_generated"
```

Expected: zero matches (except inside the old `convex/lib/auth.ts` backup comment, which we delete next).

## Task 2.8: Drop legacy schema fields, `authTables`, and `resetAccount`

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/users.ts` (remove `resetAccount`)
- Delete: `convex/auth.ts` (the old `@convex-dev/auth` config)
- Modify: `components/settings/organization-section.tsx` (Danger Zone block)

- [ ] **Step 1: Drop the `resetAccount` mutation**

In `convex/users.ts`, delete the `resetAccount` export and any internal helpers only it uses. Verify no other caller references it:

```bash
rg "resetAccount" --type ts
```

Expected after delete: zero matches except in the Danger Zone UI, which we delete in Step 3.

- [ ] **Step 2: Delete `convex/auth.ts`**

```bash
git rm convex/auth.ts
```

- [ ] **Step 3: Remove Danger Zone UI**

Open `components/settings/organization-section.tsx`; find the `{viewer?.isAdmin && (` block around line 474 and delete that entire JSX subtree.

Also `rg "isAdmin" components/ app/` — any reference whose meaning was *platform admin* (the `viewer.isAdmin` field) is now dead; remove. References to `membership.role === "admin"` are **org-level admin** and stay.

- [ ] **Step 4: Update `convex/schema.ts`**

`users` final shape:

```ts
users: defineTable({
  workosUserId: v.string(),
  email: v.string(),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  title: v.optional(v.string()),
  onboardingComplete: v.optional(v.boolean()),
})
  .index("by_workosUserId", ["workosUserId"])
  .index("email", ["email"]),
```

Removed fields: `emailVerificationTime`, `phone`, `phoneVerificationTime`, `isAnonymous`, `isAdmin`, `agentHandle`, `companyName`, `insuranceBroker`, `companyWebsite`, `companyContext`, `brokerContactName`, `brokerContactEmail`, `coiHandling`, `industry`, `industryVertical`.

Remove indexes: `phone`, `by_agentHandle`.

Tighten: `workosUserId` and `email` become required (drop `v.optional`).

`organizations` — tighten new fields and drop `v.optional` on `domainJoinPolicy`:

```ts
primaryDomain: v.optional(v.string()),
domainJoinPolicy: v.union(
  v.literal("auto"),
  v.literal("approval"),
  v.literal("off"),
),
```

`orgMemberships` — tighten:

```ts
status: v.union(v.literal("active"), v.literal("pending")),
```

Remove from schema file: `...authTables,` spread at top; remove the `import { authTables } from "@convex-dev/auth/server"` import.

- [ ] **Step 5: Deploy**

```bash
npx convex dev --once
```

Expected: deploy succeeds. Convex will drop the `authTables` collections on the next deploy; schema tighten will refuse if any row violates (shouldn't, after backfill).

- [ ] **Step 6: Commit**

```bash
git add convex/
git add components/settings/organization-section.tsx
git commit -m "refactor(schema): remove legacy auth fields, authTables, resetAccount, Danger Zone"
```

---

# PR 3 — Frontend auth surfaces

## Task 3.1: Next.js proxy wiring

Prism runs Next.js 16.x, so the WorkOS integration uses `proxy.ts` + `authkitProxy()` — not `middleware.ts`. The `AuthKitProvider` from `@workos-inc/authkit-nextjs/components` goes in `providers.tsx`.

**Files:**
- Modify: `components/providers.tsx`
- Create: `proxy.ts` at the repo root

- [ ] **Step 1: Swap the auth provider**

Update `components/providers.tsx` to replace `ConvexAuthProvider` with `AuthKitProvider`:

```tsx
// components/providers.tsx
"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import type { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthKitProvider>
      <ConvexProvider client={convex}>{children}</ConvexProvider>
    </AuthKitProvider>
  );
}
```

- [ ] **Step 2: Create `proxy.ts`**

```ts
// proxy.ts  (Next.js 16)
import { authkitProxy } from "@workos-inc/authkit-nextjs";

export default authkitProxy({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ["/login", "/signup", "/auth/callback", "/logout"],
  },
});

export const config = { matcher: ["/((?!_next|favicon.ico|api/public).*)"] };
```

Verify `authkitProxy` is exported from the version installed (`npm view @workos-inc/authkit-nextjs exports`); if the name differs, consult the cheatsheet.

- [ ] **Step 3: Commit**

```bash
git add components/providers.tsx proxy.ts
git commit -m "feat(auth): wire WorkOS AuthKit provider and Next 16 proxy"
```

## Task 3.2: `/login` and `/signup` routes (hosted AuthKit flow)

`@workos-inc/authkit-nextjs` v3 does not export embedded `<SignIn />` / `<SignUp />` components. AuthKit uses hosted pages: the Next.js side builds a redirect URL via `getSignInUrl()` / `getSignUpUrl()` and 302s to WorkOS.

**Files:**
- Replace: `app/login/page.tsx` → `app/login/route.ts` (server route that redirects)
- Create: `app/signup/page.tsx` (Prism-owned email-gate with consumer-domain block)
- Create: `app/signup/submit/route.ts` (server route that validates + redirects to AuthKit)

- [ ] **Step 1: Delete the existing `app/login/page.tsx` and replace with a server redirect**

```ts
// app/login/route.ts
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export async function GET() {
  const url = await getSignInUrl();
  redirect(url);
}
```

- [ ] **Step 2: Create the Prism-owned signup gate**

Collects email, rejects consumer domains client-side, submits to a server route that validates server-side and redirects to WorkOS hosted signup.

```tsx
// app/signup/page.tsx
"use client";
import { useState, type FormEvent } from "react";
import { CONSUMER_DOMAINS } from "@/lib/auth/consumer-domains";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const domain = email.toLowerCase().split("@")[1];
    if (!domain || !email.includes("@")) {
      e.preventDefault();
      setError("Enter a valid email address.");
      return;
    }
    if (CONSUMER_DOMAINS.has(domain)) {
      e.preventDefault();
      setError(`Please use your work email. ${domain} isn't supported.`);
      return;
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-medium">Create your account</h1>
      <form action="/signup/submit" method="GET" onSubmit={onSubmit} className="w-full space-y-3">
        <input
          type="email"
          name="email"
          required
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          placeholder="you@yourcompany.com"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white">
          Continue
        </button>
      </form>
      <p className="text-xs text-muted-foreground">
        Already have an account? <a href="/login" className="underline">Sign in</a>
      </p>
    </main>
  );
}
```

And the shared constant:

```ts
// lib/auth/consumer-domains.ts
export const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com",
  "yahoo.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me",
  "live.com", "msn.com",
]);
```

- [ ] **Step 3: Server-side signup submit (second-layer domain check, then redirect to WorkOS)**

```ts
// app/signup/submit/route.ts
import { getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { CONSUMER_DOMAINS } from "@/lib/auth/consumer-domains";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email || !email.includes("@")) redirect("/signup?error=invalid");
  const domain = email.split("@")[1];
  if (CONSUMER_DOMAINS.has(domain)) redirect("/signup?error=consumer-domain");

  const url = await getSignUpUrl({ loginHint: email });
  redirect(url);
}
```

(Verify `getSignUpUrl` accepts `loginHint` in the installed SDK version; if the option name differs per the cheatsheet, adjust. If the SDK does not support prefill at all, drop the `loginHint` — WorkOS hosted signup will still ask for the email.)

- [ ] **Step 4: Commit**

```bash
git add app/login/route.ts app/signup/page.tsx app/signup/submit/route.ts lib/auth/consumer-domains.ts
git rm -f app/login/page.tsx
git commit -m "feat(auth): hosted AuthKit login + Prism-owned signup gate with consumer-domain block"
```

## Task 3.3: `/auth/callback` route and post-auth bootstrap

**Files:**
- Create: `app/auth/callback/route.ts` (server route)
- Create: `app/auth/bootstrap/page.tsx` (client page that calls `ensureCurrentUser`)

- [ ] **Step 1: Server callback route**

```ts
// app/auth/callback/route.ts
import { handleAuth } from "@workos-inc/authkit-nextjs";
export const GET = handleAuth({
  returnPathname: "/auth/bootstrap",
});
```

(Confirm `handleAuth` API and params from cheatsheet.)

- [ ] **Step 2: Client bootstrap page (calls the action, not a mutation)**

```tsx
// app/auth/bootstrap/page.tsx
"use client";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Bootstrap() {
  const ensure = useAction(api.users.ensureCurrentUser);
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const r = await ensure({});
      if (!r.onboardingComplete) router.replace("/onboarding");
      else router.replace("/");
    })();
  }, [ensure, router]);
  return <p className="p-8 text-sm text-muted-foreground">Setting up your account…</p>;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/auth/callback/route.ts app/auth/bootstrap/page.tsx
git commit -m "feat(auth): add callback + bootstrap to materialize user after WorkOS login"
```

## Task 3.4: `/logout` + rewrite `auth-guard`

**Files:**
- Create: `app/logout/route.ts`
- Modify: `components/auth-guard.tsx`

- [ ] **Step 1: Logout**

```ts
// app/logout/route.ts
import { getSignOutUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

export async function GET() {
  const url = await getSignOutUrl();
  redirect(url);
}
```

- [ ] **Step 2: Rewrite `components/auth-guard.tsx` against WorkOS**

The current guard uses `useConvexAuth()`. Swap to the WorkOS client hook from the cheatsheet. Keep the admin-path logic intact (that's org-admin, not platform-admin). Full rewrite:

```tsx
// components/auth-guard.tsx
"use client";
import { useAuth } from "@workos-inc/authkit-nextjs/components"; // confirm hook name
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

const PUBLIC_PATHS = ["/login", "/signup", "/auth/callback", "/auth/bootstrap", "/logout"];
const ADMIN_PATHS = ["/admin"];

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isOnboarding = pathname.startsWith("/onboarding");
  const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));

  const viewer = useQuery(api.users.getViewer, user ? {} : "skip");
  const viewerOrg = useQuery(api.orgs.getViewerOrg, user ? {} : "skip");

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) router.replace("/login");
    if (user && viewer && !viewer.onboardingComplete && !isOnboarding && !isPublic) {
      router.replace("/onboarding");
    }
    if (user && viewerOrg !== undefined && isAdminPath && (!viewerOrg || viewerOrg.membership.role !== "admin")) {
      router.replace("/");
    }
  }, [loading, user, isPublic, isOnboarding, isAdminPath, viewer, viewerOrg, router, pathname]);

  if (loading) return null;
  if (!user && !isPublic) return null;
  if (isAdminPath && viewerOrg && viewerOrg.membership.role !== "admin") return null;
  return <>{children}</>;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/logout/route.ts components/auth-guard.tsx
git commit -m "feat(auth): WorkOS logout + auth-guard rewrite"
```

## Task 3.5: Remove `@convex-dev/auth`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify no remaining imports**

```bash
rg "@convex-dev/auth" --type ts
```

Expected: zero matches.

- [ ] **Step 2: Uninstall**

```bash
npm uninstall @convex-dev/auth
```

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck
npm run build
```

Expected: clean typecheck, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove @convex-dev/auth"
```

## Task 3.6: Non-prod cutover smoke test

- [ ] **Step 1: Deploy non-prod**

```bash
npx convex deploy
vercel deploy  # or equivalent non-prod deployment command
```

- [ ] **Step 2: Exercise each login method**

With a fresh browser profile (no cookies):
- Sign in with Google → land on `/onboarding` (or `/` if existing user).
- Sign out. Sign in with Microsoft.
- Sign out. Sign up with email+password as a new user on a work domain — expect new solo org + onboarding.
- Sign up with a gmail.com email — expect the consumer-domain block to fire.
- Existing production user logs in with Google → their email matches an existing `users` row → silent migration attaches `workosUserId`; they land on their existing org.

Mark any failures as blockers; don't proceed to PR 4 until all six checks pass.

No commit — smoke test only.

---

# PR 4 — Domain-join + pending-membership features

## Task 4.1: Query-layer guards for pending members

**Files:** all Convex query/mutation files that today call `requireOrgAccess(ctx)` or otherwise scope data to an org.

- [ ] **Step 1: Tighten `requireOrgAccess`**

In `convex/lib/orgAuth.ts`, update `requireOrgAccess` so that when the membership `status === "pending"`, it throws "Membership pending approval" — i.e. pending members cannot access org data. `requireOrgAdmin` already implies active. Also expose a new `requireActiveMembership` alias if useful.

Reference shape:

```ts
export async function requireOrgAccess(ctx: QueryCtx | MutationCtx) {
  const { userId, orgId, membershipStatus } = await requireUser(ctx);
  if (!orgId) throw new Error("No org");
  if (membershipStatus !== "active") throw new Error("Membership pending approval");
  return { userId, orgId };
}
```

All existing callers become safe automatically — no per-file edit needed.

- [ ] **Step 2: Deploy + verify**

```bash
npx convex dev --once
```

- [ ] **Step 3: Commit**

```bash
git add convex/lib/orgAuth.ts
git commit -m "feat(auth): block pending memberships from org-scoped data access"
```

## Task 4.2: Pending-state UI in route pages

**Files:** any app route that today shows org-scoped data and will now need a "pending approval" in-context state. At minimum:
- `app/policies/page.tsx`
- `app/policies/[id]/page.tsx`
- `app/chat/...` (all chat routes)
- Any intelligence/emails routes

- [ ] **Step 1: Add a reusable `<PendingApprovalState />` component**

```tsx
// components/pending-approval-state.tsx
"use client";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export function PendingApprovalState() {
  const viewerOrg = useQuery(api.orgs.getViewerOrg, {});
  const orgName = viewerOrg?.org?.name ?? "your team";
  return (
    <div className="mx-auto max-w-md p-8 text-sm text-muted-foreground">
      <h2 className="mb-2 text-base font-medium text-foreground">Waiting for approval</h2>
      <p>
        You've requested to join <span className="font-medium">{orgName}</span>. An admin will review your request shortly. You'll gain access to policies, chat, and team data as soon as you're approved.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Add a hook that returns membership status to pages**

```ts
// hooks/use-membership-status.ts
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export function useMembershipStatus() {
  const org = useQuery(api.orgs.getViewerOrg, {});
  return org?.membership?.status ?? null;
}
```

- [ ] **Step 3: Wrap route pages**

For each route listed at the top of this task:

```tsx
const status = useMembershipStatus();
if (status === "pending") return <PendingApprovalState />;
// …normal rendering
```

- [ ] **Step 4: Commit**

```bash
git add components/pending-approval-state.tsx hooks/use-membership-status.ts app/
git commit -m "feat(ui): in-context pending-approval state across org-scoped routes"
```

## Task 4.3: Admin approve/deny in team settings

**Files:**
- Modify: `components/settings/organization-section.tsx` (or the members section — whichever file lists org members today)
- Modify: `convex/orgs.ts` (or wherever membership mutations live)

- [ ] **Step 1: Add Convex mutations**

```ts
// convex/orgs.ts — append
export const approveMembership = mutation({
  args: { membershipId: v.id("orgMemberships") },
  handler: async (ctx, { membershipId }) => {
    const { orgId } = await requireOrgAdmin(ctx);
    const m = await ctx.db.get(membershipId);
    if (!m || m.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(membershipId, { status: "active" });
  },
});

export const denyMembership = mutation({
  args: { membershipId: v.id("orgMemberships") },
  handler: async (ctx, { membershipId }) => {
    const { orgId } = await requireOrgAdmin(ctx);
    const m = await ctx.db.get(membershipId);
    if (!m || m.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(membershipId);
  },
});

export const listPendingMemberships = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await requireOrgAdmin(ctx);
    const pending = await ctx.db
      .query("orgMemberships")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    return Promise.all(pending.map(async (m) => {
      const user = await ctx.db.get(m.userId);
      return { membershipId: m._id, user };
    }));
  },
});
```

- [ ] **Step 2: Add Pending-requests UI block to the members section**

Above the existing members list:

```tsx
const pending = useQuery(api.orgs.listPendingMemberships, {});
const approve = useMutation(api.orgs.approveMembership);
const deny = useMutation(api.orgs.denyMembership);
// …
{pending && pending.length > 0 && (
  <section className="mb-6">
    <h3 className="mb-2 text-sm font-medium">Pending requests</h3>
    <ul className="divide-y rounded-md border">
      {pending.map((p) => (
        <li key={p.membershipId} className="flex items-center justify-between px-4 py-3">
          <div className="text-sm">
            <div>{p.user?.name ?? p.user?.email}</div>
            <div className="text-muted-foreground">{p.user?.email}</div>
          </div>
          <div className="flex gap-2">
            <button className="rounded-md border px-3 py-1 text-sm" onClick={() => approve({ membershipId: p.membershipId })}>Approve</button>
            <button className="rounded-md px-3 py-1 text-sm text-muted-foreground" onClick={() => deny({ membershipId: p.membershipId })}>Deny</button>
          </div>
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 3: Commit**

```bash
git add convex/orgs.ts components/settings/
git commit -m "feat(orgs): admin approve/deny for pending memberships"
```

## Task 4.4: `domainJoinPolicy` selector

**Files:**
- Modify: the existing org settings UI (likely `components/settings/organization-section.tsx`)
- Modify: `convex/orgs.ts` (add `setDomainJoinPolicy` mutation)

- [ ] **Step 1: Mutation**

```ts
// convex/orgs.ts — append
export const setDomainJoinPolicy = mutation({
  args: {
    policy: v.union(v.literal("auto"), v.literal("approval"), v.literal("off")),
  },
  handler: async (ctx, { policy }) => {
    const { orgId } = await requireOrgAdmin(ctx);
    await ctx.db.patch(orgId, { domainJoinPolicy: policy });
  },
});
```

- [ ] **Step 2: UI (admin-only section of org settings)**

```tsx
const viewerOrg = useQuery(api.orgs.getViewerOrg, {});
const setPolicy = useMutation(api.orgs.setDomainJoinPolicy);
const isAdmin = viewerOrg?.membership?.role === "admin";
// …
{isAdmin && viewerOrg?.org?.primaryDomain && (
  <div className="mb-4">
    <label className="mb-1 block text-sm font-medium">Domain join policy</label>
    <p className="mb-2 text-xs text-muted-foreground">
      Controls what happens when someone signs up with an {viewerOrg.org.primaryDomain} email.
    </p>
    <select
      className="rounded-md border px-2 py-1 text-sm"
      value={viewerOrg.org.domainJoinPolicy}
      onChange={(e) => setPolicy({ policy: e.target.value as "auto" | "approval" | "off" })}
    >
      <option value="approval">Require admin approval (default)</option>
      <option value="auto">Auto-join as member</option>
      <option value="off">Off — invite only</option>
    </select>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add convex/orgs.ts components/settings/
git commit -m "feat(orgs): admin-configurable domain join policy"
```

## Task 4.5: End-to-end QA

- [ ] **Step 1: Manual test matrix**

In non-prod, run through:

1. **Invite flow.** Admin creates `orgInvitations` for `guest@othercorp.com`. Guest signs up → lands on the invited org as active member.
2. **Domain-auto.** Admin sets policy to `"auto"`. New user at same domain signs up → lands active.
3. **Domain-approval.** Admin sets policy to `"approval"`. New user at same domain signs up → lands pending; admin sees them in Pending requests; admin approves → status flips to active, policies/chat become accessible.
4. **Domain-off.** Admin sets policy to `"off"`. New user at same domain signs up → gets a new solo org.
5. **Consumer domain.** Signup form shows "Please use your work email" for `gmail.com`.
6. **Silent migration.** Use a test account that matches an existing `users.email` with no `workosUserId`; after login, verify `workosUserId` is attached and they land on the existing org.
7. **Pending access blocked.** While pending, verify `/policies`, `/chat`, policy detail, etc. all show the `PendingApprovalState` and return empty data from Convex queries.

Record pass/fail for each in the PR description.

- [ ] **Step 2: Prod cutover**

Once non-prod matrix is green, deploy prod (`npx convex deploy` prod; `vercel --prod`). Notify the 2 production users that they'll be asked to sign in again via Google/Microsoft on their next visit.

No commit — deploy only.

---

# PR 5 — Cleanup

## Task 5.1: Move all `agentHandle` reads from `users` to `organizations`

**Files:** every caller.

- [ ] **Step 1: Find callers**

```bash
rg "\.agentHandle" --type ts
```

- [ ] **Step 2: Rewrite**

Each usage that reads from a user (e.g. `viewer.agentHandle`) becomes a read from the org (`viewerOrg.org.agentHandle`). If the call site doesn't already have the org loaded, add a `useQuery(api.orgs.getViewerOrg, {})` and read from there.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "refactor: move agentHandle readers from users to organizations"
```

## Task 5.2: Strip residual dead types and symbols

- [ ] **Step 1: Dead-symbol sweep**

```bash
rg "resetAccount|isAnonymous|emailVerificationTime|phoneVerificationTime|companyName|insuranceBroker|brokerContactName|brokerContactEmail|coiHandling|industryVertical" app/ components/ convex/ hooks/ lib/
```

Expected: zero matches. Remove any stragglers.

- [ ] **Step 2: TypeScript shapes**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: strip residual dead types and symbols from legacy auth"
```

## Task 5.3: Update AGENTS.md and CLAUDE.md references

**Files:**
- Modify: `AGENTS.md` (any mention of `@convex-dev/auth`, Email OTP, or `getAuthUserId`)

- [ ] **Step 1: Search**

```bash
rg "convex-dev/auth|getAuthUserId|Email OTP|ResendOTP" AGENTS.md CLAUDE.md
```

- [ ] **Step 2: Rewrite to reflect WorkOS**

Replace references with: WorkOS AuthKit, `requireUser`, `ensureCurrentUser` bootstrap, domain-join policy.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md CLAUDE.md
git commit -m "docs: update AGENTS.md for WorkOS auth"
```

## Task 5.4: Open the pull request

- [ ] **Step 1: Push and open PR against `main`**

```bash
git push -u origin feat/workos-auth
gh pr create --title "feat(auth): migrate identity to WorkOS AuthKit" --body "$(cat <<'EOF'
## Summary
- Replaces @convex-dev/auth with WorkOS AuthKit (embedded).
- Adds join-by-domain signup with admin-approval default.
- Silent migration for existing users on first post-cutover login.
- Drops legacy user fields, authTables, resetAccount, Danger Zone, isAdmin.

## Test plan
- [ ] Sign in with Google
- [ ] Sign in with Microsoft
- [ ] Sign up with email + password
- [ ] Sign up with consumer domain → blocked
- [ ] Invite flow lands user as active in invited org
- [ ] Domain-approval policy lands user as pending
- [ ] Admin approves pending user → access unlocks
- [ ] Silent migration for existing user
- [ ] Pending user cannot access policies/chat/email

Design spec: docs/superpowers/specs/2026-04-20-workos-auth-migration-design.md
Implementation plan: docs/superpowers/plans/2026-04-20-workos-auth-migration.md
EOF
)"
```

- [ ] **Step 2: Link PR URL in the conversation**
