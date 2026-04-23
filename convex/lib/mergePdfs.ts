import { PDFDocument } from "pdf-lib";

export async function mergePdfsFromUrls(urls: string[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch PDF for merge: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return await merged.save();
}

export function mergedFileName(firstName: string, totalCount: number): string {
  if (totalCount <= 1) return firstName;
  const dot = firstName.lastIndexOf(".");
  const base = dot > 0 ? firstName.slice(0, dot) : firstName;
  const extra = totalCount - 1;
  return `${base} + ${extra} more.pdf`;
}
