import hashlib
import hmac
import logging
import os
import tempfile
import time
from typing import Any, Tuple

import docling
from docling.document_converter import DocumentConverter
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Glass Docling Service")
logger = logging.getLogger("glass-docling-service")

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


def _collection_length(value: Any) -> int | None:
    try:
        return len(value)
    except TypeError:
        return None


def _document_stat(document: Any, name: str) -> int | None:
    value = getattr(document, name, None)
    if value is None:
        return None
    return _collection_length(value)


def _extract_pdfium_text(pdf_path: str) -> str:
    try:
        import pypdfium2 as pdfium
    except Exception as exc:
        logger.warning("PyPDFium fallback unavailable: %s", exc)
        return ""

    pages: list[str] = []
    try:
        pdf = pdfium.PdfDocument(pdf_path)
        try:
            for index in range(len(pdf)):
                page = pdf[index]
                try:
                    textpage = page.get_textpage()
                    try:
                        text = textpage.get_text_range()
                    finally:
                        if hasattr(textpage, "close"):
                            textpage.close()
                finally:
                    if hasattr(page, "close"):
                        page.close()

                if isinstance(text, str) and text.strip():
                    pages.append(f"Page {index + 1}\n\n{text.strip()}")
        finally:
            if hasattr(pdf, "close"):
                pdf.close()
    except Exception as exc:
        logger.warning("PyPDFium fallback failed: %s", exc)
        return ""

    return "\n\n".join(pages)


def _export_markdown(document: Any, pdf_path: str) -> Tuple[str, str]:
    markdown = document.export_to_markdown() if hasattr(document, "export_to_markdown") else ""
    if isinstance(markdown, str) and markdown.strip():
        return markdown, "docling_markdown"

    strict_text = (
        document.export_to_markdown(strict_text=True)
        if hasattr(document, "export_to_markdown")
        else ""
    )
    if isinstance(strict_text, str) and strict_text.strip():
        logger.warning("Docling returned empty markdown; using strict text export fallback")
        return strict_text, "docling_strict_text"

    text = document.export_to_text() if hasattr(document, "export_to_text") else ""
    if isinstance(text, str) and text.strip():
        logger.warning("Docling returned empty markdown; using text export fallback")
        return text, "docling_text"

    pdfium_text = _extract_pdfium_text(pdf_path)
    if pdfium_text.strip():
        logger.warning("Docling returned empty text; using PyPDFium text fallback")
        return pdfium_text, "pypdfium2_text"

    return "", "empty"


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
    request_id = hashlib.sha256(body).hexdigest()[:12]
    with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf:
        pdf.write(body)
        pdf.flush()
        try:
            result = _converter().convert(pdf.name)
        except Exception as exc:
            logger.warning(
                "Docling conversion failed request_id=%s bytes=%d error=%s",
                request_id,
                len(body),
                exc,
            )
            raise HTTPException(status_code=502, detail=f"Docling conversion failed: {exc}") from exc

        document = result.document
        markdown, export_backend = _export_markdown(document, pdf.name)

    parsing_ms = round((time.monotonic() - started) * 1000)
    log_fields = {
        "request_id": request_id,
        "bytes": len(body),
        "pages": _document_stat(document, "pages"),
        "texts": _document_stat(document, "texts"),
        "tables": _document_stat(document, "tables"),
        "pictures": _document_stat(document, "pictures"),
        "markdown_chars": len(markdown),
        "export_backend": export_backend,
        "parsing_ms": parsing_ms,
    }
    if not markdown:
        logger.warning("Docling returned no extractable text: %s", log_fields)
        raise HTTPException(status_code=422, detail="Docling returned no extractable text")

    logger.info("Docling parse completed: %s", log_fields)

    return JSONResponse(
        {
            "markdown": markdown,
            "docTagsJson": _export_doc_tags(document),
            "parserVersion": f"docling:{getattr(docling, '__version__', 'unknown')}",
            "parsingMs": parsing_ms,
            "exportBackend": export_backend,
        }
    )
