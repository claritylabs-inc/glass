import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { runWebRetrieval } from "./webRetrieval";

const orgId = "org_test" as Id<"organizations">;

function actionContext(webRetrieval?: { primary: "parallel" | "exa" }) {
  return {
    runQuery: vi.fn().mockResolvedValue({ webRetrieval }),
  } as unknown as ActionCtx;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Parallel web retrieval", () => {
  test("uses Parallel Search by default and maps excerpts into Glass sources", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "parallel-test-key");
    vi.stubEnv("EXA_API_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            url: "https://example.com/first",
            title: "First result",
            excerpts: ["First excerpt", "Second excerpt"],
          },
          {
            url: "https://example.com/ignored",
            title: "Ignored result",
            excerpts: ["This result exceeds maxResults"],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runWebRetrieval(actionContext(), orgId, {
      query: "commercial property insurance trends",
      goal: "Find current market evidence",
      allowedDomains: ["example.com"],
      maxResults: 1,
    });

    expect(result.provider).toBe("parallel");
    expect(result.sources).toEqual([
      { title: "First result", url: "https://example.com/first" },
    ]);
    expect(result.text).toContain("First excerpt Second excerpt");
    expect(result.text).not.toContain("exceeds maxResults");
    expect(result.attempts).toEqual([{ provider: "parallel", ok: true }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.parallel.ai/v1/search");
    expect(init.headers).toMatchObject({ "x-api-key": "parallel-test-key" });
    expect(JSON.parse(String(init.body))).toEqual({
      objective:
        "commercial property insurance trends\nFind current market evidence",
      search_queries: ["commercial property insurance trends"],
      mode: "advanced",
      max_chars_total: 12_000,
      advanced_settings: {
        source_policy: { include_domains: ["example.com"] },
      },
    });
  });

  test("uses Parallel Extract for a known public URL", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "parallel-test-key");
    vi.stubEnv("EXA_API_KEY", "");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            url: "https://example.com/about",
            title: "About Example",
            excerpts: ["Example provides commercial insurance services."],
          },
        ],
        errors: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runWebRetrieval(actionContext(), orgId, {
      url: "https://example.com/about",
      goal: "Verify the company's services",
    });

    expect(result.provider).toBe("parallel");
    expect(result.text).toContain("Example provides commercial insurance services");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.parallel.ai/v1/extract");
    expect(JSON.parse(String(init.body))).toEqual({
      urls: ["https://example.com/about"],
      objective: "Verify the company's services",
      max_chars_total: 12_000,
    });
  });

  test("retains Exa as a fallback when Parallel returns no content", async () => {
    vi.stubEnv("PARALLEL_API_KEY", "parallel-test-key");
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("api.parallel.ai")) {
        return jsonResponse({ error: { message: "Unavailable" } }, 503);
      }
      return jsonResponse({
        results: [
          {
            url: "https://example.com/exa",
            title: "Exa fallback",
            text: "Fallback evidence",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runWebRetrieval(actionContext(), orgId, {
      query: "fallback query",
    });

    expect(result.provider).toBe("exa");
    expect(result.text).toContain("Fallback evidence");
    expect(result.attempts).toEqual([
      { provider: "parallel", ok: false, error: "No useful content" },
      { provider: "exa", ok: true },
    ]);
  });
});
