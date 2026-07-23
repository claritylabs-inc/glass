# Glass Extraction Worker

Standalone worker for long-running `cl-sdk` policy extraction jobs. Convex stays the durable job ledger; this service claims extract-phase work, sends heartbeats, saves SDK checkpoints, and returns the extracted document/chunks to Convex for embedding and post-processing.

The worker also owns LiteParse preprocessing for `@claritylabs/cl-sdk`. It converts PDFs to parser text plus hierarchical page/row/cell source spans with bounding boxes, captures bounded page screenshots for multimodal model calls, passes the original PDF bytes and those spans into `cl-sdk`, and exposes a small authenticated HTTP endpoint for Convex actions that need synchronous parsed PDF text. If LiteParse fails or times out, callers fall back to the existing PDF/PDF.js path.

## Local

```bash
npm install
cp .env.template .env
npm run build
npm run start
```

Required env:

- `CONVEX_URL` - Convex deployment URL, for example `https://acoustic-caiman-755.convex.cloud`
- `EXTRACTION_WORKER_SECRET` - shared secret that also exists on the Convex deployment
- provider keys for default routing, usually `OPENAI_API_KEY`; broker-owned provider keys are returned with each trusted claim when configured
- `PORT` - set by Railway; when present, the worker serves `POST /liteparse/convert`

Set `EXTRACTION_WORKER_MODE=external` on the Convex deployment to queue new and retried extraction jobs for this worker.

## cl-router rollout

The worker can forward structured full-extraction and provisional-extraction model calls to the internal task-aware router. It sends the claimed job's resolved broker/operator settings snapshot, organization context, exact JSON schema, trace metadata, and base64 document/image parts on every request. The returned provider/model, request ID, routing decision, cached-token usage, and dollar cost are copied into the existing extraction trace details. Provider keys are forwarded only inside the authenticated request and are never logged.

Routing is opt-in per task:

```bash
CL_ROUTER_URL=https://cl-router-dev.up.railway.app
CL_ROUTER_SECRET=shared-router-secret
CL_ROUTER_TASKS=extraction,extraction_preview
CL_ROUTER_TENANT_ID=glass
CL_ROUTER_TIMEOUT_MS=180000
```

`extraction` covers the full extraction pipeline, including its classification and coverage subtasks. `extraction_preview` controls the provisional path independently. Exact model task or task-kind names can be listed for narrower staging, and `*` enables every worker model call. An empty `CL_ROUTER_TASKS` preserves direct-only behavior and does not require router configuration.

The direct provider implementation remains the break-glass path. It is used automatically only when the router cannot connect, times out, or returns HTTP 5xx. Authentication, validation, other 4xx responses, and malformed successful responses fail closed. Direct primary and fallback attempts continue to rebuild their route-specific input and structured-output schema independently.

Convex rejects stale external workers before they can claim jobs when expected-version env vars are set. Workers send `workerProtocolVersion`, `workerVersion`, and `clSdkVersion` on every claim and expose the same values at `GET /health`. Dev Convex should set `EXTRACTION_WORKER_EXPECTED_PROTOCOL_VERSION` to the current worker protocol and `EXTRACTION_WORKER_EXPECTED_CL_SDK_VERSION` to the package spec in `extraction-worker/package.json`.

Set `EXTRACTION_WORKER_URL` and the same `EXTRACTION_WORKER_SECRET` on Convex to let requirement imports, mailbox attachment reads, on-demand source lookup, and agent PDF attachment context call the worker's LiteParse endpoint. The endpoint accepts `{ "pdfBase64": "..." }` with `Authorization: Bearer <secret>` and returns `{ text, sourceSpans, sourceChunks, pageScreenshots, metadata }`.

## Railway

Create a Railway service rooted at `extraction-worker/`. The included `railway.json` builds the Dockerfile with Node and the native `@llamaindex/liteparse` package:

```bash
node dist/index.js
```

Run at least one worker replica. Multiple replicas are safe because jobs are claimed with Convex-backed leases and periodic heartbeats.

Focused validation:

```bash
npm test
npm run build
```
