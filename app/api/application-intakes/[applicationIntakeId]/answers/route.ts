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

  const submission = detail.packetId
    ? detail.packets?.find((packet) => packet._id === detail.packetId)
    : null;
  const payload = {
    applicationId: detail._id,
    title: detail.title,
    clientName: detail.clientName ?? null,
    status: detail.status,
    lineOfBusiness: detail.lineOfBusiness ?? null,
    product: detail.product ?? null,
    answeredAt: detail.updatedAt,
    submittedAt: detail.submittedAt ?? null,
    answers: detail.normalizedAnswers.map((answer) => ({
      fieldId: answer.fieldId,
      label: answer.label,
      section: answer.section ?? null,
      value: answer.value,
      source: answer.source ?? null,
      updatedAt: answer.updatedAt ?? null,
    })),
    missingQuestions: detail.missingQuestions.map((question) => ({
      fieldId: question.fieldId,
      label: question.label,
      prompt: question.prompt,
      required: question.required,
      section: question.section ?? null,
    })),
    applicationData: Object.fromEntries(
      detail.normalizedAnswers.map((answer) => [answer.fieldId, answer.value]),
    ),
    submissionAnswers: submission?.answers ?? null,
  };

  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${safeFileName(detail.title)}"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
