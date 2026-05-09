import { NextRequest, NextResponse } from "next/server";
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
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

    try {
      const form = pdfDoc.getForm();
      if (form.getFields().length > 0) {
        form.flatten({ updateFieldAppearances: true });
      }
    } catch {
      // No AcroForm to flatten.
    }

    const flattenedBytes = await pdfDoc.save();
    const flattenedBase64 = Buffer.from(flattenedBytes).toString("base64");

    return NextResponse.json({ pdfBase64: flattenedBase64 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("PDF flatten error:", message);
    return NextResponse.json({ error: `Flatten failed: ${message}` }, { status: 500 });
  }
}
