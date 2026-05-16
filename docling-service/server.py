import hashlib
import hmac
import json
import os
import time
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Glass Docling Service")

MAX_CLOCK_SKEW_SECONDS = 5 * 60
DEFAULT_UPSTREAM = "http://127.0.0.1:5001"


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


def _extract_document(response_json: dict[str, Any]) -> dict[str, Any]:
    document = response_json.get("document")
    if isinstance(document, dict):
        return document
    documents = response_json.get("documents")
    if isinstance(documents, list) and documents and isinstance(documents[0], dict):
        nested = documents[0].get("document")
        if isinstance(nested, dict):
            return nested
        return documents[0]
    return {}


def _extract_markdown(document: dict[str, Any]) -> str:
    for key in ("md_content", "markdown", "markdown_content"):
        value = document.get(key)
        if isinstance(value, str):
            return value
    return ""


def _extract_doc_tags(document: dict[str, Any]) -> Any:
    for key in ("json_content", "doctags_content", "doc_tags", "docTagsJson"):
        value = document.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
        return value
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

    upstream = os.environ.get("DOCLING_UPSTREAM", DEFAULT_UPSTREAM).rstrip("/")
    timeout_seconds = float(os.environ.get("DOCLING_UPSTREAM_TIMEOUT", "240"))

    files = {"files": ("document.pdf", body, request.headers.get("content-type") or "application/pdf")}
    data = [
        ("to_formats", "md"),
        ("to_formats", "json"),
        ("do_ocr", "true"),
        ("do_table_structure", "true"),
        ("table_mode", "accurate"),
        ("image_export_mode", "placeholder"),
        ("abort_on_error", "false"),
    ]

    started = time.monotonic()
    async with httpx.AsyncClient(timeout=timeout_seconds) as client:
        upstream_response = await client.post(
            f"{upstream}/v1/convert/file",
            files=files,
            data=data,
            headers={"accept": "application/json"},
        )

    if upstream_response.status_code >= 400:
        return JSONResponse(
            status_code=502,
            content={
                "error": "Docling upstream conversion failed",
                "statusCode": upstream_response.status_code,
                "body": upstream_response.text[:2000],
            },
        )

    response_json = upstream_response.json()
    document = _extract_document(response_json)
    markdown = _extract_markdown(document)
    if not markdown:
        raise HTTPException(status_code=502, detail="Docling upstream returned no markdown")

    return JSONResponse(
        {
            "markdown": markdown,
            "docTagsJson": _extract_doc_tags(document),
            "parserVersion": f"docling-serve:{response_json.get('version') or 'unknown'}",
            "parsingMs": round((time.monotonic() - started) * 1000),
        }
    )
