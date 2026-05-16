import hashlib
import hmac
import os
import tempfile
import time
from typing import Any

import docling
from docling.document_converter import DocumentConverter
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Glass Docling Service")

MAX_CLOCK_SKEW_SECONDS = 5 * 60
converter: DocumentConverter | None = None


def _converter() -> DocumentConverter:
    global converter
    if converter is None:
        converter = DocumentConverter()
    return converter


def _secret() -> str:
    secret = os.environ.get("DOCLING_HMAC_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="DOCLING_HMAC_SECRET is not configured")
    return secret


def _verify_signature(body: bytes, timestamp: str | None, signature: str | None) -> None:
    if not timestamp or not signature:
        raise HTTPException(status_code=401, detail="Missing Docling signature headers")

    try:
        request_time = int(timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid Docling timestamp") from exc

    if abs(int(time.time()) - request_time) > MAX_CLOCK_SKEW_SECONDS:
        raise HTTPException(status_code=401, detail="Docling timestamp outside allowed window")

    body_hash = hashlib.sha256(body).hexdigest()
    signed_payload = f"{timestamp}.{body_hash}".encode("utf-8")
    expected = hmac.new(_secret().encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid Docling signature")


def _export_doc_tags(document: Any) -> Any:
    if hasattr(document, "export_to_dict"):
        return document.export_to_dict()
    if hasattr(document, "model_dump"):
        return document.model_dump(mode="json")
    return None


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/v1/parse")
async def parse_pdf(
    request: Request,
    x_docling_timestamp: str | None = Header(default=None),
    x_docling_signature: str | None = Header(default=None),
) -> JSONResponse:
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="PDF body is empty")
    _verify_signature(body, x_docling_timestamp, x_docling_signature)

    started = time.monotonic()
    with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf:
        pdf.write(body)
        pdf.flush()
        try:
            result = _converter().convert(pdf.name)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Docling conversion failed: {exc}") from exc

    document = result.document
    markdown = document.export_to_markdown()
    if not markdown:
        raise HTTPException(status_code=502, detail="Docling returned no markdown")

    return JSONResponse(
        {
            "markdown": markdown,
            "docTagsJson": _export_doc_tags(document),
            "parserVersion": f"docling:{getattr(docling, '__version__', 'unknown')}",
            "parsingMs": round((time.monotonic() - started) * 1000),
        }
    )
