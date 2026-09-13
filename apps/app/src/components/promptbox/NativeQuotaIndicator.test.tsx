import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ThreadNativeQuotaResponse } from "@bb/server-contract";
import { NativeQuotaIndicator, nativeQuotaTitle } from "./NativeQuotaIndicator";

function quota(remaining: number): ThreadNativeQuotaResponse {
  return {
    supported: true,
    status: "ok",
    fiveHour: { usedPercentage: 100 - remaining, remainingPercentage: remaining, nextResetTime: "2026-09-07T21:44:03.428Z" },
    toolCalls: { used: 18, total: 1000, remaining: 982, percentage: 1, nextResetTime: null },
    fetchedAt: "2026-09-07T19:13:10.505Z",
    reason: null,
  };
}

describe("NativeQuotaIndicator", () => {
  it("does not present stale cached quota as current after a request failure", () => {
    for (const value of [undefined, quota(72)]) {
      const markup = renderToStaticMarkup(<NativeQuotaIndicator quota={value} error />);
      expect(markup).toContain("Квота: н/д");
      expect(markup).not.toContain("72%");
      expect(markup).toContain("Не удалось обновить");
    }
  });
  it.each([72, 0])("shows remaining %s rather than used or tool-call quota", (remaining) => {
    const value = quota(remaining);
    const markup = renderToStaticMarkup(<NativeQuotaIndicator quota={value} />);
    expect(markup).toContain(`Квота 5ч: ${remaining}%`);
    expect(nativeQuotaTitle(value)).toContain(`осталось ${remaining}%`);
    expect(nativeQuotaTitle(value)).toContain("18 из 1000");
    expect(nativeQuotaTitle(value)).toContain("отдельно от контекста");
  });

  it("does not turn missing information into a zero-percent quota", () => {
    const value: ThreadNativeQuotaResponse = { supported: true, status: "unavailable", fiveHour: null, toolCalls: null, fetchedAt: null, reason: "Host offline" };
    const markup = renderToStaticMarkup(<NativeQuotaIndicator quota={value} />);
    expect(markup).toContain("Квота: н/д");
    expect(markup).toContain("Host offline");
    expect(markup).not.toContain("0%");
    expect(renderToStaticMarkup(<NativeQuotaIndicator quota={{ ...value, supported: false }} />)).toBe("");
  });
});
