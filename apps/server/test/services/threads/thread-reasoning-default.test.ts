import { describe, expect, it } from "vitest";
import type { ReasoningLevel } from "@bb/domain";
import { DEFAULT_REASONING_LEVEL } from "../../../src/services/threads/thread-default-policy.js";
import {
  resolveDefaultReasoningLevel,
} from "../../../src/services/threads/thread-execution-plan.js";

function levels(...values: ReasoningLevel[]): readonly ReasoningLevel[] {
  return values;
}

describe("resolveDefaultReasoningLevel", () => {
  it("returns the bb default when the provider supports it", () => {
    expect(
      resolveDefaultReasoningLevel(
        DEFAULT_REASONING_LEVEL,
        levels("low", "medium", "high", "xhigh", "max"),
      ),
    ).toBe("medium");
  });

  it("picks the closest supported level when the default is unsupported", () => {
    expect(
      resolveDefaultReasoningLevel(DEFAULT_REASONING_LEVEL, levels("low", "high", "max")),
    ).toBe("high");
  });

  it("falls through the preference order to the first supported level", () => {
    expect(
      resolveDefaultReasoningLevel(DEFAULT_REASONING_LEVEL, levels("ultracode")),
    ).toBe("ultracode");
  });

  it("returns the default when no supported levels are declared", () => {
    expect(
      resolveDefaultReasoningLevel(DEFAULT_REASONING_LEVEL, levels()),
    ).toBe("medium");
  });

  it("prefers high over low when both are supported but medium is not", () => {
    expect(
      resolveDefaultReasoningLevel(DEFAULT_REASONING_LEVEL, levels("low", "high")),
    ).toBe("high");
    expect(
      resolveDefaultReasoningLevel(DEFAULT_REASONING_LEVEL, levels("low", "max")),
    ).toBe("max");
  });
});
