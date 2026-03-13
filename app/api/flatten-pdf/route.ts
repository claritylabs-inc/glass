import { NextRequest, NextResponse } from "next/server";
import * as mupdf from "mupdf";
import { PDFDocument } from "pdf-lib";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.FLATTEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Flatten API not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { pdfBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.pdfBase64 || typeof body.pdfBase64 !== "string") {
    return NextResponse.json({ error: "Missing pdfBase64 field" }, { status: 400 });
  }

  try {
    const pdfBuffer = Buffer.from(body.pdfBase64, "base64");

    // Load PDF with mupdf and rasterize each page to PNG at 144 DPI (2x)
    const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
    const pageCount = doc.countPages();
    const pngPages: Uint8Array[] = [];
    const DPI = 144;
    const scale = DPI / 72; // mupdf default is 72 DPI

    for (let i = 0; i < pageCount; i++) {
      const page = doc.loadPage(i);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false, // no alpha
        true,  // annots
      );
      const png = pixmap.asPNG();
      pngPages.push(png);
    }

    // Build a clean PDF from the rasterized PNGs using pdf-lib
    const outPdf = await PDFDocument.create();

    for (let i = 0; i < pageCount; i++) {
      // Get original page dimensions for correct sizing
      const page = doc.loadPage(i);
      const bounds = page.getBounds();
      const width = bounds[2] - bounds[0];
      const height = bounds[3] - bounds[1];

      const pngImage = await outPdf.embedPng(pngPages[i]);
      const pdfPage = outPdf.addPage([width, height]);
      pdfPage.drawImage(pngImage, {
        x: 0,
        y: 0,
        width,
        height,
      });
    }

    const flattenedBytes = await outPdf.save();
    const flattenedBase64 = Buffer.from(flattenedBytes).toString("base64");

    return NextResponse.json({ pdfBase64: flattenedBase64 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("PDF flatten error:", message);
    return NextResponse.json({ error: `Flatten failed: ${message}` }, { status: 500 });
  }
}
