# WorkOS Integration Cheatsheet (captured 2026-04-20)

> **Heads-up**: `@workos-inc/authkit-nextjs` **v3.x** is the current major. It does **not** ship React UI components — there is no `<SignIn />`/`<SignUp />` in this package. Embedded/hosted UI is rendered by WorkOS AuthKit (hosted page) via redirect URLs produced by `getSignInUrl()` / `getSignUpUrl()`. If we want embedded React components, that's a separate package (`@workos-inc/authkit-react`, v0.16.x) and it does **not** expose prop-level `<SignIn />`/`<SignUp />` components either — only hook methods. **Any plan step that assumes an embedded `<SignIn />` JSX component needs to be revisited.**

## Next.js SDK

- **Package**: `@workos-inc/authkit-nextjs`
- **Current version**: `3.0.1` (published 2026-04-20)
- **Next.js compat**: supports both Next 16+ (`proxy.ts` + `authkitProxy()`) and Next ≤15 (`middleware.ts` + `authkitMiddleware()`). Prism is on Next 16 → use `proxy.ts`.
- **v3 breaking notes**: PKCE is always on (env `WORKOS_ENABLE_PKCE` removed). Stricter CSRF: both cookie + state parameter are validated on callback.

### Provider (Client)

```ts
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";

// app/layout.tsx
<AuthKitProvider>{children}</AuthKitProvider>
```

No required props; reads config from env at runtime.

### Client-side session hook

```ts
import { useAuth } from "@workos-inc/authkit-nextjs/components";

const { user, loading, organizationId, refreshAuth } = useAuth();
// Or: useAuth({ ensureSignedIn: true })
```

Return shape:
```ts
{
  user: User | null,
  loading: boolean,
  organizationId?: string,
  refreshAuth: (options?) => Promise<{ error?: string }>
}
```

Also available from `/components`:
- `useAccessToken()` — returns a managed access token with auto-refresh.
- `Impersonation` — visual banner component shown when an admin is impersonating a user.

### User object fields (authkit-nextjs)

Confirmed from docs: `firstName`, `email`. Additional fields follow the WorkOS User API (see below); camelCase is used on the JS SDK surface. **Not specified in fetched docs**: whether `lastName`, `profilePictureUrl`, `emailVerified` are populated on the `useAuth` user — verify empirically.

### Embedded `<SignIn />` / `<SignUp />` components

**`@workos-inc/authkit-nextjs` does not export these components.** Authentication UI is the WorkOS-hosted AuthKit page reached via redirect. The supported flow:

```ts
import { getSignInUrl, getSignUpUrl } from "@workos-inc/authkit-nextjs";

// app/login/route.ts
export const GET = async () => redirect(await getSignInUrl());
```

`getSignInUrl` / `getSignUpUrl` accept options including `loginHint`, `state`, `organizationId`, `invitationToken`, `screenHint` (names confirmed from `@workos-inc/authkit-react` which uses identical option names; verify on Next package). **There is no documented prop to intercept email entry in AuthKit's hosted UI.** Consumer-domain blocking must therefore happen either:
1. Pre-redirect (our own email-entry screen that validates, then passes `loginHint` to `getSignInUrl`), or
2. Post-callback (in `handleAuth` callback / Convex function, reject and `signOut` users with disallowed email domains).

If an embedded (non-hosted) experience is mandatory, switch to `@workos-inc/authkit-react` (SPA-style) — but that package also does not expose `<SignIn>`/`<SignUp>` JSX components, only `useAuth()` with `signIn()`/`signUp()` methods. **No email-validation prop exists in either package as of this capture.**

### Server-side session helpers

```ts
import {
  withAuth,
  signOut,
  getSignInUrl,
  getSignUpUrl,
  handleAuth,
  authkit,           // low-level composable
  authkitProxy,      // Next 16+
  authkitMiddleware, // Next <=15
  getWorkOS,         // direct @workos-inc/node client
  saveSession,
  validateApiKey,
} from "@workos-inc/authkit-nextjs";

const { user } = await withAuth();                     // nullable
const { user } = await withAuth({ ensureSignedIn: true }); // redirects if unsigned
```

### Callback route

Path must match `NEXT_PUBLIC_WORKOS_REDIRECT_URI`. Conventional location:

```ts
// app/callback/route.ts
import { handleAuth } from "@workos-inc/authkit-nextjs";
export const GET = handleAuth();
```

### Proxy / Middleware

**Next 16+ (Prism)** — create `proxy.ts` in project root:

```ts
import { authkitProxy } from "@workos-inc/authkit-nextjs";
export default authkitProxy();
export const config = { matcher: ["/", "/((?!api|_next/static|_next/image|favicon.ico).*)"] };
```

Options (same for `authkitMiddleware`):
```ts
authkitProxy({
  middlewareAuth: { enabled: true, unauthenticatedPaths: ["/", "/login"] },
  debug: false,
});
```

For lower-level control:
```ts
const { session, headers, authorizationUrl } = await authkit(request);
```

### Sign-in / sign-up URL helpers

```ts
import { getSignInUrl, getSignUpUrl } from "@workos-inc/authkit-nextjs";
const url = await getSignInUrl({ loginHint: "user@example.com" });
```

### Sign-out

```ts
import { signOut } from "@workos-inc/authkit-nextjs";
await signOut(); // clears session cookie and redirects through WorkOS logout
```

`signOut()` returns a redirect; WorkOS constructs the logout URL internally (no separate `getSignOutUrl` helper documented in root exports).

## Convex JWT verification

Convex's custom JWT provider config — `convex/auth.config.ts`:

```ts
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: process.env.WORKOS_CLIENT_ID, // matches JWT `aud` claim
      issuer: "https://api.workos.com",
      jwks: "https://api.workos.com/sso/jwks/<WORKOS_CLIENT_ID>",
      algorithm: "RS256",
    },
  ],
};
```

- `type`: must be literal `"customJwt"`.
- `applicationID`: matches the access token's `aud` claim. Optional but recommended.
- `issuer`: **literal string** `"https://api.workos.com"` — does **not** include the client id or environment. This is constant across all WorkOS projects.
- `jwks`: JWKS URL. WorkOS exposes JWKS at `https://api.workos.com/sso/jwks/{client_id}` (verify by fetching `getJwksUrl()` from `@workos-inc/node` at runtime if unsure). **Exact path not specified in the fetched AuthKit docs** — confirm against `@workos-inc/node`'s `WorkOS#userManagement.getJwksUrl()` or the JWKS URL printed by AuthKit on first sign-in.
- `algorithm`: `RS256` (WorkOS default) or `ES256`.

### Claims WorkOS issues in session/access tokens

Confirmed claim names (from WorkOS session-tokens reference):

Standard: `iss`, `sub`, `aud` (via `client_id`), `client_id`, `org_id`, `sid`, `jti`, `exp`, `iat`

Additional: `act` (actor, contains nested `sub` for impersonation), `role`, `roles`, `permissions`, `entitlements`, `feature_flags`

**Notable absence**: The session-tokens reference page does **not** list `email`, `given_name`, `family_name`, `name`, or `picture`. WorkOS access tokens are OAuth-style, not OIDC id_tokens. **Do not plan to read user profile from the JWT.** Fetch profile fields from the User Management API (via `getWorkOS()` in an action) or via `withAuth()` on the Next.js side and sync to Convex.

### `ctx.auth.getUserIdentity()` mapping

Convex exposes top-level fields: `subject`, `issuer`, `tokenIdentifier`. Nested JWT fields are flattened into dotted keys (e.g. `properties.id` → `identity["properties.id"]`).

Expected mapping for WorkOS:
- `sub` → `identity.subject` (WorkOS user id, format `user_…`)
- `iss` → `identity.issuer` (`"https://api.workos.com"`)
- `org_id` → `identity["org_id"]`
- `sid` → `identity["sid"]`
- `role` / `roles` / `permissions` → same dotted keys

`identity.email` / `.givenName` / etc. will be **undefined** because those claims aren't issued. Source user profile elsewhere.

## Environment variables

Required:
- `WORKOS_API_KEY` — server-only
- `WORKOS_CLIENT_ID` — server-only (also referenced by Convex `applicationID`; if needed client-side, also mirror as `NEXT_PUBLIC_WORKOS_CLIENT_ID`)
- `WORKOS_COOKIE_PASSWORD` — server-only; **≥32 characters**, high entropy (`openssl rand -base64 32`)
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI` — **NEXT_PUBLIC_** (needed in edge/client); must exactly match a redirect URI configured in the WorkOS dashboard. e.g. `http://localhost:3000/callback` / `https://app.prism.example/callback`.

Optional:
- `WORKOS_COOKIE_MAX_AGE` (default `34560000` sec = 400 days)
- `WORKOS_COOKIE_DOMAIN`
- `WORKOS_COOKIE_NAME` (default `"wos-session"`)
- `WORKOS_COOKIE_SAMESITE` (default `"lax"`)
- `WORKOS_API_HOSTNAME` (default `"api.workos.com"`)
- `WORKOS_API_HTTPS` (default `true`)
- `WORKOS_API_PORT`

All WORKOS_* are server-only unless prefixed `NEXT_PUBLIC_`.

## Embedded signup/signin method configuration

**Auth methods (Google, Microsoft, password, passkey, TOTP/MFA) are configured exclusively in the WorkOS Dashboard** — per environment under AuthKit settings. There are **no** component props or env vars in `@workos-inc/authkit-nextjs` that enable/disable methods. The only code-side configuration we own is:

1. Redirect URI (dashboard ↔ `NEXT_PUBLIC_WORKOS_REDIRECT_URI`).
2. Optional `loginHint`, `organizationId`, `invitationToken`, `screenHint`, `state` on `getSignInUrl` / `getSignUpUrl`.
3. Cookie/session options via `authkitProxy({...})`.

Consumer-domain email blocking is **not** a built-in AuthKit feature; must be implemented in our own UI or in `handleAuth`/Convex.

## Gotchas / notable defaults

- **Default session cookie max-age = 400 days.** That is effectively "never expires" from a UX standpoint. Tighten if needed via `WORKOS_COOKIE_MAX_AGE`.
- **Default cookie name** `wos-session`, **SameSite** `lax`. Fine for first-party; not suitable for cross-site iframes.
- **`iss` is the literal string `https://api.workos.com`** — do not templatize with client id. Mismatched `issuer` in Convex config is a silent 401.
- **Access tokens contain no profile claims.** Expect `email`/`name` to be absent in Convex `getUserIdentity()`; sync user records through a Convex mutation called from the Next.js server after `withAuth()`.
- **PKCE is always on in v3**. Nothing to configure, but don't set `WORKOS_ENABLE_PKCE`.
- **Next 16 uses `proxy.ts` not `middleware.ts`.** Using `authkitMiddleware()` on Next 16 still works but `authkitProxy()` is the future-proof path.
- **No embedded `<SignIn />` / `<SignUp />` JSX components** in either `@workos-inc/authkit-nextjs` or `@workos-inc/authkit-react`. Plans that depend on these need to reroute through hosted AuthKit or rebuild the pre-redirect email collection screen ourselves.
- **JWKS URL path** (`/sso/jwks/{client_id}`) is inferred and not fully pinned by the fetched docs; verify via SDK helper before shipping Convex config.
- `@workos-inc/node` npm listing returned 403 during capture — **current version not pinned here**; install latest and confirm it exports a `WorkOS` class with `userManagement` sub-API.

## Cited URLs

- https://workos.com/docs/user-management (landing — sparse)
- https://workos.com/docs/user-management/nextjs
- https://workos.com/docs/user-management/authkit/react (landing — sparse)
- https://workos.com/docs/reference/user-management (sparse; linked to subpages)
- https://workos.com/docs/reference/authkit/session-tokens
- https://workos.com/docs/reference/authkit/user
- https://docs.convex.dev/auth/advanced/custom-jwt
- https://www.npmjs.com/package/@workos-inc/authkit-nextjs (v3.0.1, 2026-04-20)
- https://github.com/workos/authkit-nextjs (README)
- https://github.com/workos/authkit-react (README — v0.16.1)
- https://www.npmjs.com/package/@workos-inc/node (403 at capture)
