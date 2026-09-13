import { describe, expect, it } from "vitest";
import { resolveNativeContextWindow } from "./native-context-window";

const bbUsage = {
  usedTokens: 324872,
  modelContextWindow: 1000000,
  estimated: true,
};
const sample = {
  usedTokens: 492810,
  observedAt: "2026-09-07T08:26:14.293Z",
  model: "claude-fable-5-1",
};
const args = {
  enabled: true,
  providerName: "Claude Code",
  sample,
  bbUsage,
  selectedModel: sample.model,
};

describe("native context window", () => {
  it("matches Z.ai GLM names without borrowing another model's window", () => {
    const native = {
      ...sample,
      model: "builtin:zai-coding-plan/GLM-5.3",
      usedTokens: 767140,
      contextWindow: null,
    };
    const result = resolveNativeContextWindow({
      ...args,
      sample: native,
      selectedModel: "zai/GLM-5.3",
    });
    expect(result.usage?.modelContextWindow).toBe(1000000);
    expect(result.usage?.usedTokens).toBe(767140);
    expect(result.note).toContain("источник builtin:zai-coding-plan/GLM-5.3");
    for (const selectedModel of ["zai/GLM-5.3-Flash", "other/glm-5.3"]) {
      expect(
        resolveNativeContextWindow({ ...args, sample: native, selectedModel })
          .usage,
      ).toBeNull();
    }
  });
  it.each([false, true])(
    "uses the established 1M window for GLM-5.3 Flash while running=%s",
    (running) => {
      const result = resolveNativeContextWindow({
        ...args,
        running,
        bbUsage: {
          usedTokens: 124493,
          modelContextWindow: 200000,
          estimated: false,
        },
        sample: {
          usedTokens: 124493,
          observedAt: "2026-09-09T06:44:37.000Z",
          model: "zai/GLM-5.3-Flash",
          contextWindow: null,
        },
        selectedModel: "zai/GLM-5.3-Flash",
      });

      expect(result.usage?.modelContextWindow).toBe(1000000);
      expect(result.usage?.usedTokens).toBe(124493);
    },
  );
  it.each([true, false])(
    "does not present an inconsistent bb window as full while running=%s",
    (running) => {
      const result = resolveNativeContextWindow({
        ...args,
        running,
        bbUsage: {
          usedTokens: 757031,
          modelContextWindow: 200000,
          estimated: false,
        },
        sample: { ...sample, usedTokens: 757031, contextWindow: null },
      });
      expect(result.usage).toBeNull();
      expect(result.tokenLabel).toBe(
        `Контекст: ${(757031).toLocaleString()} ток.`,
      );
      expect(result.note).toContain("противореч");
    },
  );
  it("shows measured tokens without inventing an unknown window or percentage", () => {
    for (const usedTokens of [0, 20330]) {
      const result = resolveNativeContextWindow({
        ...args,
        bbUsage: null,
        sample: { ...sample, usedTokens },
      });
      expect(result.usage).toBeNull();
      expect(result.tokenLabel).toBe(
        `Контекст: ${usedTokens.toLocaleString()} ток.`,
      );
      expect(result.note).toContain("процент не рассчитан");
    }
    expect(
      resolveNativeContextWindow({ ...args, sample: null }).tokenLabel,
    ).toBeUndefined();
  });
  it("uses the latest native request rather than old bb usage and labels the source", () => {
    const result = resolveNativeContextWindow(args);
    expect(result.usage).toEqual({ ...bbUsage, usedTokens: 492810 });
    expect(result.note).toContain(
      "Замер последнего запроса по данным провайдера",
    );
    expect(result.note).not.toContain("входных токенов");
    expect(result.note).toContain("процент оценочный");
  });
  it("prefers the natively confirmed context window over the bb model window", () => {
    const result = resolveNativeContextWindow({
      ...args,
      sample: { ...sample, contextWindow: 258400 },
      selectedModel: "another-model",
    });
    expect(result.usage).toEqual({
      usedTokens: 492810,
      modelContextWindow: 258400,
      estimated: true,
    });
    expect(result.note).toContain("Окно подтверждено нативным замером");
  });
  it("does not reuse a stale bb percentage when the native sample is missing", () => {
    expect(
      resolveNativeContextWindow({ ...args, sample: null }).usage,
    ).toBeNull();
  });
  it("does not reuse another model's window size", () => {
    expect(
      resolveNativeContextWindow({ ...args, selectedModel: "another-model" })
        .usage,
    ).toBeNull();
    expect(
      resolveNativeContextWindow({ ...args, bbUsage: null }).usage,
    ).toBeNull();
  });
  it("keeps a known zero and labels a failed refresh without pretending it is live", () => {
    const result = resolveNativeContextWindow({
      ...args,
      sample: { ...sample, usedTokens: 0 },
      failed: true,
    });
    expect(result.usage?.usedTokens).toBe(0);
    expect(result.note).toContain("Сохранённый замер");
  });
  it("preserves other providers and uses live bb events during an active turn", () => {
    expect(resolveNativeContextWindow({ ...args, enabled: false })).toEqual({
      usage: bbUsage,
      note: null,
      sourceLabel: null,
    });
    expect(
      resolveNativeContextWindow({ ...args, running: true }).usage,
    ).toEqual(bbUsage);
  });
  it("labels the measurement source and observation time", () => {
    const time = new Date(sample.observedAt).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(resolveNativeContextWindow(args).sourceLabel).toBe(time);
    expect(
      resolveNativeContextWindow({ ...args, running: true }).sourceLabel,
    ).toBe("bb");
    expect(
      resolveNativeContextWindow({ ...args, sample: null }).sourceLabel,
    ).toBeNull();
    expect(
      resolveNativeContextWindow({
        ...args,
        sample: { ...sample, observedAt: null },
      }).sourceLabel,
    ).toBeNull();
    expect(
      resolveNativeContextWindow({
        ...args,
        running: true,
        bbUsage: {
          usedTokens: 757031,
          modelContextWindow: 200000,
          estimated: false,
        },
        sample: { ...sample, usedTokens: 757031, contextWindow: null },
      }).sourceLabel,
    ).toBe("bb");
    expect(
      resolveNativeContextWindow({
        ...args,
        bbUsage: {
          usedTokens: 757031,
          modelContextWindow: 200000,
          estimated: false,
        },
        sample: { ...sample, usedTokens: 757031, contextWindow: null },
      }).sourceLabel,
    ).toBe(time);
  });
  it("uses the post-compact native sample instead of the stale pre-compact bb usage", () => {
    const result = resolveNativeContextWindow({
      ...args,
      bbUsage: {
        usedTokens: 705463,
        modelContextWindow: 1000000,
        estimated: false,
      },
      sample: {
        usedTokens: 104663,
        observedAt: "2026-09-09T01:32:03.000Z",
        model: "zai/glm-5.3",
        contextWindow: null,
      },
      selectedModel: "zai/GLM-5.3",
    });
    expect(result.usage).toEqual({
      usedTokens: 104663,
      modelContextWindow: 1000000,
      estimated: true,
    });
    expect(result.note).toContain(
      "Замер последнего запроса по данным провайдера",
    );
    expect(result.note).not.toContain("противореч");
    expect(
      resolveNativeContextWindow({
        ...args,
        running: true,
        bbUsage: {
          usedTokens: 104663,
          modelContextWindow: 1000000,
          estimated: false,
        },
        sample: {
          usedTokens: 104663,
          observedAt: "2026-09-09T01:32:03.000Z",
          model: "zai/glm-5.3",
          contextWindow: null,
        },
        selectedModel: "zai/GLM-5.3",
      }),
    ).toEqual({
      usage: {
        usedTokens: 104663,
        modelContextWindow: 1000000,
        estimated: false,
      },
      sourceLabel: "bb",
      note: expect.stringContaining("Агент работает"),
    });
  });
});
