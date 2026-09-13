import { describe, expect, it } from "vitest";
import { describeRateLimitSchedule } from "./queued-message-wait";

describe("rate limit schedule", () => {
  it("does not invent a reset when no retry is scheduled", () => {
    expect(describeRateLimitSchedule(1000, null)).toContain("не назначено");
  });
  it("does not claim a retry has started when its time arrives", () => {
    expect(describeRateLimitSchedule(1000, 999)).toContain("ожидаем запуска");
  });
  it("shows hours and minutes, rounding up partial minutes", () => {
    expect(describeRateLimitSchedule(1000, 1000 + 7200001)).toContain("2 ч 1 мин");
  });
});
