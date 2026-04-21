// convex/lib/applicationPdfExtraction.ts
// Pure PDF → FormField helpers used by extractApplicationPdf action.
// No Convex context, no side effects.

export type PdfWidgetType = "text" | "checkbox" | "radio" | "select" | "signature" | string;

export function mapPdfWidgetToAnswerType(widgetType: PdfWidgetType): string {
  if (widgetType === "checkbox" || widgetType === "radio") return "yes_no";
  if (widgetType === "select") return "select";
  return "text";
}

export interface IntentStub {
  intentKey: string;
  label: string;
  defaultPrompt: string;
}

/**
 * Fuzzy match a PDF field label (and optional form field name) against the
 * questionIntents seed table. Returns the best match or null.
 *
 * Match rules (in priority order):
 * 1. Exact case-insensitive label match.
 * 2. Normalized match: strip punctuation/spaces from both sides, compare.
 * 3. Normalized form field name match against intentKey (snake_case → spaces).
 */
export function matchFieldToIntent(
  pdfLabel: string,
  formFieldName: string | undefined,
  intents: IntentStub[],
): IntentStub | null {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const normLabel = normalize(pdfLabel);

  for (const intent of intents) {
    if (normalize(intent.label) === normLabel) return intent;
  }

  if (formFieldName) {
    const normFieldName = normalize(formFieldName.replace(/_/g, " "));
    for (const intent of intents) {
      if (normalize(intent.intentKey.replace(/_/g, " ")) === normFieldName) return intent;
    }
  }

  return null;
}

/**
 * Convert a list of AcroForm fields (from pdfFiller.getAcroFormFields) into
 * a shape ready for createApplicationQuestionsFromFields.
 */
export interface ExtractedField {
  pdfFieldName: string;
  label: string;
  widgetType: PdfWidgetType;
}

export interface MappedQuestion {
  intentKey: string | null;
  prompt: string;
  answerType: string;
  pdfFieldName: string;
}

export function mapExtractedFieldsToQuestions(
  fields: ExtractedField[],
  intents: IntentStub[],
): MappedQuestion[] {
  return fields.map((field) => {
    const match = matchFieldToIntent(field.label, field.pdfFieldName, intents);
    return {
      intentKey: match?.intentKey ?? null,
      prompt: match?.defaultPrompt ?? field.label,
      answerType: mapPdfWidgetToAnswerType(field.widgetType),
      pdfFieldName: field.pdfFieldName,
    };
  });
}
