# Glass Extraction Worker

Standalone worker for long-running `cl-sdk` policy extraction jobs. Convex stays the durable job ledger; this service only claims extract-phase work, sends heartbeats, saves SDK checkpoints, and returns the extracted document/chunks to Convex for embedding and post-processing.

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

Set `EXTRACTION_WORKER_MODE=external` on the Convex deployment to queue new and retried extraction jobs for this worker.

## Railway

Create a Railway service rooted at `extraction-worker/`. The included `railway.json` runs:

```bash
npm install && npm run build
npm run start
```

Run at least one worker replica. Multiple replicas are safe because jobs are claimed with Convex-backed leases and periodic heartbeats.
