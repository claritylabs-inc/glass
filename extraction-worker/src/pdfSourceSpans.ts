import { createHash } from "crypto";
import { spawn } from "node:child_process";

type SourceKind = "policy_pdf" | "email" | "attachment" | "manual_note";

export type WorkerSourceSpan = {
  id: string;
  documentId: string;
  sourceKind: SourceKind;
  kind: "pdf_text" | "plain_text";
  pageStart?: number;
  pageEnd?: number;
  sectionId?: string;
  formNumber?: string;
  text: string;
  textHash: string;
  hash: string;
  location?: {
    page?: number;
    startPage?: number;
    endPage?: number;
    fieldPath?: string;
  };
  metadata?: Record<string, string>;
};

export type WorkerSourceChunk = {
  id: string;
  documentId: string;
  sourceSpanIds: string[];
  text: string;
  textHash: string;
  pageStart?: number;
  pageEnd?: number;
  metadata?: Record<string, string>;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hashText(value: string): string {
  return createHash("sha256").update(normalizeWhitespace(value).toLowerCase()).digest("hex");
}

function idPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

function buildSpan(input: {
  documentId: string;
  sourceKind: SourceKind;
  pageNumber?: number;
  text: string;
  index: number;
  sectionId?: string;
  formNumber?: string;
  metadata?: Record<string, string>;
}): WorkerSourceSpan | undefined {
  const text = normalizeWhitespace(input.text);
  if (!text) return undefined;
  const textHash = hashText(text);
  const pagePart = input.pageNumber ?? "na";
  return {
    id: `${idPart(input.documentId)}:span:${pagePart}:${input.index}:${textHash.slice(0, 12)}`,
    documentId: input.documentId,
    sourceKind: input.sourceKind,
    kind: input.sourceKind.endsWith("_pdf") ? "pdf_text" : "plain_text",
    pageStart: input.pageNumber,
    pageEnd: input.pageNumber,
    sectionId: input.sectionId,
    formNumber: input.formNumber,
    text,
    textHash,
    hash: textHash,
    location: {
      page: input.pageNumber,
      startPage: input.pageNumber,
      endPage: input.pageNumber,
      fieldPath: input.sectionId,
    },
    metadata: input.metadata,
  };
}

function splitPageIntoSectionCandidates(text: string): Array<{ title: string; text: string; formNumber?: string }> {
  const headingPattern = /^(?:SECTION|COVERAGE|EXCLUSION|EXCLUSIONS|CONDITION|CONDITIONS|ENDORSEMENT|ENDORSEMENTS|DEFINITION|DEFINITIONS|DECLARATIONS?|SCHEDULE|FORM)\b[\s:.-]*(.*)$/i;
  const lines = text.split(/\r?\n/);
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (headingPattern.test(line)) {
      if (current) sections.push(current);
      current = { title: normalizeWhitespace(line).slice(0, 120), lines: [line] };
      continue;
    }
    current?.lines.push(rawLine);
  }
  if (current) sections.push(current);

  return sections
    .map((section) => {
      const sectionText = normalizeWhitespace(section.lines.join("\n"));
      return {
        title: section.title,
        text: sectionText,
        formNumber: sectionText.match(/\b[A-Z]{2,8}\s+\d{2,5}(?:\s+\d{2,4})?\b/)?.[0],
      };
    })
    .filter((section) => section.text.length >= 120);
}

function chunkSourceSpans(sourceSpans: WorkerSourceSpan[], maxChars = 6000): WorkerSourceChunk[] {
  const chunks: WorkerSourceChunk[] = [];
  let current: WorkerSourceSpan[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    const text = current.map((span) => span.text).join("\n\n");
    const textHash = hashText(text);
    chunks.push({
      id: `${idPart(current[0].documentId)}:source_chunk:${chunks.length}:${hashText(current.map((span) => span.id).join("|")).slice(0, 12)}`,
      documentId: current[0].documentId,
      sourceSpanIds: current.map((span) => span.id),
      text,
      textHash,
      pageStart: current.find((span) => typeof span.pageStart === "number")?.pageStart,
      pageEnd: [...current].reverse().find((span) => typeof span.pageEnd === "number")?.pageEnd,
    });
    current = [];
    currentLength = 0;
  };

  for (const span of sourceSpans) {
    const nextLength = currentLength + span.text.length + (current.length > 0 ? 2 : 0);
    if (current.length > 0 && nextLength > maxChars) flush();
    current.push(span);
    currentLength += span.text.length + (current.length > 1 ? 2 : 0);
  }
  flush();

  return chunks;
}

type SourceSpanText = {
  pageStart?: number;
  pageEnd?: number;
  text?: string;
};

const PDFTOTEXT_TIMEOUT_MS = 20_000;
const PDFTOTEXT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const LABELED_PAGE_PATTERN =
  /\b(?:print name|named insured|customer name|occupant name|policy number|coverage limit|monthly premium)\b/i;

function comparisonTokens(value: string): Set<string> {
  return new Set(
    normalizeWhitespace(value)
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length >= 3 || /\d/.test(token)) ?? [],
  );
}

export function selectPdfTextSupplements(
  primarySourceSpans: SourceSpanText[],
  candidates: WorkerSourceSpan[],
): WorkerSourceSpan[] {
  const primaryTokensByPage = new Map<number, Set<string>>();
  for (const span of primarySourceSpans) {
    const page = span.pageStart ?? span.pageEnd;
    if (!page || !span.text) continue;
    const pageTokens = primaryTokensByPage.get(page) ?? new Set<string>();
    for (const token of comparisonTokens(span.text)) pageTokens.add(token);
    primaryTokensByPage.set(page, pageTokens);
  }

  return candidates.filter((candidate) => {
    const page = candidate.pageStart ?? candidate.pageEnd;
    if (!page) return false;
    const primaryTokens = primaryTokensByPage.get(page) ?? new Set<string>();
    const novelTokens = [...comparisonTokens(candidate.text)].filter(
      (token) => !primaryTokens.has(token),
    );
    return (
      novelTokens.length >= 2 ||
      (novelTokens.length >= 1 && LABELED_PAGE_PATTERN.test(candidate.text))
    );
  });
}

async function popplerPageText(pdfBytes: Uint8Array): Promise<string[]> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", "-", "-"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve(
        Buffer.concat(stdout)
          .toString("utf8")
          .split("\f")
          .map((page) => page.trimEnd()),
      );
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`pdftotext timed out after ${PDFTOTEXT_TIMEOUT_MS}ms`));
    }, PDFTOTEXT_TIMEOUT_MS);

    child.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > PDFTOTEXT_MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(
          new Error(
            `pdftotext output exceeded ${PDFTOTEXT_MAX_OUTPUT_BYTES} bytes`,
          ),
        );
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(
          new Error(
            `pdftotext exited with code ${code}: ${Buffer.concat(stderr)
              .toString("utf8")
              .trim()}`,
          ),
        );
        return;
      }
      finish();
    });
    child.stdin.on("error", (error) => finish(error));
    child.stdin.end(Buffer.from(pdfBytes));
  });
}

export async function buildPdfTextSupplements(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  primarySourceSpans: SourceSpanText[];
  sourceKind?: SourceKind;
}): Promise<{
  sourceSpans: WorkerSourceSpan[];
  sourceChunks: WorkerSourceChunk[];
}> {
  try {
    const pages = await popplerPageText(params.pdfBytes);
    const candidates = pages.flatMap((text, index) => {
      const span = buildSpan({
        documentId: params.documentId,
        sourceKind: params.sourceKind ?? "policy_pdf",
        pageNumber: index + 1,
        text,
        index: 100_000 + index,
        metadata: {
          sourceSystem: "poppler",
          sourceUnit: "page_text_supplement",
        },
      });
      return span ? [span] : [];
    });
    const sourceSpans = selectPdfTextSupplements(
      params.primarySourceSpans,
      candidates,
    );
    return {
      sourceSpans,
      sourceChunks: chunkSourceSpans(sourceSpans),
    };
  } catch (error) {
    console.warn(
      `Supplemental PDF text extraction unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { sourceSpans: [], sourceChunks: [] };
  }
}

export async function buildPdfSourceSpans(params: {
  pdfBytes: Uint8Array;
  documentId: string;
  sourceKind?: SourceKind;
}): Promise<{ sourceSpans: WorkerSourceSpan[]; sourceChunks: WorkerSourceChunk[] }> {
  try {
    const { getDocument, VerbosityLevel } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: new Uint8Array(params.pdfBytes),
      isEvalSupported: false,
      useWasm: false,
      useSystemFonts: true,
      verbosity: VerbosityLevel.ERRORS,
    } as Record<string, unknown>);
    const doc = await loadingTask.promise;
    const sourceSpans: WorkerSourceSpan[] = [];

    try {
      for (let index = 0; index < doc.numPages; index += 1) {
        const pageNumber = index + 1;
        const page = await doc.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item) => {
            if (!("str" in item)) return "";
            return `${item.str}${item.hasEOL ? "\n" : " "}`;
          })
          .join("");
        const span = buildSpan({
          documentId: params.documentId,
          sourceKind: params.sourceKind ?? "policy_pdf",
          pageNumber,
          text,
          index,
        });
        if (span) sourceSpans.push(span);

        for (const section of splitPageIntoSectionCandidates(text)) {
          const sectionSpan = buildSpan({
            documentId: params.documentId,
            sourceKind: params.sourceKind ?? "policy_pdf",
            pageNumber,
            text: section.text,
            sectionId: section.title,
            formNumber: section.formNumber,
            metadata: { sourceUnit: "section_candidate" },
            index: sourceSpans.length,
          });
          if (sectionSpan) sourceSpans.push(sectionSpan);
        }
        page.cleanup();
      }
    } finally {
      await doc.destroy();
    }

    return {
      sourceSpans,
      sourceChunks: chunkSourceSpans(sourceSpans),
    };
  } catch (error) {
    console.warn(`PDF source span extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    return { sourceSpans: [], sourceChunks: [] };
  }
}
