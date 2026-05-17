#!/usr/bin/env python3
import argparse
import json
import sys
import time
from pathlib import Path

from docling.document_converter import DocumentConverter


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert a PDF to DoclingDocument JSON.")
    parser.add_argument("pdf_path")
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument("--max-file-size", type=int, default=None)
    args = parser.parse_args()

    started = time.perf_counter()
    converter = DocumentConverter()
    convert_kwargs = {}
    if args.max_pages is not None:
        convert_kwargs["max_num_pages"] = args.max_pages
    if args.max_file_size is not None:
        convert_kwargs["max_file_size"] = args.max_file_size

    result = converter.convert(Path(args.pdf_path), **convert_kwargs)
    document = result.document.export_to_dict()

    payload = {
        "document": document,
        "metadata": {
            "parserBackend": "docling",
            "parserVersion": "2.93.0",
            "parsingMs": int((time.perf_counter() - started) * 1000),
        },
    }
    print(json.dumps(payload, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
