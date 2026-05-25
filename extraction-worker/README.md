# Glass Extraction Worker

Standalone worker for long-running `cl-sdk` policy extraction jobs. Convex stays the durable job ledger; this service claims extract-phase work, sends heartbeats, saves SDK checkpoints, and returns the extracted document/chunks to Convex for embedding and post-processing.

The worker also owns Docling preprocessing for `@claritylabs/cl-sdk`. It converts PDFs to serialized DoclingDocument JSON, passes that document into `cl-sdk`, and exposes a small authenticated HTTP endpoint for Convex actions that need synchronous PDF-to-Docling text conversion. If Docling fails or times out, callers fall back to the existing PDF/PDF.js path.

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
- `PORT` - set by Railway; when present, the worker serves `POST /docling/convert`

Set `EXTRACTION_WORKER_MODE=external` on the Convex deployment to queue new and retried extraction jobs for this worker.

Set `EXTRACTION_WORKER_URL` and the same `EXTRACTION_WORKER_SECRET` on Convex to let requirement imports, mailbox attachment reads, on-demand source lookup, and agent PDF attachment context call the worker's Docling endpoint. The endpoint accepts `{ "pdfBase64": "..." }` with `Authorization: Bearer <secret>` and returns `{ document, metadata }`.

## Railway

Create a Railway service rooted at `extraction-worker/`. The included `railway.json` builds the Dockerfile, which installs Node, Python, and the pinned Python `docling` package:

```bash
npm run start
```

Run at least one worker replica. Multiple replicas are safe because jobs are claimed with Convex-backed leases and periodic heartbeats.
