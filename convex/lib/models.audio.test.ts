import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { transcribeAudioForOrg } from "./models";

function routerStorage() {
  return {
    store: vi.fn(async () => "storage-audio-1"),
    getUrl: vi.fn(async () => "https://merry-platypus-82.convex.cloud/api/storage/audio"),
    delete: vi.fn(async () => undefined),
  };
}

describe("audio transcription routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
    const storage = routerStorage();
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
      { runQuery, storage } as never,
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
    const request = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(request.audio).toEqual({
      url: "https://merry-platypus-82.convex.cloud/api/storage/audio",
      mediaType: "audio/mp4",
      filename: "Audio Message.m4a",
      sizeBytes: 5,
    });
    expect(storage.delete).toHaveBeenCalledWith("storage-audio-1");
  });

  test("falls back to direct transcription after a typed pre-execution production outage", async () => {
    vi.stubEnv("SPOT_ENV", "production");
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
    const storage = routerStorage();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({
        error: {
          code: "router_unavailable",
          message: "No eligible route is available.",
          retryable: true,
          executionStarted: false,
          requestId: "failed-transcription-request",
        },
      }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ text: "Direct transcript." }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudioForOrg(
      { runQuery, storage } as never,
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
    expect(storage.delete).toHaveBeenCalledWith("storage-audio-1");
  });
});
