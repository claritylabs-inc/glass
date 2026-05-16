# Glass Docling Service

`docling-service` is a Railway-hosted FastAPI wrapper around Docling. Convex sends raw PDF bytes to `POST /v1/parse`; this service verifies an HMAC signature, parses the PDF with Docling, and returns structured markdown plus parser audit metadata.

## Endpoints

- `GET /healthz` returns `{ "ok": true }`.
- `POST /v1/parse` accepts a raw `application/pdf` body and requires:
  - `X-Docling-Timestamp`: Unix seconds.
  - `X-Docling-Signature`: lowercase hex HMAC-SHA256 over `${timestamp}.${sha256(body)}` using `DOCLING_HMAC_SECRET`.

The parse response is:

```json
{
  "markdown": "# ...",
  "docTagsJson": {},
  "parserVersion": "docling:unknown",
  "parsingMs": 1234
}
```

## Local Docker run

```bash
cd docling-service
docker build -t docling-service .
docker run -d --name docling -p 8080:8080 -e DOCLING_HMAC_SECRET=devsecret docling-service
sleep 60
curl -s http://localhost:8080/healthz
```

## Local signed parse smoke test

```bash
python - <<'PY'
import hashlib, hmac, pathlib, requests, time
pdf = pathlib.Path('~/Desktop/specimen_policy.pdf').expanduser().read_bytes()
ts = str(int(time.time()))
body_hash = hashlib.sha256(pdf).hexdigest()
sig = hmac.new(b'devsecret', f'{ts}.{body_hash}'.encode(), hashlib.sha256).hexdigest()
res = requests.post(
    'http://localhost:8080/v1/parse',
    data=pdf,
    headers={
        'content-type': 'application/pdf',
        'X-Docling-Timestamp': ts,
        'X-Docling-Signature': sig,
    },
    timeout=300,
)
res.raise_for_status()
print(len(res.json()['markdown']))
PY
```

## Railway setup

1. Create a Railway service named `docling-service` in the existing Glass project.
2. Set the service root directory to `docling-service/`.
3. Confirm Railway builds `docling-service/Dockerfile` with the checked-in `railway.json` Dockerfile builder config.
4. Set Railway variables:

```text
DOCLING_HMAC_SECRET=<new random secret>
```

5. Generate a public Railway domain for the service.
6. Set matching Convex environment variables:

```bash
npx convex env set DOCLING_URL "https://<docling-service>.up.railway.app"
npx convex env set DOCLING_HMAC_SECRET "<same value as Railway>"
npx convex env set DOCLING_ENABLED "false"
```

7. If production extraction uses `EXTRACTION_WORKER_MODE=external`, set the same `DOCLING_URL` and `DOCLING_HMAC_SECRET` on the Railway `glass-extraction-worker` service. Convex returns the per-org Docling enablement flag with each claimed extraction job, but the trusted worker calls the Docling service directly.

Keep `DOCLING_ENABLED=false` globally until a single-org smoke test passes, then enable `organizations.featureFlags.docling=true` only for the target org.
