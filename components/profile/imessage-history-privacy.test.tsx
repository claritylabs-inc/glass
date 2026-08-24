import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  ImessagePrivacyDrawer,
  ImessagePrivacyPanel,
  type ImessagePrivacyState,
} from "./imessage-history-privacy";
import type { Id } from "@/convex/_generated/dataModel";

const readyState: ImessagePrivacyState = {
  historyGeneration: 0,
  hasActiveAgentTurn: false,
  deletion: null,
  latestCompleted: null,
  preview: {
    id: "preview-1" as Id<"imessageHistoryDeletionJobs">,
    kind: "preview",
    status: "ready",
    threadCount: 2,
    messageCount: 14,
    fileCount: 3,
    processedThreadCount: 0,
    deletedMessageCount: 0,
    deletedFileCount: 0,
    preservedFileCount: 0,
    requestedAt: 1,
    readyAt: 2,
    startedAt: undefined,
    completedAt: undefined,
    updatedAt: 2,
    lastError: undefined,
  },
};

describe("personal iMessage privacy controls", () => {
  test("renders a destructive review trigger for a ready inventory", () => {
    const html = renderToStaticMarkup(
      <ImessagePrivacyPanel
        state={readyState}
        busy={false}
        onPrepare={() => {}}
        onReview={() => {}}
      />,
    );
    expect(html).toContain("Review deletion");
    expect(html).toContain("bg-destructive/10");
  });

  test("disables destructive confirmation while a targeted agent turn is active", () => {
    const html = renderToStaticMarkup(
      <ImessagePrivacyDrawer
        open
        onOpenChange={() => {}}
        state={{ ...readyState, hasActiveAgentTurn: true }}
        busy={false}
        onPrepare={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(html).toContain("An iMessage response is active");
    expect(html).toMatch(/disabled=""[^>]*>[\s\S]*Permanently delete/);
  });

  test("offers a safe retry after an inventory failure", () => {
    const html = renderToStaticMarkup(
      <ImessagePrivacyPanel
        state={{
          ...readyState,
          preview: readyState.preview
            ? { ...readyState.preview, status: "failed" }
            : null,
        }}
        busy={false}
        onPrepare={() => {}}
        onReview={() => {}}
      />,
    );
    expect(html).toContain("Needs retry");
    expect(html).toContain("Prepare retry");
  });
});
