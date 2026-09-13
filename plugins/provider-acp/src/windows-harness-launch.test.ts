import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_ACP_AGENTS } from "./known-agents.js";

describe.skipIf(process.platform !== "win32")("Windows Harness launch", () => {
  it("uses an explicit executable and inherited credentials outside the global npm layout", () => {
    const root = mkdtempSync(join(tmpdir(), "bb harness "));
    try {
      const command = join(root, "fixture.cmd");
      writeFileSync(
        command,
        '@echo off\r\nif not "%DEEPSEEK_API_KEY%"=="bb-smoke-fixture" exit /b 9\r\nif not "%1 %2"=="--profile acp" exit /b 8\r\nexit /b 7\r\n',
      );
      const agent = KNOWN_ACP_AGENTS.find(
        (candidate) => candidate.id === "acp-deepseek-harness",
      );
      expect(agent).toBeDefined();
      if (!agent) throw new Error("Harness missing");
      const result = spawnSync(agent.launch.command, agent.launch.args, {
        env: {
          ...process.env,
          DEEPSEEK_API_KEY: "bb-smoke-fixture",
          BB_DEEPSEEK_HARNESS_EXECUTABLE: command,
        },
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(7);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
