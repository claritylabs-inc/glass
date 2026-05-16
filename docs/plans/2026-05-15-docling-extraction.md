# Docling Two-Stage Extraction Plan

Glass now supports a staged Docling parsing path for policy PDFs. The implementation keeps `@claritylabs/cl-sdk` as the schema mapper while replacing enabled PDF vision inputs with markdown parsed by the Railway `docling-service`.

- Service root: `docling-service/`
- Convex flags: global `DOCLING_ENABLED`, overridden by `organizations.featureFlags.docling`
- Convex client: `convex/lib/docling.ts`
- Callback interception: `convex/lib/sdkCallbacks.ts`
- Parser audit metadata: optional fields on `policyFiles`

Rollout remains opt-in per organization until production smoke tests show equal-or-better extraction quality and healthy Railway runtime metrics.
