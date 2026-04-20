// convex/auth.config.ts
// Configures Convex to verify WorkOS-issued JWTs via JWKS.
// See docs/superpowers/notes/workos-integration-cheatsheet.md — "Convex JWT verification".
export default {
  providers: [
    {
      type: "customJwt",
      applicationID: process.env.WORKOS_CLIENT_ID, // matches JWT `aud` claim
      issuer: "https://api.workos.com",
      jwks: `https://api.workos.com/sso/jwks/${process.env.WORKOS_CLIENT_ID}`,
      algorithm: "RS256",
    },
  ],
};
