import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { transcribeAudioForOrg } from "./models";

describe("audio transcription routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test("uses the broker voice route and sends a bounded multipart request", async () => {
    const runQuery = vi.fn(async () => ({
      routes: {
        voice_transcription: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
      routeSources: { voice_transcription: "broker" },
      providerKeys: { openai: "test-openai-key" },
    }));
    const fetchMock = vi.fn(async () =>
      Response.json({ text: "Transcribed request." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudioForOrg(
      { runQuery } as never,
      "org-1" as Id<"organizations">,
      {
        data: Buffer.from("voice"),
        filename: "Audio Message.caf",
        mediaType: "audio/mp4",
        prompt: "Preserve insurance terminology.",
      },
    );

    expect(result).toMatchObject({
      text: "Transcribed request.",
      route: {
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
      },
      routeSource: "broker",
      transport: "direct",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers).toEqual({
      Authorization: "Bearer test-openai-key",
    });
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("prompt")).toBe("Preserve insurance terminology.");
    expect((form.get("file") as File).name).toBe("Audio Message.m4a");
  });

  test("rejects a successful response without a JSON transcript", async () => {
    const runQuery = vi.fn(async () => ({
      routes: {
        voice_transcription: {
          provider: "openai",
          model: "gpt-4o-transcribe",
        },
      },
      routeSources: { voice_transcription: "broker" },
      providerKeys: { openai: "test-openai-key" },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Transcribed request.", { status: 200 })),
    );

    await expect(
      transcribeAudioForOrg(
        { runQuery } as never,
        "org-1" as Id<"organizations">,
        {
          data: Buffer.from("voice"),
          filename: "Audio Message.m4a",
          mediaType: "audio/mp4",
        },
      ),
    ).rejects.toThrow("returned invalid JSON");
  });

  test("uses cl-router when voice transcription is explicitly enabled", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "voice_transcription");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const runQuery = vi.fn(async () => ({
      routes: {
        voice_transcription: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
      routeSources: { voice_transcription: "broker" },
      providerKeys: { openai: "test-openai-key" },
    }));
    const fetchMock = vi.fn(async () => Response.json({
      requestId: "request-1",
      model: { provider: "openai", model: "gpt-4o-mini-transcribe" },
      routing: {
        decision: "snapshot",
        candidatesConsidered: [
          { provider: "openai", model: "gpt-4o-mini-transcribe" },
        ],
        policyVersion: "policy-v1",
        cacheStickinessApplied: false,
        routeSource: "broker",
        attemptCount: 1,
      },
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      costUsd: 0.001,
      costStatus: "priced",
      text: "Router transcript.",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudioForOrg(
      { runQuery } as never,
      "org-1" as Id<"organizations">,
      {
        data: Buffer.from("voice"),
        filename: "Audio Message.caf",
        mediaType: "audio/mp4",
      },
    );

    expect(result).toMatchObject({
      text: "Router transcript.",
      route: { provider: "openai", model: "gpt-4o-mini-transcribe" },
      routeSource: "broker",
      transport: "cl-router",
      clRouter: { requestId: "request-1", costUsd: 0.001 },
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://router.example.test/v1/transcribe",
    );
  });

  test("falls back to direct transcription after a router 5xx", async () => {
    vi.stubEnv("CL_ROUTER_TASKS", "voice_transcription");
    vi.stubEnv("CL_ROUTER_URL", "https://router.example.test");
    vi.stubEnv("CL_ROUTER_SECRET", "router-secret");
    const runQuery = vi.fn(async () => ({
      routes: {
        voice_transcription: {
          provider: "openai",
          model: "gpt-4o-mini-transcribe",
        },
      },
      routeSources: { voice_transcription: "broker" },
      providerKeys: { openai: "test-openai-key" },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ text: "Direct transcript." }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudioForOrg(
      { runQuery } as never,
      "org-1" as Id<"organizations">,
      {
        data: Buffer.from("voice"),
        filename: "Audio Message.m4a",
        mediaType: "audio/mp4",
      },
    );

    expect(result).toMatchObject({
      text: "Direct transcript.",
      transport: "direct",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://router.example.test/v1/transcribe",
      "https://api.openai.com/v1/audio/transcriptions",
    ]);
    expect(runQuery).toHaveBeenCalledOnce();
  });
});
