# cl-router API contract snapshot

Glass validates its representative cl-router payloads against the checked-in
OpenAPI 3.1 snapshot in this directory. `npm run check:cl-router-contract` is
offline: CI does not clone the private router repository, call a deployed
service, or require router credentials.

The checker enforces three boundaries:

- the snapshot bytes match the SHA-256 recorded in `source.json`;
- the Glass-used operations still reference the expected request and response
  schemas; and
- representative generation, streaming, embedding, transcription, feedback,
  health, and admin payloads in `fixtures.v1.json` validate with strict Ajv
  draft-2020-12 checks.

The calibration fixture also exercises the production-activation boundary.
The current extraction qualification spec is explicitly a
`proxy_benchmark` with `benchmark_only` eligibility and no runtime-contract
binding. The fixture remains useful for checking the seed schema, corpus
evidence, integrity hashes, coverage mix, and replicate counts, but the router
must reject it for autonomous production activation. Only a future
`published_runtime_contract` spec bound to exact content-addressed cl-sdk
artifacts can cross that boundary.

## Refreshing the snapshot

1. In `claritylabs-inc/cl-router`, make the v1 contract change additive,
   regenerate `openapi/cl-router-v1.json` with `npm run openapi:generate`, and
   pass `npm run openapi:check`.
2. Release and tag the router, then copy the exact
   `openapi/cl-router-v1.json` bytes from that clean release tag to
   `contracts/cl-router/openapi.v1.json` in Glass.
3. Update `source.json` with the full 40-character commit SHA resolved by the
   release tag, `sourceWorktreeDirty: false`, and the digest from
   `shasum -a 256 contracts/cl-router/openapi.v1.json`. Uncommitted or dirty
   router worktrees are not valid contract-snapshot sources.
4. Update or add fixtures for every Glass-used additive field or operation.
   Do not weaken or delete an existing fixture to accommodate a breaking v1
   change; version the snapshot and checker instead.
5. Run `npm run check:cl-router-contract`, then the normal Glass lint and
   typechecks. Commit the snapshot, provenance, fixtures, and caller changes
   together.

If cl-router changes without a Glass snapshot refresh, its own generated-spec
check catches an uncommitted source snapshot and Glass review should require
the corresponding snapshot update. Glass CI then catches stale operation
bindings, incompatible schemas, invalid fixtures, and manual snapshot edits
whose digest was not deliberately refreshed.
