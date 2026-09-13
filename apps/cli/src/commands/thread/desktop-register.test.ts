import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadDesktopRegisterResponse } from "@bb/server-contract";
import { printDesktopRegister } from "./desktop-register.js";

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

function response(
  outcome: ThreadDesktopRegisterResponse["outcome"],
): ThreadDesktopRegisterResponse {
  return {
    supported: true,
    nativeSessionId: "sess_test",
    outcome,
    reason:
      outcome.status === "rejected" || outcome.status === "unavailable"
        ? outcome.reason
        : null,
  };
}

describe("printDesktopRegister", () => {
  it("prints a preflight without claiming a write", () => {
    printDesktopRegister(
      response({
        status: "preflight_ok",
        title: "Native session title",
        workspacePath: "C:\\test",
        provider: "glm",
        mode: "build",
        model: "zai/glm-5.3",
        createdAt: 1788779406621,
        updatedAt: 1788923731869,
      }),
    );
    expect(logs).toContain("Native session: sess_test");
    expect(logs).toContain("Desktop registration: not registered (preflight)");
    expect(logs).toContain("  Would write title: Native session title");
    expect(logs).toContain("  Model: zai/glm-5.3");
    expect(logs.some((l) => l.includes("--apply"))).toBe(true);
  });

  it("prints the backup path after an applied registration", () => {
    printDesktopRegister(
      response({
        status: "registered",
        title: "Native session title",
        workspacePath: "C:\\test",
        provider: "glm",
        backupPath: "C:\\test\\tasks-index.sqlite.bb-backup-test",
      }),
    );
    expect(logs).toContain("Desktop registration: registered");
    expect(logs).toContain(
      "  Backup: C:\\test\\tasks-index.sqlite.bb-backup-test",
    );
  });

  it("prints idempotent already_registered and rejections with reasons", () => {
    printDesktopRegister(
      response({
        status: "already_registered",
        title: "Existing",
        workspacePath: "C:\\test",
        provider: "glm",
      }),
    );
    expect(logs).toContain("Desktop registration: already registered");

    printDesktopRegister(
      response({
        status: "rejected",
        reason: "Workspace mismatch: different directories",
      }),
    );
    expect(logs).toContain(
      "Desktop registration: rejected — Workspace mismatch: different directories",
    );
  });

  it("prints unsupported with reason", () => {
    const unsupported: ThreadDesktopRegisterResponse = {
      supported: false,
      nativeSessionId: null,
      outcome: {
        status: "unavailable",
        reason: "Desktop registration requires the ZCode provider",
      },
      reason: "Desktop registration requires the ZCode provider",
    };
    printDesktopRegister(unsupported);
    expect(logs[0]).toContain("ZCode provider");
  });
});
