import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { readSyncHook } = vi.hoisted(() => ({
  readSyncHook: { current: null as null | (() => void) },
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: actual,
    readSync: (...args: Parameters<typeof actual.readSync>) => {
      const hook = readSyncHook.current;
      if (hook) {
        readSyncHook.current = null;
        hook();
      }
      return actual.readSync(...args);
    },
  };
});

import { readClaudeNativeSessionSettings } from "./native-settings.js";

const SESSION_ID = "01a07f45-4865-7be1-8c98-d56567822218";
const OTHER_SESSION_ID = "99999999-4865-7be1-8c98-d56567822218";

const tempDirs: string[] = [];

interface RecordArgs {
  effort?: unknown;
  isApiErrorMessage?: boolean;
  isSidechain?: boolean;
  model?: unknown;
  permissionMode?: unknown;
  role: "user" | "assistant";
  sessionId?: string;
  uuid: string;
}

function record(args: RecordArgs): string {
  return JSON.stringify({
    type: args.role,
    sessionId: args.sessionId ?? SESSION_ID,
    uuid: args.uuid,
    isSidechain: args.isSidechain ?? false,
    ...(args.isApiErrorMessage === true ? { isApiErrorMessage: true } : {}),
    timestamp: "2026-09-08T05:00:00.000Z",
    ...(args.permissionMode !== undefined
      ? { permissionMode: args.permissionMode }
      : {}),
    ...(args.effort !== undefined ? { effort: args.effort } : {}),
    message:
      args.role === "assistant"
        ? {
            role: "assistant",
            ...(args.model !== undefined ? { model: args.model } : {}),
            content: [{ type: "text", text: "reply" }],
          }
        : { role: "user", content: "prompt" },
  });
}

interface SeedArgs {
  lines: string[];
  sessionId?: string;
}

interface Seeded {
  cwd: string;
  env: NodeJS.ProcessEnv;
  transcriptPath: string;
}

function projectDirectoryName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function seed(args: SeedArgs): Seeded {
  const configDir = mkdtempSync(join(tmpdir(), "bb-claude-cfg-"));
  tempDirs.push(configDir);
  const cwd = mkdtempSync(join(tmpdir(), "bb-claude-cwd-"));
  tempDirs.push(cwd);
  const projectDir = join(configDir, "projects", projectDirectoryName(cwd));
  mkdirSync(projectDir, { recursive: true });
  const transcriptPath = join(
    projectDir,
    `${args.sessionId ?? SESSION_ID}.jsonl`,
  );
  writeFileSync(transcriptPath, `${args.lines.join("\n")}\n`, "utf8");
  return { cwd, env: { CLAUDE_CONFIG_DIR: configDir }, transcriptPath };
}

function completeLines(): string[] {
  return [
    record({ role: "user", uuid: "u-1", permissionMode: "acceptEdits" }),
    record({
      role: "assistant",
      uuid: "a-1",
      model: "claude-sonnet-4-6",
      effort: "medium",
    }),
    record({ role: "user", uuid: "u-2", permissionMode: "dontAsk" }),
    record({
      role: "assistant",
      uuid: "a-2",
      model: "claude-opus-5",
      effort: "xhigh",
    }),
  ];
}

afterEach(() => {
  readSyncHook.current = null;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readClaudeNativeSessionSettings", () => {
  it("returns the newest in-session model, permission mode and effort", () => {
    const seeded = seed({ lines: completeLines() });
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "settings",
      settings: {
        effort: "xhigh",
        model: "claude-opus-5",
        permissionMode: "dontAsk",
      },
    });
  });

  it("ignores sidechain, foreign-session and API error records", () => {
    const seeded = seed({
      lines: [
        ...completeLines(),
        record({
          role: "assistant",
          uuid: "a-sidechain",
          model: "claude-haiku-4-5",
          effort: "low",
          isSidechain: true,
        }),
        record({
          role: "user",
          uuid: "u-foreign",
          permissionMode: "bypassPermissions",
          sessionId: OTHER_SESSION_ID,
        }),
        record({
          role: "assistant",
          uuid: "a-synthetic",
          model: "<synthetic>",
          effort: null,
          isApiErrorMessage: true,
        }),
      ],
    });
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "settings",
      settings: {
        effort: "xhigh",
        model: "claude-opus-5",
        permissionMode: "dontAsk",
      },
    });
  });

  it("skips a synthetic model marker without treating it as a model change", () => {
    const seeded = seed({
      lines: [
        ...completeLines(),
        record({ role: "assistant", uuid: "a-synth", model: "<synthetic>" }),
      ],
    });
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toMatchObject({ settings: { model: "claude-opus-5" } });
  });

  it("treats a null field as absent rather than unrecognized", () => {
    const seeded = seed({
      lines: [
        ...completeLines(),
        record({
          role: "assistant",
          uuid: "a-null",
          effort: null,
          permissionMode: null,
        }),
      ],
    });
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toMatchObject({
      settings: { effort: "xhigh", permissionMode: "dontAsk" },
    });
  });

  it("fails closed on an unrecognized newest permission mode", () => {
    const seeded = seed({
      lines: [
        ...completeLines(),
        record({ role: "user", uuid: "u-3", permissionMode: "someNewMode" }),
      ],
    });
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "unreadable",
      reason: 'it records an unrecognized permission mode "someNewMode"',
    });
  });

  it("fails closed on an unrecognized newest reasoning effort", () => {
    const seeded = seed({
      lines: [
        ...completeLines(),
        record({ role: "assistant", uuid: "a-3", effort: "turbo" }),
      ],
    });
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "unreadable",
      reason: 'it records an unrecognized reasoning effort "turbo"',
    });
  });

  it("reports a missing effort as absent instead of substituting one", () => {
    const seeded = seed({
      lines: [
        record({ role: "user", uuid: "u-1", permissionMode: "dontAsk" }),
        record({ role: "assistant", uuid: "a-1", model: "claude-opus-5" }),
      ],
    });
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "settings",
      settings: {
        effort: null,
        model: "claude-opus-5",
        permissionMode: "dontAsk",
      },
    });
  });

  it("does not read a transcript belonging to another workspace", () => {
    const seeded = seed({ lines: completeLines() });
    const otherCwd = mkdtempSync(join(tmpdir(), "bb-claude-other-"));
    tempDirs.push(otherCwd);
    const result = readClaudeNativeSessionSettings({
      cwd: otherCwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "unreadable",
      reason: "bb found no transcript for it in this workspace",
    });
  });

  it("rejects a session id that is not a native session file name", () => {
    const seeded = seed({ lines: completeLines() });
    for (const sessionId of ["../escape", "not-a-uuid", ""]) {
      expect(
        readClaudeNativeSessionSettings({
          cwd: seeded.cwd,
          env: seeded.env,
          sessionId,
        }),
      ).toEqual({
        kind: "unreadable",
        reason: "bb cannot locate its transcript from this workspace and id",
      });
    }
  });

  it("never returns pre-truncation settings from a partial read", () => {
    const seeded = seed({ lines: completeLines() });
    readSyncHook.current = () => {
      truncateSync(seeded.transcriptPath, 10);
    };
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "settings",
      settings: { effort: null, model: null, permissionMode: null },
    });
  });

  it("rejects the snapshot when the transcript keeps changing under it", () => {
    const seeded = seed({ lines: completeLines() });
    let revision = 0;
    const mutate = (): void => {
      revision += 1;
      writeFileSync(
        seeded.transcriptPath,
        `${[
          ...completeLines(),
          record({
            role: "user",
            uuid: `u-churn-${"x".repeat(revision)}`,
            permissionMode: "acceptEdits",
          }),
        ].join("\n")}\n`,
        "utf8",
      );
      readSyncHook.current = mutate;
    };
    readSyncHook.current = mutate;
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "unreadable",
      reason: "its transcript kept changing while bb was reading it",
    });
  });

  it("retries once and accepts a stable snapshot after a single change", () => {
    const seeded = seed({ lines: completeLines() });
    readSyncHook.current = () => {
      writeFileSync(
        seeded.transcriptPath,
        `${[
          ...completeLines(),
          record({ role: "user", uuid: "u-4", permissionMode: "acceptEdits" }),
        ].join("\n")}\n`,
        "utf8",
      );
    };
    const result = readClaudeNativeSessionSettings({
      cwd: seeded.cwd,
      env: seeded.env,
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      kind: "settings",
      settings: {
        effort: "xhigh",
        model: "claude-opus-5",
        permissionMode: "acceptEdits",
      },
    });
  });
});
