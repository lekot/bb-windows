import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  codexNativePolicyResumeParams,
  readCodexNativePolicy,
} from "./native-policy.js";

const SESSION_ID = "01a07d99-2dc9-7112-b5d7-3fdd13e501f0";

let codexHome: string;
let workspaceDir: string;
let previousCodexHome: string | undefined;

function canonicalReadOnlyProfile(): Record<string, unknown> {
  return {
    type: "managed",
    file_system: {
      type: "restricted",
      entries: [
        { path: { type: "special", value: { kind: "root" } }, access: "read" },
      ],
    },
    network: "restricted",
  };
}

function markerEntries(roots: string[]): Array<Record<string, unknown>> {
  return [".git", ".agents", ".codex"].flatMap((marker) =>
    roots.map((root) => ({
      path: { type: "path", path: join(root, marker) },
      access: "read",
      missing_path_behavior: "skip",
    })),
  );
}

function standardWorkspaceWriteProfile(args: {
  networkAccess?: boolean;
  writableRoots: string[];
}): Record<string, unknown> {
  const roots = [workspaceDir, ...args.writableRoots];
  return {
    type: "managed",
    file_system: {
      type: "restricted",
      entries: [
        { path: { type: "special", value: { kind: "root" } }, access: "read" },
        ...roots.map((root) => ({
          path: { type: "path", path: root },
          access: "write",
        })),
        {
          path: { type: "special", value: { kind: "slash_tmp" } },
          access: "write",
        },
        { path: { type: "special", value: { kind: "tmpdir" } }, access: "write" },
        ...markerEntries(roots),
      ],
    },
    network: (args.networkAccess ?? true) ? "enabled" : "restricted",
  };
}

function standardWorkspaceWritePolicy(args: {
  networkAccess?: boolean;
  writableRoots: string[];
}): Record<string, unknown> {
  return {
    approval_policy: "on-request",
    approvals_reviewer: "user",
    sandbox_policy: {
      type: "workspace-write",
      writable_roots: args.writableRoots,
      network_access: args.networkAccess ?? true,
      exclude_tmpdir_env_var: false,
      exclude_slash_tmp: false,
    },
    permission_profile: standardWorkspaceWriteProfile(args),
  };
}

function profileEntries(
  policy: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const profile = policy.permission_profile as {
    file_system: { entries: Array<Record<string, unknown>> };
  };
  return profile.file_system.entries;
}

function withEntries(
  policy: Record<string, unknown>,
  entries: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    ...policy,
    permission_profile: {
      ...(policy.permission_profile as Record<string, unknown>),
      file_system: { type: "restricted", entries },
    },
  };
}

function readOnlyPolicy(): Record<string, unknown> {
  return {
    approval_policy: "never",
    approvals_reviewer: "user",
    sandbox_policy: { type: "read-only" },
    permission_profile: canonicalReadOnlyProfile(),
  };
}

function writeRollout(args: {
  cwd?: string;
  day?: string;
  sessionId?: string;
  turnContexts: Array<Record<string, unknown>>;
}): void {
  const day = args.day ?? "08";
  const dayDir = join(codexHome, "sessions", "2026", "09", day);
  mkdirSync(dayDir, { recursive: true });
  const sessionId = args.sessionId ?? SESSION_ID;
  const lines = [
    JSON.stringify({
      timestamp: "2026-09-08T03:39:45.000Z",
      type: "session_meta",
      payload: { id: sessionId, cwd: args.cwd ?? workspaceDir },
    }),
    ...args.turnContexts.map((payload, index) =>
      JSON.stringify({
        timestamp: `2026-09-08T03:4${index}:00.000Z`,
        ordinal: index,
        type: "turn_context",
        payload: {
          turn_id: `turn-${index}`,
          cwd: args.cwd ?? workspaceDir,
          ...payload,
        },
      }),
    ),
    "",
  ];
  writeFileSync(
    join(dayDir, `rollout-2026-09-08T03-39-45-${sessionId}.jsonl`),
    lines.join("\n"),
    "utf8",
  );
}

beforeEach(() => {
  codexHome = mkdtempSync(join(tmpdir(), "bb-codex-policy-home-"));
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-policy-cwd-"));
  previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
});

afterEach(() => {
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  rmSync(codexHome, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("readCodexNativePolicy", () => {
  it("takes the newest turn context and keeps the exact workspace-write policy", async () => {
    const writableRoot = join(workspaceDir, "writable");
    writeRollout({
      turnContexts: [
        readOnlyPolicy(),
        {
          approval_policy: "on-request",
          approvals_reviewer: "auto_review",
          sandbox_policy: {
            type: "workspace-write",
            writable_roots: [writableRoot],
            network_access: false,
            exclude_tmpdir_env_var: true,
            exclude_slash_tmp: false,
          },
          permission_profile: { type: "disabled" },
        },
      ],
    });

    const snapshot = await readCodexNativePolicy({
      cwd: workspaceDir,
      sessionId: SESSION_ID,
    });

    expect(snapshot).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      workspaceWrite: {
        writableRoots: [writableRoot],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: false,
      },
      permissionProfileType: "disabled",
    });
    expect(codexNativePolicyResumeParams(snapshot)).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandbox: "workspace-write",
      config: {
        "sandbox_workspace_write.writable_roots": [writableRoot],
        "sandbox_workspace_write.network_access": false,
        "sandbox_workspace_write.exclude_tmpdir_env_var": true,
        "sandbox_workspace_write.exclude_slash_tmp": false,
      },
    });
  });

  it("restores workspace-write when the native client omits empty writable roots", async () => {
    writeRollout({
      turnContexts: [{
        approval_policy: "never",
        approvals_reviewer: "user",
        sandbox_policy: {
          type: "workspace-write",
          network_access: false,
          exclude_tmpdir_env_var: false,
          exclude_slash_tmp: false,
        },
        permission_profile: standardWorkspaceWriteProfile({
          networkAccess: false,
          writableRoots: [],
        }),
      }],
    });
    const snapshot = await readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID });
    expect(snapshot.sandbox).toBe("workspace-write");
    expect(snapshot.workspaceWrite).toEqual({
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
    expect(snapshot.approvalPolicy).toBe("never");
  });

  it("keeps a read-only session read-only and adds no workspace-write config", async () => {
    writeRollout({ turnContexts: [readOnlyPolicy()] });

    const snapshot = await readCodexNativePolicy({
      cwd: workspaceDir,
      sessionId: SESSION_ID,
    });

    expect(snapshot.sandbox).toBe("read-only");
    expect(snapshot.workspaceWrite).toBeNull();
    expect(codexNativePolicyResumeParams(snapshot)).toEqual({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      sandbox: "read-only",
    });
  });

  it("preserves a granular approval policy verbatim", async () => {
    const granular = {
      granular: {
        sandbox_approval: true,
        rules: false,
        skill_approval: true,
        request_permissions: false,
        mcp_elicitations: true,
      },
    };
    writeRollout({
      turnContexts: [{ ...readOnlyPolicy(), approval_policy: granular }],
    });

    const snapshot = await readCodexNativePolicy({
      cwd: workspaceDir,
      sessionId: SESSION_ID,
    });

    expect(snapshot.approvalPolicy).toEqual(granular);
  });

  it("refuses a session recorded for another directory", async () => {
    writeRollout({ cwd: join(tmpdir(), "some-other-project"), turnContexts: [readOnlyPolicy()] });

    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/was not found/);
  });

  it("refuses to resume when the policy is missing, unreadable or wider than recorded", async () => {
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/refusing to resume with the machine's default policy/);

    writeRollout({ turnContexts: [] });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/no recorded turn context/);

    writeRollout({
      turnContexts: [
        {
          approval_policy: "never",
          approvals_reviewer: "user",
          sandbox_policy: {
            type: "workspace-write",
            writable_roots: [workspaceDir],
            network_access: true,
          },
          permission_profile: { type: "managed" },
        },
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/cannot express on resume/);

    writeRollout({
      turnContexts: [
        {
          approval_policy: "never",
          sandbox_policy: { type: "read-only" },
          permission_profile: { type: "managed" },
        },
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/cannot express on resume/);
  });

  it("restores a standard managed workspace-write session recorded by a native client", async () => {
    const threadStorage = join(workspaceDir, "thread-storage");
    writeRollout({
      turnContexts: [
        standardWorkspaceWritePolicy({ writableRoots: [threadStorage] }),
      ],
    });

    const snapshot = await readCodexNativePolicy({
      cwd: workspaceDir,
      sessionId: SESSION_ID,
    });

    expect(snapshot).toEqual({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      workspaceWrite: {
        writableRoots: [threadStorage],
        networkAccess: true,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
      permissionProfileType: "managed",
    });
    expect(codexNativePolicyResumeParams(snapshot).config).toEqual({
      "sandbox_workspace_write.writable_roots": [threadStorage],
      "sandbox_workspace_write.network_access": true,
      "sandbox_workspace_write.exclude_tmpdir_env_var": false,
      "sandbox_workspace_write.exclude_slash_tmp": false,
    });
  });

  it("restores a network-restricted workspace-write session without enabling network", async () => {
    writeRollout({
      turnContexts: [
        standardWorkspaceWritePolicy({
          networkAccess: false,
          writableRoots: [],
        }),
      ],
    });

    const snapshot = await readCodexNativePolicy({
      cwd: workspaceDir,
      sessionId: SESSION_ID,
    });

    expect(snapshot.workspaceWrite).toEqual({
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
    expect(snapshot.permissionProfileType).toBe("managed");
  });

  it("tolerates duplicate and reordered standard entries but refuses a widened write set", async () => {
    const threadStorage = join(workspaceDir, "thread-storage");
    const base = standardWorkspaceWritePolicy({
      writableRoots: [threadStorage],
    });
    writeRollout({
      turnContexts: [
        withEntries(base, [
          ...profileEntries(base).slice().reverse(),
          { path: { type: "path", path: threadStorage }, access: "write" },
        ]),
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).resolves.toMatchObject({ permissionProfileType: "managed" });

    writeRollout({
      turnContexts: [
        withEntries(base, [
          ...profileEntries(base),
          {
            path: { type: "path", path: join(workspaceDir, "..", "elsewhere") },
            access: "write",
          },
        ]),
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/customized managed permission profile/);
  });

  it("refuses managed workspace-write profiles that are narrowed or custom-restricted", async () => {
    const threadStorage = join(workspaceDir, "thread-storage");
    const base = standardWorkspaceWritePolicy({
      writableRoots: [threadStorage],
    });
    const entries = profileEntries(base);

    writeRollout({
      turnContexts: [
        withEntries(
          base,
          entries.filter((entry) => !JSON.stringify(entry).includes("kind")),
        ),
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/customized managed permission profile/);

    writeRollout({
      turnContexts: [
        withEntries(
          base,
          entries.filter(
            (entry) =>
              !(
                JSON.stringify(entry).includes(JSON.stringify(threadStorage)) &&
                entry.access === "write"
              ),
          ),
        ),
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/customized managed permission profile/);

    writeRollout({
      turnContexts: [
        {
          ...base,
          permission_profile: {
            ...(base.permission_profile as Record<string, unknown>),
            network: "restricted",
          },
        },
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/customized managed permission profile/);

    writeRollout({
      turnContexts: [
        withEntries(base, [
          ...entries,
          {
            path: { type: "path", path: join(workspaceDir, "elsewhere") },
            access: "write",
          },
        ]),
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/customized managed permission profile/);
  });

  it("accepts the enumerated read-only profile a native desktop client records", async () => {
    const secondRoot = join(workspaceDir, "visualizations");
    writeRollout({
      turnContexts: [
        {
          approval_policy: "never",
          approvals_reviewer: "user",
          sandbox_policy: { type: "read-only" },
          permission_profile: {
            type: "managed",
            file_system: {
              type: "restricted",
              entries: [
                {
                  path: { type: "special", value: { kind: "root" } },
                  access: "read",
                },
                { path: { type: "path", path: workspaceDir }, access: "read" },
                { path: { type: "path", path: secondRoot }, access: "read" },
                {
                  path: { type: "special", value: { kind: "slash_tmp" } },
                  access: "read",
                },
                {
                  path: { type: "special", value: { kind: "tmpdir" } },
                  access: "read",
                },
                ...markerEntries([workspaceDir, secondRoot]),
              ],
            },
            network: "restricted",
          },
        },
      ],
    });

    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).resolves.toMatchObject({
      sandbox: "read-only",
      permissionProfileType: "managed",
      workspaceWrite: null,
    });
  });

  it("accepts the active profile the sandbox derives even without an extends key", async () => {
    writeRollout({
      turnContexts: [
        {
          ...readOnlyPolicy(),
          active_permission_profile: { id: ":read-only" },
        },
      ],
    });

    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).resolves.toMatchObject({ sandbox: "read-only" });
  });

  it("refuses a session whose last turn ran in another directory", async () => {
    writeRollout({
      turnContexts: [
        { ...readOnlyPolicy(), cwd: join(tmpdir(), "moved-elsewhere") },
      ],
    });

    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/last ran in/);
  });

  it("refuses a profile type it does not recognize", async () => {
    writeRollout({
      turnContexts: [
        { ...readOnlyPolicy(), permission_profile: { type: "custom-locked" } },
      ],
    });

    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/permission profile "custom-locked", which bb does not recognize/);
  });

  it("refuses a managed profile whose restrictions the sandbox alone does not reproduce", async () => {
    writeRollout({
      turnContexts: [
        { ...readOnlyPolicy(), permission_profile: { type: "managed" } },
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/customized managed permission profile/);

    const narrowedEntries = canonicalReadOnlyProfile();
    writeRollout({
      turnContexts: [
        {
          ...readOnlyPolicy(),
          permission_profile: {
            ...narrowedEntries,
            file_system: {
              type: "restricted",
              entries: [
                {
                  path: { type: "path", path: join(workspaceDir, "src") },
                  access: "read",
                },
              ],
            },
          },
        },
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/managed permission profile/);

    writeRollout({
      turnContexts: [
        {
          approval_policy: "on-request",
          approvals_reviewer: "user",
          sandbox_policy: {
            type: "workspace-write",
            writable_roots: [workspaceDir],
            network_access: false,
            exclude_tmpdir_env_var: false,
            exclude_slash_tmp: false,
          },
          permission_profile: canonicalReadOnlyProfile(),
        },
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/managed permission profile/);
  });

  it("refuses a sandbox policy carrying restrictions it does not model", async () => {
    writeRollout({
      turnContexts: [
        {
          ...readOnlyPolicy(),
          sandbox_policy: { type: "read-only", network_access: false },
        },
      ],
    });

    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/cannot express on resume/);
  });

  it("accepts the active profile the sandbox derives and refuses any other", async () => {
    writeRollout({
      turnContexts: [
        {
          ...readOnlyPolicy(),
          active_permission_profile: { id: ":read-only", extends: null },
        },
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).resolves.toMatchObject({ sandbox: "read-only" });

    writeRollout({
      turnContexts: [
        {
          ...readOnlyPolicy(),
          active_permission_profile: {
            id: ":danger-full-access",
            extends: null,
          },
        },
      ],
    });
    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/active permission profile ":danger-full-access"/);
  });

  it("refuses a named permission profile it cannot restore", async () => {
    writeRollout({
      turnContexts: [
        {
          ...readOnlyPolicy(),
          active_permission_profile: { id: "strict-review", extends: null },
        },
      ],
    });

    await expect(
      readCodexNativePolicy({ cwd: workspaceDir, sessionId: SESSION_ID }),
    ).rejects.toThrow(/active permission profile "strict-review"/);
  });

  it("matches the recorded directory case-insensitively only on Windows", async () => {
    writeRollout({ turnContexts: [readOnlyPolicy()] });
    const recased =
      workspaceDir === workspaceDir.toUpperCase()
        ? workspaceDir.toLowerCase()
        : workspaceDir.toUpperCase();

    const attempt = readCodexNativePolicy({
      cwd: recased,
      sessionId: SESSION_ID,
    });
    if (process.platform === "win32") {
      await expect(attempt).resolves.toMatchObject({ sandbox: "read-only" });
    } else {
      await expect(attempt).rejects.toThrow(/was not found/);
    }
  });

  it("reads only the requested session, not other sessions in the same home", async () => {
    writeRollout({
      day: "07",
      sessionId: "01a07000-0000-7000-8000-000000000000",
      cwd: join(tmpdir(), "unrelated-project"),
      turnContexts: [
        {
          approval_policy: "never",
          approvals_reviewer: "user",
          sandbox_policy: { type: "danger-full-access" },
          permission_profile: { type: "disabled" },
        },
      ],
    });
    writeRollout({ turnContexts: [readOnlyPolicy()] });

    const snapshot = await readCodexNativePolicy({
      cwd: workspaceDir,
      sessionId: SESSION_ID,
    });

    expect(snapshot.sandbox).toBe("read-only");
  });
});
