# WorkOS Auth Migration — Design

**Status:** Approved, pending implementation plan
**Date:** 2026-04-20
**Scope:** Replace `@convex-dev/auth` with WorkOS AuthKit; restructure signup to self-serve join-by-domain; keep org/membership data in Convex.

---

## 1. Goals & non-goals

### Goals
- Replace `@convex-dev/auth` with WorkOS AuthKit as the identity provider.
- Enable MFA (user-opt-in TOTP), social logins (Google, Microsoft), passkeys, and email+password at launch.
- Keep the door open for enterprise SSO (SAML/OIDC) and SCIM directory sync without re-architecting.
- Offload compliance-relevant identity surface (password storage, MFA, audit log) to WorkOS.
- Replace the current "self-serve solo org" signup with self-serve join-by-domain, approval-gated by default.
- Silently migrate existing users — no blast email, no forced re-auth ceremony.

### Non-goals
- Moving org / membership / invite data to WorkOS Organizations. Convex remains the source of truth for tenancy and authorization.
- DNS-based domain verification. Deferred; first-verified-email wins.
- SSO / SAML / SCIM. Deferred; the design must not preclude them.
- Changing the org data model (policies, coverages, intelligence, etc.).
- Role model changes beyond today's `admin` / `member`.

---

## 2. End-state architecture

```
┌──────────────────────┐
│  Next.js app         │
│  /login  /signup     │──── AuthKit embedded React components
│  /auth/callback      │◀─── WorkOS redirects with code
└──────────┬───────────┘
           │ exchanges code → session cookie + JWT
           ▼
┌──────────────────────┐
│  WorkOS              │  Source of truth for:
│  (identity)          │  • email, name, image
│                      │  • auth method, verified status
│                      │  • MFA factors, passkeys
│                      │  • password hash (if used)
│                      │  • audit log
└──────────┬───────────┘
           │ JWT (sub = workos user id) verified via JWKS
           ▼
┌──────────────────────┐
│  Convex              │  Source of truth for:
│  ctx.auth            │  • users (profile mirror)
│                      │  • organizations
│                      │  • orgMemberships
│                      │  • orgInvitations
│                      │  • everything else
└──────────────────────┘
```

### Identity contract
WorkOS issues a session JWT after authentication. Convex's `auth.config.ts` is configured with WorkOS as the custom-JWT provider (`issuer: "https://api.workos.com"`, `applicationID: WORKOS_CLIENT_ID`, JWKS URL). `ctx.auth.getUserIdentity()` returns a minimal identity: `subject` (= `workosUserId`), `issuer`, `org_id`, `sid`, `role`, and a few other operational claims. **Profile fields (email, name, image) are NOT in the JWT** — they must be fetched from the WorkOS API server-to-server.

### First-touch pattern
On login the client calls a Convex **action** `ensureCurrentUser`, which:

1. Reads `subject` from `ctx.auth.getUserIdentity()`.
2. Fetches the authoritative user profile from WorkOS (`GET /user_management/users/{sub}`).
3. Calls an internal mutation that upserts the `users` row, runs the onboarding router (see §4), and returns `{ userId, orgId, onboardingComplete, membershipStatus }`.

Every subsequent authenticated Convex call uses `requireUser(ctx)` in `convex/lib/auth.ts`, which reads `workosUserId` from the JWT, looks up the existing `users` row, and returns the resolved state. `requireUser` throws if no row exists (meaning bootstrap hasn't run yet) — the client is responsible for running `ensureCurrentUser` on sign-in before any other call. `requireUser` replaces both `getAuthUserId(ctx)` and `requireAuth(ctx)` from today's `convex/lib/auth.ts`. `requireOrgAccess(ctx)` and `requireOrgAdmin(ctx)` in `convex/lib/orgAuth.ts` stay, now layered on top of `requireUser`.

### Session lifetime
WorkOS manages session cookies (httpOnly, SameSite=Lax, short access + refresh token). Logout hits the WorkOS logout endpoint, which revokes the refresh token and clears cookies.

### Environments
Two WorkOS tenants: **non-prod** (shared dev + staging) and **production**. Separate client IDs, JWKS URLs, and BYO Google / Microsoft OAuth clients per tenant. Convex envs mirror. No cross-environment token reuse.

---

## 3. Schema changes

### `users` table — after migration

```ts
users: defineTable({
  // WorkOS-mirrored, refreshed every login
  workosUserId: v.string(),
  email: v.string(),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  // Prism-owned
  title: v.optional(v.string()),
  onboardingComplete: v.optional(v.boolean()),
})
  .index("by_workosUserId", ["workosUserId"])
  .index("email", ["email"]),
```

**Removed fields:** `emailVerificationTime`, `phone`, `phoneVerificationTime`, `isAnonymous`, `isAdmin`, `agentHandle`, `companyName`, `insuranceBroker`, `companyWebsite`, `companyContext`, `brokerContactName`, `brokerContactEmail`, `coiHandling`, `industry`, `industryVertical`.

**Removed indexes:** `by_agentHandle`, `phone`.

### `organizations` table — additions

```ts
// existing field, kept
agentHandle: v.optional(v.string()),

// new
primaryDomain: v.optional(v.string()),      // e.g. "acme.com"; set at org creation from the first admin's email domain
domainJoinPolicy: v.union(                  // defaults to "approval"
  v.literal("auto"),
  v.literal("approval"),
  v.literal("off"),
),
```

**New index:** `by_primaryDomain` on `primaryDomain`.

### `orgMemberships` table — additions

```ts
status: v.union(
  v.literal("active"),
  v.literal("pending"),
),
```

All pre-existing rows backfilled to `"active"`. Application-level read filters exclude `"pending"` from anything that grants org-scoped data access.

### Deleted tables (from `authTables`)
`authSessions`, `authAccounts`, `authVerifiers`, `authVerificationCodes`, `authRateLimits`, `authRefreshTokens`. WorkOS owns session state.

### Deleted mutations + UI
- `convex/users.ts` → `resetAccount` removed.
- `components/settings/organization-section.tsx` → Danger Zone block removed.

---

## 4. Auth flow details

### Routes
| Route | Purpose |
|---|---|
| `/login` | Server route that calls `getSignInUrl()` and 302s to the WorkOS-hosted sign-in page. |
| `/signup` | Prism-owned email-gate page. Collects an email, rejects consumer domains client-side (blocklist: `gmail.com`, `googlemail.com`, `outlook.com`, `hotmail.com`, `yahoo.com`, `icloud.com`, `me.com`, `mac.com`, `aol.com`, `proton.me`, `protonmail.com`, `pm.me`, `live.com`, `msn.com`), then redirects to `getSignUpUrl({ loginHint: email })` on submit. |
| `/auth/callback` | Handled by `@workos-inc/authkit-nextjs` `handleAuth()` route handler; exchanges the code for a session cookie, then redirects to `/auth/bootstrap`. |
| `/auth/bootstrap` | Client page that calls the `ensureCurrentUser` Convex **action**; action fetches profile from WorkOS API and runs the resolver; page redirects to `/onboarding` or `/` based on result. |
| `/logout` | Calls `getSignOutUrl()` and redirects; WorkOS clears cookies and bounces back to `/login`. |

**AuthKit is used in hosted mode** (WorkOS-hosted sign-in / sign-up pages), not embedded — the 2026 `@workos-inc/authkit-nextjs` SDK does not ship embedded React components. Branding (logo, colors, custom auth domain) is configured via the WorkOS dashboard. Proxy file is `proxy.ts` with `authkitProxy()` (Next.js 16), not `middleware.ts`.

### Post-auth resolver
Runs inside the `ensureCurrentUser` Convex **action** on the first Convex call after a fresh login for a new `workosUserId`. WorkOS session JWTs carry only `sub`, not email or name, so the action:

1. Reads `subject` (= `workosUserId`) from `ctx.auth.getUserIdentity()` — JWT-verified.
2. Makes a server-side HTTP call to WorkOS: `GET https://api.workos.com/user_management/users/{sub}` using `WORKOS_API_KEY`. Returns canonical `email`, `firstName`, `lastName`, `profilePictureUrl`.
3. Calls an internal mutation `_ensureCurrentUserCore` with the verified profile, which runs the resolver below.

Trusting the WorkOS API response (server-to-server) rather than client-supplied args closes the silent-migration account-takeover vector.

```
1. Internal mutation receives { workosUserId, email, name, image } from the action.
2. users row exists for this workosUserId?
   YES → refresh email/name/image, return userId.
   NO  → continue.
3. users row exists with matching email (case-insensitive) and no workosUserId?
   YES → silent migration: attach workosUserId, refresh fields, return.
   NO  → new user, continue.
4. Resolve org placement. Invite always wins over domain policy.
   a. Pending orgInvitations match email?
      → accept invite, create orgMemberships(status="active"),
        mark invite consumed. onboardingComplete=true.
   b. organizations.primaryDomain matches email domain?
      → branch on domainJoinPolicy:
          "auto"     → orgMemberships(status="active"); onboardingComplete=true.
          "approval" → orgMemberships(status="pending"); onboardingComplete=true.
          "off"      → fall through to (c).
   c. No match → create new organizations row,
      primaryDomain = email domain,
      domainJoinPolicy = "approval",
      user is admin. onboardingComplete=false (goes to onboarding).
5. Return { userId, orgId, onboardingComplete, membershipStatus }.
```

All email and domain comparisons in the resolver are performed lowercased. `users.email`, `orgInvitations.email`, and `organizations.primaryDomain` are stored lowercased at write time.

### Pending-membership UX
Pending users are fully authenticated and inside the app shell. The app is **not** hidden from them — they understand they have an account; they just can't see org data yet.

| Area | Behavior |
|---|---|
| Profile / account settings (own user) | Accessible |
| `/policies`, individual policy pages | Blocked — route renders "Pending approval to join {Org}" state |
| `/chat` and any chat functionality | Blocked |
| Intelligence, emails, dreams | Blocked |
| Members / org settings | Blocked (no members list either) |

Blocking style: Convex queries for pending users return empty or a permission error; route components render an in-context "pending" state rather than redirecting to a dedicated holding page.

### Admin approval UI
The existing team/members area in `components/settings/organization-section.tsx` grows a "Pending requests" section above the active members list. Each row has Approve / Deny buttons.
- **Approve:** flips `orgMemberships.status` to `"active"`.
- **Deny:** deletes the `orgMemberships` row. The user can re-request by signing in again if the domain policy still points to this org.

The first user of a new org is admin automatically, so they can approve subsequent joiners without Prism intervention.

### Invite vs domain precedence
Invites always win. If a pending `orgInvitations` row exists for a user's email, they join that org as `"active"` even if their email domain matches a different org with `"approval"` policy.

### Stale `@convex-dev/auth` sessions at cutover
`authSessions` is dropped in the schema migration; Convex stops recognizing old cookies. First unauthenticated request → redirect to `/login`. User re-auths via WorkOS, the resolver's step 3 silently migrates them onto their existing `users` row. No banner, no email.

### Logout
`/logout` calls the WorkOS logout endpoint, which revokes the refresh token and clears cookies, then redirects to `/login`.

---

## 5. Migration mechanics

Two production users, no duplicate emails. Silent migration is trivial.

- Schema migration is a single Convex deployment that adds new fields, backfills both existing orgs (`primaryDomain` from admin email; `domainJoinPolicy = "approval"`; memberships `"active"`), drops legacy fields and `authTables` in the same pass.
- Cutover for the 2 users: next time they hit the app, they land on `/login`, sign in via WorkOS (most likely Google), and step 3 of the resolver attaches `workosUserId` to their existing `users` row.
- If anything goes weird, a manual edit of 2 rows in the Convex dashboard is faster than any automated rollback we'd write.
- No audit script, no multi-phase backfill, no rollback plan beyond "redeploy the previous Convex artifact."

### BYO Google OAuth client
Configure WorkOS with the same Google Cloud project already used for the Gmail connect flow (or a sibling project under the same brand). Both consent screens then render with Prism branding. Google's incremental-consent flow recognizes the same user account across sign-in and Gmail-connect, so users see "add these additional permissions" rather than "sign in again."

---

## 6. Rollout plan

Five PRs, sequenced aggressively since there are effectively no production users.

### PR 1 — WorkOS tenant setup (no code change)
- Create non-prod + prod WorkOS tenants.
- Configure BYO Google + Microsoft OAuth clients.
- Enable email+password, passkeys, optional TOTP in both tenants.
- Populate Convex env vars: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_JWKS_URL`, `NEXT_PUBLIC_WORKOS_CLIENT_ID`.
- **Verification:** WorkOS dashboard shows the clients; no app code deployed.

### PR 2 — Schema + Convex helpers
- Schema migration per §3.
- `convex/auth.config.ts` configured against WorkOS JWKS.
- New `requireUser(ctx)` implementing §4 post-auth resolver.
- `convex/lib/orgAuth.ts` re-layered on `requireUser`.
- All existing Convex functions migrated off `getAuthUserId` → `requireUser`.
- Remove `convex/auth.ts` (the `@convex-dev/auth` config), remove `authTables` spread, remove `resetAccount`.
- **Verification:** Convex preview deploy against non-prod succeeds; unit tests for `requireUser` cover each resolver branch.

### PR 3 — Frontend auth surfaces
- `/login`, `/signup`, `/auth/callback`, `/logout` routes using AuthKit embedded components.
- `components/providers.tsx`: `ConvexAuthProvider` → WorkOS provider.
- `components/auth-guard.tsx` rewritten against WorkOS session state.
- Remove `@convex-dev/auth` packages from `package.json`.
- **Verification:** non-prod cutover. Both production users invited to exercise each login method.

### PR 4 — Domain-join + pending-membership features
- "Pending requests" list in `components/settings/organization-section.tsx` with approve/deny.
- `domainJoinPolicy` selector in org settings (admin-only).
- Query-layer guards: pending members get empty results from policy / chat / email / intelligence queries; route components render in-context pending state.
- Consumer-domain blocklist enforced in the signup form.
- **Verification:** manual QA of all four resolver branches (invite / domain-auto / domain-approval / no-match-new-org) plus pending-user access restrictions.

### PR 5 — Cleanup
- Remove any stray `isAdmin` references, legacy user fields from TypeScript types, Danger Zone UI.
- All `users.agentHandle` readers moved to `organizations.agentHandle`.
- **Verification:** `rg` for deleted symbols returns zero hits, typecheck clean.

### Worktree & subagent orchestration
- One worktree branch: `feat/workos-auth`.
- PRs 1–3 are sequential (each depends on the prior).
- PR 4 can split into two parallel subagent tasks (pending-membership query guards vs. settings UI) — they share no files of substance.
- PR 5 is cleanup, runs last.
- Coordinator uses Opus; implementation subagents use Sonnet (per repo convention).

---

## 7. Deferred / future (explicit out of scope)

The design leaves room for these without requiring architectural changes when they land:

- **DNS-based domain verification** (via WorkOS domain verification API). Unlocks SSO enforcement, reduces squatter risk.
- **Enterprise SSO / SAML / OIDC** through WorkOS. Hosted/embedded AuthKit supports this with no app-code change once the domain is verified.
- **SCIM directory sync.** Would add a WorkOS webhook handler that maps SCIM events to `orgMemberships`. Out of scope here.
- **Consumer-domain invite-only mode.** Currently we block personal email domains at signup. Later we can soften to "consumer domain users must have an invite" — a one-line change in the post-auth resolver.
- **Platform-admin concept.** Removed with `isAdmin` + `resetAccount`. If it returns, implement as an env-driven allowlist or a separate `platformAdmins` table keyed by `workosUserId`.
- **Approval notifications.** Pending-membership notifies org admins via in-app badge only in v1. Email / Slack notifications deferred.
