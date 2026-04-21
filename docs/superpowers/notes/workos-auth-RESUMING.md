# Resuming the WorkOS auth migration

**Paused:** 2026-04-20
**Branch:** `feat/workos-auth` (pushed to origin)
**Worktree (local):** `.worktrees/workos-auth/`
**Reason for pause:** More pressing priorities; revisit later.

## TL;DR

All code for the WorkOS auth migration is written, committed, and pushed. Typecheck and `next build` are both clean. A senior code review was run and every blocker it flagged was fixed. **What remains is ops + live smoke testing, not code.**

Do NOT merge the branch until the ops steps below are done — the app on `feat/workos-auth` cannot sign anyone in without a real WorkOS tenant configured.

## Reference documents (in this repo)

- Design spec: `docs/superpowers/specs/2026-04-20-workos-auth-migration-design.md`
- Implementation plan: `docs/superpowers/plans/2026-04-20-workos-auth-migration.md`
- WorkOS SDK cheatsheet (captured 2026-04-20 from live docs): `docs/superpowers/notes/workos-integration-cheatsheet.md`

The spec and plan reflect two mid-build corrections:
1. **Hosted AuthKit**, not embedded — the 2026 `@workos-inc/authkit-nextjs` SDK no longer ships `<SignIn />`/`<SignUp />` components.
2. **`ensureCurrentUser` is a Convex action, not a mutation** — it fetches the authoritative email from the WorkOS API server-to-server (JWT carries only `sub`), closing a silent-migration account-takeover vector.

If either of those changes again before you resume, re-run the cheatsheet research (`docs/superpowers/notes/workos-integration-cheatsheet.md`) against live docs first.

## What was built

- Schema: `workosUserId` on users (indexed), `primaryDomain` + `domainJoinPolicy` on organizations, `status` on orgMemberships. `authTables` + legacy user fields removed.
- `convex/users.ts`: `ensureCurrentUser` action + `_ensureCurrentUserCore` internal mutation (post-auth resolver: invite → domain policy → solo org).
- `convex/lib/auth.ts`: `requireUser(ctx)`.
- `convex/lib/orgAuth.ts`: `requireOrgAccess` blocks pending members.
- `convex/auth.config.ts`: Convex verifies WorkOS JWTs via JWKS.
- Frontend: `/login` (redirects to hosted AuthKit), `/signup` (Prism-owned email gate + consumer-domain blocklist), `/signup/submit`, `/auth/callback`, `/auth/bootstrap`, `/logout`, rewritten `auth-guard`.
- `proxy.ts` at repo root (Next 16 replaces middleware.ts).
- `<PendingApprovalState />` wrapping policies, agent/thread, applications routes. Pending-users are logged in and can reach profile/account settings but not org-scoped data.
- Admin approve/deny pending requests + domain-join policy selector in org settings.
- `@convex-dev/auth` uninstalled.

## What remains (in order)

### 1. Provision WorkOS tenants (ops — no code)
See plan Task 1.1. Create non-prod and prod WorkOS tenants, enable Google, Microsoft, email+password, passkeys, TOTP. Use BYO Google OAuth client (same Google Cloud project used for Gmail connect, to keep branding consistent). Set these env vars:

**Convex (each environment):**
- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`
- `WORKOS_JWKS_URL` (e.g. `https://api.workos.com/sso/jwks/<client-id>`)

**Vercel (each environment):**
- `WORKOS_API_KEY`
- `WORKOS_CLIENT_ID`
- `WORKOS_COOKIE_PASSWORD` (32+ chars, secret)
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI` (e.g. `https://<host>/auth/callback`)

### 2. Deploy + backfill (non-prod first)
Checkout the worktree, then:

```bash
cd .worktrees/workos-auth
npx convex deploy                                          # deploys schema changes
npx convex run internal/backfillWorkosMigration:run        # normalizes emails + sets org domain/policy/status
```

Verify in the Convex dashboard that both existing orgs have `primaryDomain` set and `domainJoinPolicy = "approval"`, and all `orgMemberships` rows have `status = "active"`.

### 3. Non-prod smoke test (plan Task 3.6)
Using a fresh browser session against the non-prod deploy, exercise every path:

- [ ] Sign in with Google → lands on existing org (silent migration for one of the 2 production users)
- [ ] Sign in with Microsoft
- [ ] Sign up with email + password on a work domain → new solo org + onboarding
- [ ] Sign up with `@gmail.com` → blocked with "Please use your work email"
- [ ] Invite flow: admin creates invite → invited user signs up → lands in invited org as active
- [ ] Domain-approval: admin policy = "approval"; new user same domain → lands pending; admin sees pending request; approve → access unlocks
- [ ] Domain-auto: admin policy = "auto"; new user same domain → lands active
- [ ] Domain-off: admin policy = "off"; new user same domain → new solo org
- [ ] Pending-state UI: `/policies`, `/agent`, `/applications` all render `<PendingApprovalState />` for pending users
- [ ] Logout: redirects to WorkOS logout → back to `/login`

### 4. Production cutover
Only after non-prod matrix is green. Notify the 2 production users that they'll re-authenticate via Google/Microsoft on their next visit (silent migration).

### 5. Open the PR + merge
`gh pr create` against `main` with the summary + test plan from plan Task 5.4.

## Known gotchas for whoever resumes

- The consumer-domain block is enforced at Prism's `/signup/submit` route, not at WorkOS. A determined user could go directly to `getSignUpUrl` with a gmail.com address and authenticate — in that case `_ensureCurrentUserCore` falls through the domain branch (consumer domains are skipped by design) and creates a new solo org. This matches the spec's "allow gmail users a solo org" intent. If you want to harden this into invite-only for consumer domains later, the change is a one-line addition in `_ensureCurrentUserCore` step 4c.
- `proxy.ts` excludes `/api/auth/google/*` from WorkOS auth — critical so the existing Gmail-connect OAuth flow is not intercepted.
- `viewerOrg` intentionally does NOT call `requireOrgAccess` — pending users must be able to read their own membership row to render the pending-approval screen. There's an inline comment explaining this.
- `_ensureCurrentUserCore` is an internal mutation (cannot be called from the client). Only `ensureCurrentUser` (the action) invokes it. Do not expose it publicly.
- `seedUsers` creates rows with `workosUserId: "seed_<email>"` — these can't authenticate, they're dev-only fixtures.

## If the code needs re-verification before merge

Reasonable pre-merge checks:

```bash
cd .worktrees/workos-auth
npx tsc --noEmit
npm run build
rg "@convex-dev/auth|getAuthUserId|authTables" --type ts   # should show only backup comment blocks
git log --oneline 863ad6b..HEAD                            # 26 commits
```

## Contacts / decisions to revisit

- Spec §1 goals and non-goals are authoritative. If any of them has changed (e.g., enterprise SSO is suddenly urgent), revisit the design before merging.
- Personal-email policy was explicitly "A (block) for now, C (invite-only) later." Reconfirm which policy you want at merge time.
- Domain verification is deferred. When SSO/SCIM show up, come back and add DNS-based verification (plan §7).
