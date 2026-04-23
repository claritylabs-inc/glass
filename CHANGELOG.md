# Changelog

## Unreleased

### Added
- cl-pipelines extraction pipeline for policies (`policyExtraction.ts`)
- cl-pipelines extraction pipeline for org documents (`orgDocumentExtraction.ts`)
- `pipelineFields()` on `policies`, `policyFiles`, `orgDocuments`, `emailConnections` schema tables
- Shared `ExtractionBanner` at `components/shared/extraction-banner.tsx` (PolicyExtractionBanner + OrgDocumentExtractionBanner)
- `makePipelineMutations()` factory at `convex/lib/pipelineMutations.ts`
- `dismissed` boolean field on `policies` to replace `extractionStatus: "not_insurance"` semantics
- `convex/migrations/removeDeprecatedExtractionFields.ts` — run to strip old fields from existing documents

### Changed
- All policy extraction entry points now fire-and-forget via cl-pipelines
- `extractFromDocument` is now fire-and-forget; callers receive `{ orgDocumentId }` immediately
- Policy detail page shows live `PolicyExtractionBanner`
- Documents sections show live `OrgDocumentExtractionBanner` per row
- `policies.dismiss` now sets `dismissed: true` instead of `extractionStatus: "not_insurance"`
- `policies.cancelExtraction` now sets `dismissed: true` + `pipelineError` instead of `extractionStatus: "not_insurance"`
- `policies.pauseExtraction` / `resumeExtraction` now read/write `pipelineStatus` directly

### Removed
- `policies.extractionStatus` / `policies.extractionCheckpoint` / `policies.extractionLog` / `policies.extractionError`
  — all code now reads `pipelineStatus` / `pipelineCheckpoint` / `pipelineLog` / `pipelineError`
- `policyFiles.extractionStatus` / `policyFiles.extractionError` / `policyFiles.extractionLog`
- `orgDocuments.extractionStatus` / `orgDocuments.extractionError`
- Note: deprecated fields remain as `v.optional` in schema until the migration mutation runs against existing documents.
  After running `internal.migrations.removeDeprecatedExtractionFields` for all three tables, remove the optional
  schema declarations.
