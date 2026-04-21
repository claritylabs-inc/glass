import { expect, test } from "vitest";
import {
  mapPdfWidgetToAnswerType,
  matchFieldToIntent,
  mapExtractedFieldsToQuestions,
} from "../lib/applicationPdfExtraction";

test("mapPdfWidgetToAnswerType maps checkbox to yes_no", () => {
  expect(mapPdfWidgetToAnswerType("checkbox")).toBe("yes_no");
});

test("mapPdfWidgetToAnswerType maps text to text", () => {
  expect(mapPdfWidgetToAnswerType("text")).toBe("text");
});

test("mapPdfWidgetToAnswerType defaults unknown widget to text", () => {
  expect(mapPdfWidgetToAnswerType("signature")).toBe("text");
});

test("matchFieldToIntent finds annual_revenue by label", () => {
  const intents = [
    {
      intentKey: "annual_revenue",
      label: "Annual Revenue",
      defaultPrompt: "What is annual revenue?",
    },
  ];
  const match = matchFieldToIntent("Annual Revenue", undefined, intents);
  expect(match?.intentKey).toBe("annual_revenue");
});

test("matchFieldToIntent returns null when no match", () => {
  const intents = [
    {
      intentKey: "annual_revenue",
      label: "Annual Revenue",
      defaultPrompt: "What is annual revenue?",
    },
  ];
  const match = matchFieldToIntent("Favorite Color", undefined, intents);
  expect(match).toBeNull();
});

test("mapExtractedFieldsToQuestions produces intentKey=null for unrecognised field", () => {
  const fields = [{ pdfFieldName: "FieldA", label: "Favorite Color", widgetType: "text" }];
  const intents = [
    {
      intentKey: "annual_revenue",
      label: "Annual Revenue",
      defaultPrompt: "What is annual revenue?",
    },
  ];
  const result = mapExtractedFieldsToQuestions(fields, intents);
  expect(result[0].intentKey).toBeNull();
  expect(result[0].prompt).toBe("Favorite Color");
  expect(result[0].answerType).toBe("text");
});

test("mapExtractedFieldsToQuestions resolves intentKey for known field", () => {
  const fields = [
    { pdfFieldName: "annual_revenue", label: "Annual Revenue", widgetType: "text" },
  ];
  const intents = [
    {
      intentKey: "annual_revenue",
      label: "Annual Revenue",
      defaultPrompt: "What is your annual revenue?",
    },
  ];
  const result = mapExtractedFieldsToQuestions(fields, intents);
  expect(result[0].intentKey).toBe("annual_revenue");
  expect(result[0].prompt).toBe("What is your annual revenue?");
});
