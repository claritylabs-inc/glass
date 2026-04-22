# Changelog

## Unreleased

### Added
- cl-pipelines extraction pipeline for policies (`policyExtraction.ts`)
- cl-pipelines extraction pipeline for org documents (`orgDocumentExtraction.ts`)
- `pipelineFields()` on `policies`, `policyFiles`, `orgDocuments` schema tables
- Shared `ExtractionBanner` at `components/shared/extraction-banner.tsx` (PolicyExtractionBanner + OrgDocumentExtractionBanner)
- `makePipelineMutations()` factory at `convex/lib/pipelineMutations.ts`

### Changed
- All policy extraction entry points now fire-and-forget via cl-pipelines
- `extractFromDocument` is now fire-and-forget; callers receive `{ orgDocumentId }` immediately
- Policy detail page shows live `PolicyExtractionBanner`
- Documents sections show live `OrgDocumentExtractionBanner` per row

### TODO — next release (follow-up PR after one release cycle)
- **Remove old extraction fields from schema** — Task 9 of the extraction consolidation plan.
  Fields to remove:
  - `policies.extractionStatus` / `policies.extractionCheckpoint` / `policies.extractionLog`
  - `policyFiles.extractionStatus` / `policyFiles.extractionLog`
  - `orgDocuments.extractionStatus` / `orgDocuments.extractionError`
  These are kept for backwards read compatibility during rollout. All new writes go to
  `pipelineStatus` / `pipelineCheckpoint` / `pipelineLog` / `pipelineError`.
  Search: `grep -rn "extractionStatus\|extractionCheckpoint\|extractionLog" --include="*.ts" --include="*.tsx"`
