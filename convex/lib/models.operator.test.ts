import { afterEach, describe, expect, test, vi } from "vitest";

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: generateTextMock,
}));

import { generateAgentTextForOperatorTask } from "./models";

function operatorContext() {
  return {
    runQuery: vi.fn(async () => ({
      provider: "openai" as const,
      model: "gpt-5.6-terra",
    })),
    runMutation: vi.fn(async () => null),
  };
}

const run = {
  sessionKey: "operator:user:thread",
  taskKind: "operator_agent" as const,
  trace: {
    traceId: "operator-run",
    label: "operator-agent",
    phase: "query_reason",
    channel: "web" as const,
  },
};

describe("operator model execution boundary", () => {
  afterEach(() => {
    generateTextMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test.each([
    {
      label: "provider error",
      result: () => Promise.reject(new Error("provider returned 500")),
    },
    {
      label: "blank response",
      result: () =>
        Promise.resolve({ text: "", steps: [], finishReason: "stop" }),
    },
    {
      label: "length-limited response",
      result: () =>
        Promise.resolve({ text: "partial", steps: [], finishReason: "length" }),
    },
  ])("makes one direct attempt with no fallback for a $label", async ({ result }) => {
    vi.stubEnv("OPENAI_API_KEY", "operator-openai-key");
    vi.stubEnv("CL_ROUTER_TASKS", "*");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    generateTextMock.mockImplementationOnce(result);
    const ctx = operatorContext();

    await expect(
      generateAgentTextForOperatorTask(
        ctx as never,
        "chat_vision",
        { messages: [{ role: "user", content: "Inspect this." }] },
        run,
      ),
    ).rejects.toThrow();

    expect(generateTextMock).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.runQuery).toHaveBeenCalledOnce();
  });
});
