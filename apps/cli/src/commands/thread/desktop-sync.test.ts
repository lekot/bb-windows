import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadDesktopSyncResponse } from "@bb/server-contract";
import { printDesktopSync } from "./desktop-sync.js";

const logs: string[] = [];
const originalLog = console.log;

beforeEach(() => {
  logs.length = 0;
  console.log = vi.fn((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  console.log = originalLog;
});

describe("printDesktopSync", () => {
  it("prints native session, history, and desktop registration", () => {
    const sync: ThreadDesktopSyncResponse = {
      supported: true,
      nativeSessionId: "sess_test",
      nativeHistoryStatus: "ok",
      lastNativeMessageAt: "2026-09-08T13:00:00Z",
      desktopStatus: "registered",
      desktopTitle: "My session",
      desktopWorkspacePath: "C:/test",
      reason: null,
    };
    printDesktopSync(sync);
    expect(logs).toContain("Native session: sess_test");
    expect(logs.some((l) => l.includes("last message"))).toBe(true);
    expect(logs).toContain("Desktop registration: registered");
    expect(logs).toContain("  Title: My session");
  });

  it("prints unsupported with reason", () => {
    const sync: ThreadDesktopSyncResponse = {
      supported: false,
      nativeSessionId: null,
      nativeHistoryStatus: "unavailable",
      lastNativeMessageAt: null,
      desktopStatus: "unavailable",
      desktopTitle: null,
      desktopWorkspacePath: null,
      reason: "Desktop sync diagnostics are not available for this thread.",
    };
    printDesktopSync(sync);
    expect(logs[0]).toContain("not available");
  });

  it("prints not_registered without crashing", () => {
    const sync: ThreadDesktopSyncResponse = {
      supported: true,
      nativeSessionId: "sess_test",
      nativeHistoryStatus: "ok",
      lastNativeMessageAt: null,
      desktopStatus: "not_registered",
      desktopTitle: null,
      desktopWorkspacePath: null,
      reason: null,
    };
    printDesktopSync(sync);
    expect(logs).toContain("Desktop registration: not registered");
  });
});
