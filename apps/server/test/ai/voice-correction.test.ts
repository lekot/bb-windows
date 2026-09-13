import { describe, expect, it, vi } from "vitest";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("voice correction", () => {
  it("reports disabled correction and rejects requests when no endpoint is configured", async () => {
    const harness = await createTestAppHarness({ voiceCorrectionUrl: "" });
    try {
      const configResponse = await harness.app.request("/api/v1/system/config");
      await expect(configResponse.json()).resolves.toMatchObject({
        voiceCorrectionEnabled: false,
      });
      const response = await harness.app.request(
        "/api/v1/system/voice-correction",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "сырой текст" }),
        },
      );
      expect(response.status).toBe(501);
      await expect(response.json()).resolves.toMatchObject({
        code: "not_configured",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("sends only the transcript to the configured model and returns its correction", async () => {
    const harness = await createTestAppHarness({
      voiceCorrectionApiKey: "test-key",
      voiceCorrectionModel: "glm-5.3-flash",
      voiceCorrectionUrl: "https://router.example.test/v1/chat/completions",
    });
    const fetchStub = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Исправленный текст." } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      const response = await harness.app.request(
        "/api/v1/system/voice-correction",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "исправленый текст" }),
        },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        corrected: true,
        text: "Исправленный текст.",
      });
      const [url, init] = fetchStub.mock.calls[0]!;
      expect(url).toBe("https://router.example.test/v1/chat/completions");
      expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string; role: string }>;
        model: string;
      };
      expect(body.model).toBe("glm-5.3-flash");
      expect(body.messages.at(-1)).toEqual({
        role: "user",
        content: "исправленый текст",
      });
    } finally {
      vi.unstubAllGlobals();
      await harness.cleanup();
    }
  });

  it("keeps raw text when the provider returns implausibly long output", async () => {
    const harness = await createTestAppHarness({
      voiceCorrectionModel: "glm-5.3-flash",
      voiceCorrectionUrl: "https://router.example.test/v1/chat/completions",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "x".repeat(220) } }],
            }),
            { status: 200 },
          ),
      ),
    );
    try {
      const response = await harness.app.request(
        "/api/v1/system/voice-correction",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "raw" }),
        },
      );
      await expect(response.json()).resolves.toEqual({
        corrected: false,
        text: "raw",
      });
    } finally {
      vi.unstubAllGlobals();
      await harness.cleanup();
    }
  });
});
