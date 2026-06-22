import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function safeFileName(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "application"}-answers.json`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ applicationIntakeId: string }> },
) {
  const { applicationIntakeId } = await context.params;
  const token = await convexAuthNextjsToken();
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const detail = await fetchQuery(
    api.applicationIntakes.get,
    { applicationIntakeId: applicationIntakeId as Id<"applicationIntakes"> },
    { token },
  );

  if (!detail) {
    return new Response("Application not found", { status: 404 });
  }

  const payload = {
    application: {
      id: detail._id,
      title: detail.title,
      ...(detail.clientName ? { client: detail.clientName } : {}),
      status: detail.status,
      ...(detail.lineOfBusiness ? { lineOfBusiness: detail.lineOfBusiness } : {}),
      ...(detail.product ? { product: detail.product } : {}),
    },
    answers: detail.normalizedAnswers.map((answer) => ({
      fieldId: answer.fieldId,
      question: answer.label,
      answer: answer.value,
      ...(answer.section ? { section: answer.section } : {}),
    })),
    missingQuestions: detail.missingQuestions.map((question) => ({
      fieldId: question.fieldId,
      label: question.label,
      prompt: question.prompt,
      required: question.required,
      ...(question.section ? { section: question.section } : {}),
    })),
  };

  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${safeFileName(detail.title)}"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
