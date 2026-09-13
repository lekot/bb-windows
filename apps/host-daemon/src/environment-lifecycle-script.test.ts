import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildLifecycleScriptCommand,
  runSetupScript,
  runTeardownScript,
} from "./environment-lifecycle-script.js";

const directories: string[] = [];
async function workspace(
  kind: "setup" | "teardown",
  script: string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "bb-core-hooks-"));
  directories.push(directory);
  await writeFile(join(directory, `.bb-env-${kind}.sh`), script);
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("core environment scripts", () => {
  it.each(["setup", "teardown"] as const)(
    "supplies stdin EOF so %s continues to completion",
    async (kind) => {
      const workspacePath = await workspace(
        kind,
        'cat >/dev/null\nprintf complete > marker\nprintf "\\342"\nsleep 0.05\nprintf "\\234\\223\\n"\nprintf "done\\n" >&2\n',
      );
      const output: string[] = [];
      const run = kind === "setup" ? runSetupScript : runTeardownScript;
      const result = await run({
        workspacePath,
        timeoutMs: 5000,
        env: { PATH: "/usr/bin:/bin" },
        onProgress: (entry) => output.push(entry.text),
      });
      expect(result).toEqual({ ran: true });
      expect(await readFile(join(workspacePath, "marker"), "utf8")).toBe(
        "complete",
      );
      if (kind === "setup") expect(output).toContain("✓");
      expect(output).toContain("done");
    },
  );

  it("runs in the environment directory and streams stdout and stderr", async () => {
    const workspacePath = await workspace(
      "setup",
      "pwd > marker\nprintf 'first\\rsecond\\n'\necho stderr >&2\n",
    );
    const output: string[] = [];
    await runSetupScript({
      workspacePath,
      timeoutMs: 5000,
      onProgress: (entry) => output.push(entry.text),
    });
    const markerPath = (await readFile(join(workspacePath, "marker"), "utf8"))
      .trim()
      .replace(/^\/([a-zA-Z])\//, "$1:/");
    expect(markerPath.split("/").at(-1)?.toLowerCase()).toBe(
      (await realpath(workspacePath))
        .replaceAll("\\", "/")
        .split("/")
        .at(-1)
        ?.toLowerCase(),
    );
    expect(output).toContain("second");
    expect(output).toContain("stderr");
    expect(output).toContain("Running .bb-env-setup.sh");
  });

  it("surfaces output before setup failure", async () => {
    const workspacePath = await workspace(
      "setup",
      "echo failed-details >&2\nexit 7\n",
    );
    const output: string[] = [];
    await expect(
      runSetupScript({
        workspacePath,
        timeoutMs: 5000,
        onProgress: (entry) => output.push(entry.text),
      }),
    ).rejects.toThrow("exit code 7");
    expect(output).toContain("failed-details");
  });

  it.each(["setup", "teardown"] as const)(
    "enforces the %s timeout",
    async (kind) => {
      const workspacePath = await workspace(
        kind,
        "echo before-timeout\nwhile :; do :; done\n",
      );
      const output: string[] = [];
      const run = kind === "setup" ? runSetupScript : runTeardownScript;
      const result = run({
        workspacePath,
        timeoutMs: 100,
        onProgress: (entry) => output.push(entry.text),
      });
      if (kind === "setup")
        await expect(result).rejects.toThrow("timed out after 100ms");
      else {
        await expect(result).resolves.toEqual({ ran: true });
        expect(output.join("\n")).toContain("timed out after 100ms");
      }
    },
  );

  it("reports teardown failure without rejecting removal", async () => {
    const workspacePath = await workspace(
      "teardown",
      "echo teardown-details\nexit 9\n",
    );
    const output: string[] = [];
    await expect(
      runTeardownScript({
        workspacePath,
        timeoutMs: 5000,
        onProgress: (entry) => output.push(entry.text),
      }),
    ).resolves.toEqual({ ran: true });
    expect(output.join("\n")).toContain("exit code 9");
    expect(output).toContain("teardown-details");
  });

  it("cancels a running setup before returning to cleanup", async () => {
    const workspacePath = await workspace(
      "setup",
      "echo started\nwhile :; do :; done\n",
    );
    const controller = new AbortController();
    await expect(
      runSetupScript({
        workspacePath,
        timeoutMs: 5000,
        signal: controller.signal,
        onProgress: (entry) => {
          if (entry.text === "started") controller.abort();
        },
      }),
    ).rejects.toThrow("cancelled");
  });

  it.each(["setup", "teardown"] as const)(
    "reports a missing Git Bash for a Windows %s hook",
    (kind) => {
      expect(() =>
        buildLifecycleScriptCommand({
          kind,
          scriptName: `.bb-env-${kind}.sh`,
          platform: "win32",
          scriptPath: `.bb-env-${kind}.sh`,
          windowsBashPath: null,
        }),
      ).toThrow(`Git Bash is required to run ${kind} script`);
    },
  );

  it("skips absent scripts", async () => {
    const workspacePath = await workspace("setup", "exit 0\n");
    await expect(
      runTeardownScript({ workspacePath, timeoutMs: 5000 }),
    ).resolves.toEqual({ ran: false });
  });
});
