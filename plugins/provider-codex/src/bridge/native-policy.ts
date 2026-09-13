import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ApprovalsReviewer } from "../generated/codex-app-server/schema/v2/ApprovalsReviewer.js";
import type { AskForApproval } from "../generated/codex-app-server/schema/v2/AskForApproval.js";
import type { JsonValue } from "../generated/codex-app-server/schema/serde_json/JsonValue.js";
import type { SandboxMode } from "../generated/codex-app-server/schema/v2/SandboxMode.js";

const HEAD_SCAN_BYTES = 256 * 1024;
const INITIAL_TAIL_SCAN_BYTES = 512 * 1024;
const MAX_TAIL_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;

export interface CodexNativeWorkspaceWritePolicy {
  writableRoots: string[];
  networkAccess: boolean;
  excludeTmpdirEnvVar: boolean;
  excludeSlashTmp: boolean;
}

export interface CodexNativePolicySnapshot {
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: SandboxMode;
  workspaceWrite: CodexNativeWorkspaceWritePolicy | null;
  permissionProfileType: string;
}

export class CodexNativePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexNativePolicyError";
  }
}

const granularApprovalSchema = z
  .object({
    granular: z
      .object({
        sandbox_approval: z.boolean(),
        rules: z.boolean(),
        skill_approval: z.boolean(),
        request_permissions: z.boolean(),
        mcp_elicitations: z.boolean(),
      })
      .strict(),
  })
  .strict();

const approvalPolicySchema = z.union([
  z.literal("untrusted"),
  z.literal("on-request"),
  z.literal("never"),
  granularApprovalSchema,
]);

const approvalsReviewerSchema = z.enum([
  "user",
  "auto_review",
  "guardian_subagent",
]);

const sandboxPolicySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read-only") }).strict(),
  z
    .object({
      type: z.literal("workspace-write"),
      writable_roots: z.array(z.string()).default([]),
      network_access: z.boolean(),
      exclude_tmpdir_env_var: z.boolean(),
      exclude_slash_tmp: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("danger-full-access") }).strict(),
]);

const disabledPermissionProfileSchema = z
  .object({ type: z.literal("disabled") })
  .strict();

const specialPathSchema = z
  .object({
    type: z.literal("special"),
    value: z
      .object({ kind: z.enum(["root", "slash_tmp", "tmpdir"]) })
      .strict(),
  })
  .strict();

const managedPermissionProfileSchema = z
  .object({
    type: z.literal("managed"),
    file_system: z
      .object({
        type: z.literal("restricted"),
        entries: z.array(
          z.union([
            z
              .object({
                path: specialPathSchema,
                access: z.enum(["read", "write"]),
              })
              .strict(),
            z
              .object({
                path: z
                  .object({ type: z.literal("path"), path: z.string().min(1) })
                  .strict(),
                access: z.enum(["read", "write"]),
                missing_path_behavior: z.literal("skip").optional(),
              })
              .strict(),
          ]),
        ),
      })
      .strict(),
    network: z.enum(["enabled", "restricted"]),
  })
  .strict();

interface ExpectedManagedProfile {
  network: "enabled" | "restricted";
  specials: Set<"slash_tmp" | "tmpdir">;
  writablePaths: Set<string>;
}

function expectedManagedProfile(args: {
  cwd: string;
  sandboxPolicy: z.infer<typeof sandboxPolicySchema>;
}): ExpectedManagedProfile {
  const specials = new Set<"slash_tmp" | "tmpdir">();
  const writablePaths = new Set<string>();
  if (args.sandboxPolicy.type !== "workspace-write") {
    return { network: "restricted", specials, writablePaths };
  }
  writablePaths.add(directoryKey(args.cwd));
  for (const root of args.sandboxPolicy.writable_roots) {
    writablePaths.add(directoryKey(root));
  }
  if (!args.sandboxPolicy.exclude_slash_tmp) specials.add("slash_tmp");
  if (!args.sandboxPolicy.exclude_tmpdir_env_var) specials.add("tmpdir");
  return {
    network: args.sandboxPolicy.network_access ? "enabled" : "restricted",
    specials,
    writablePaths,
  };
}

function isStandardManagedProfile(args: {
  cwd: string;
  profile: z.infer<typeof managedPermissionProfileSchema>;
  sandboxPolicy: z.infer<typeof sandboxPolicySchema>;
}): boolean {
  const expected = expectedManagedProfile({
    cwd: args.cwd,
    sandboxPolicy: args.sandboxPolicy,
  });
  if (args.profile.network !== expected.network) return false;
  let hasGlobalRead = false;
  const writablePaths = new Set<string>();
  const writableSpecials = new Set<"slash_tmp" | "tmpdir">();
  for (const entry of args.profile.file_system.entries) {
    if (entry.path.type === "special") {
      const kind = entry.path.value.kind;
      if (kind === "root") {
        if (entry.access !== "read") return false;
        hasGlobalRead = true;
        continue;
      }
      if (entry.access === "write") writableSpecials.add(kind);
      continue;
    }
    if (entry.access === "write") {
      writablePaths.add(directoryKey(entry.path.path));
    }
  }
  if (!hasGlobalRead) return false;
  if (writablePaths.size !== expected.writablePaths.size) return false;
  for (const writable of expected.writablePaths) {
    if (!writablePaths.has(writable)) return false;
  }
  if (writableSpecials.size !== expected.specials.size) return false;
  for (const special of expected.specials) {
    if (!writableSpecials.has(special)) return false;
  }
  return true;
}

const activePermissionProfileSchema = z
  .object({ id: z.string().min(1), extends: z.string().nullish() })
  .strict();

const turnContextPolicySchema = z.object({
  cwd: z.string().min(1),
  approval_policy: approvalPolicySchema,
  approvals_reviewer: approvalsReviewerSchema,
  sandbox_policy: sandboxPolicySchema,
  permission_profile: z.unknown(),
  active_permission_profile: z.unknown().nullish(),
});

const sessionMetaSchema = z.object({
  id: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
});

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEX_HOME?.trim();
  if (!configured) return path.join(os.homedir(), ".codex");
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(os.homedir(), configured);
}

function directoryKey(value: string): string {
  const onWindows = process.platform === "win32";
  const normalized = onWindows
    ? path.normalize(value).replaceAll("/", "\\")
    : path.normalize(value);
  const separator = onWindows ? "\\" : "/";
  const trimmed =
    normalized.length > (onWindows ? 3 : 1) && normalized.endsWith(separator)
      ? normalized.slice(0, -1)
      : normalized;
  return onWindows ? trimmed.toLowerCase() : trimmed;
}

function sameDirectoryPath(left: string, right: string): boolean {
  return directoryKey(left) === directoryKey(right);
}

async function rolloutsInDirectory(
  directory: string,
  suffix: string,
): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(suffix),
    )
    .map((entry) => path.join(directory, entry.name));
}

async function numericSubdirectories(parent: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => path.join(parent, entry.name));
}

async function rolloutCandidates(
  codexHome: string,
  sessionId: string,
): Promise<string[]> {
  const suffix = `-${sessionId}.jsonl`;
  const sessionsRoot = path.join(codexHome, "sessions");
  const matches = [
    ...(await rolloutsInDirectory(sessionsRoot, suffix)),
    ...(await rolloutsInDirectory(
      path.join(codexHome, "archived_sessions"),
      suffix,
    )),
  ];
  for (const yearDir of await numericSubdirectories(sessionsRoot)) {
    for (const monthDir of await numericSubdirectories(yearDir)) {
      for (const dayDir of await numericSubdirectories(monthDir)) {
        matches.push(...(await rolloutsInDirectory(dayDir, suffix)));
      }
    }
  }
  return matches;
}

function parseJsonlLine(line: string): Record<string, unknown> | null {
  if (line.length === 0 || line.length > MAX_LINE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function completeLines(chunk: string, droppedPrefix: boolean): string[] {
  const lines = chunk.split("\n");
  if (droppedPrefix) lines.shift();
  const last = lines[lines.length - 1];
  if (last !== undefined && !chunk.endsWith("\n")) lines.pop();
  return lines.map((line) =>
    line.endsWith("\r") ? line.slice(0, -1) : line,
  );
}

async function readHeadSessionMeta(
  filePath: string,
): Promise<{ cwd: string | null; id: string | null } | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(HEAD_SCAN_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_SCAN_BYTES, 0);
    const lines = completeLines(
      buffer.subarray(0, bytesRead).toString("utf8"),
      false,
    );
    for (const line of lines) {
      const record = parseJsonlLine(line);
      if (record === null || record.type !== "session_meta") continue;
      const payload = sessionMetaSchema.safeParse(record.payload);
      if (!payload.success) return null;
      return {
        cwd: payload.data.cwd ?? null,
        id: payload.data.id ?? payload.data.session_id ?? null,
      };
    }
    return null;
  } finally {
    await handle.close();
  }
}

async function readLastTurnContext(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const { size } = await handle.stat();
    let windowBytes = Math.min(INITIAL_TAIL_SCAN_BYTES, size);
    while (windowBytes > 0) {
      const start = size - windowBytes;
      const buffer = Buffer.alloc(windowBytes);
      const { bytesRead } = await handle.read(buffer, 0, windowBytes, start);
      const lines = completeLines(
        buffer.subarray(0, bytesRead).toString("utf8"),
        start > 0,
      );
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line === undefined) continue;
        const record = parseJsonlLine(line);
        if (record !== null && record.type === "turn_context") return record;
      }
      if (start === 0 || windowBytes >= Math.min(MAX_TAIL_SCAN_BYTES, size)) {
        return null;
      }
      windowBytes = Math.min(MAX_TAIL_SCAN_BYTES, size, windowBytes * 2);
    }
    return null;
  } finally {
    await handle.close();
  }
}

function unrestorableProfileError(
  sessionId: string,
  detail: string,
): CodexNativePolicyError {
  return new CodexNativePolicyError(
    `Native Codex session ${sessionId} records ${detail}. bb cannot set permission profiles through thread/resume, so resuming would silently drop that restriction; bb refuses instead. Continue that session in the client that created it, or start a bb thread with an explicit permission mode.`,
  );
}

function restorablePermissionProfileType(args: {
  cwd: string;
  profile: unknown;
  sandboxPolicy: z.infer<typeof sandboxPolicySchema>;
  sessionId: string;
}): string {
  if (disabledPermissionProfileSchema.safeParse(args.profile).success) {
    return "disabled";
  }
  const managed = managedPermissionProfileSchema.safeParse(args.profile);
  if (
    managed.success &&
    isStandardManagedProfile({
      cwd: args.cwd,
      profile: managed.data,
      sandboxPolicy: args.sandboxPolicy,
    })
  ) {
    return "managed";
  }
  const recordedType =
    typeof args.profile === "object" &&
    args.profile !== null &&
    "type" in args.profile &&
    typeof (args.profile as { type: unknown }).type === "string"
      ? (args.profile as { type: string }).type
      : "an unreadable value";
  throw unrestorableProfileError(
    args.sessionId,
    recordedType === "managed"
      ? `a customized managed permission profile whose file-system or network grants differ from the ones the "${args.sandboxPolicy.type}" sandbox derives from its own recorded roots`
      : `permission profile "${recordedType}", which bb does not recognize`,
  );
}

function assertRestorableActiveProfile(args: {
  activeProfile: unknown;
  sandbox: SandboxMode;
  sessionId: string;
}): void {
  if (args.activeProfile === undefined || args.activeProfile === null) return;
  const parsed = activePermissionProfileSchema.safeParse(args.activeProfile);
  if (
    parsed.success &&
    (parsed.data.extends === null || parsed.data.extends === undefined) &&
    parsed.data.id === `:${args.sandbox}`
  ) {
    return;
  }
  const recordedId = parsed.success ? parsed.data.id : "an unreadable value";
  throw unrestorableProfileError(
    args.sessionId,
    `active permission profile "${recordedId}", which is not the profile the "${args.sandbox}" sandbox derives on its own`,
  );
}

function toSnapshot(
  payload: z.infer<typeof turnContextPolicySchema>,
  cwd: string,
  sessionId: string,
): CodexNativePolicySnapshot {
  const sandboxPolicy = payload.sandbox_policy;
  if (!sameDirectoryPath(payload.cwd, cwd)) {
    throw new CodexNativePolicyError(
      `Native Codex session ${sessionId} last ran in ${payload.cwd}, not ${cwd}; bb will not resume it under a policy recorded for another directory.`,
    );
  }
  assertRestorableActiveProfile({
    activeProfile: payload.active_permission_profile,
    sandbox: sandboxPolicy.type,
    sessionId,
  });
  const permissionProfileType = restorablePermissionProfileType({
    cwd: payload.cwd,
    profile: payload.permission_profile,
    sandboxPolicy,
    sessionId,
  });
  return {
    approvalPolicy: payload.approval_policy,
    approvalsReviewer: payload.approvals_reviewer,
    sandbox: sandboxPolicy.type,
    workspaceWrite:
      sandboxPolicy.type === "workspace-write"
        ? {
            writableRoots: [...sandboxPolicy.writable_roots],
            networkAccess: sandboxPolicy.network_access,
            excludeTmpdirEnvVar: sandboxPolicy.exclude_tmpdir_env_var,
            excludeSlashTmp: sandboxPolicy.exclude_slash_tmp,
          }
        : null,
    permissionProfileType,
  };
}

export async function readCodexNativePolicy(args: {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  sessionId: string;
}): Promise<CodexNativePolicySnapshot> {
  const codexHome = resolveCodexHome(args.env);
  const candidates = await rolloutCandidates(codexHome, args.sessionId);
  const stats = await Promise.all(
    candidates.map(async (file) => {
      try {
        return { file, mtimeMs: (await fs.stat(file)).mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const ordered = stats
    .flatMap((entry) => (entry === null ? [] : [entry]))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const entry of ordered) {
    const meta = await readHeadSessionMeta(entry.file);
    if (meta === null || meta.id !== args.sessionId) continue;
    if (meta.cwd === null || !sameDirectoryPath(meta.cwd, args.cwd)) continue;
    const record = await readLastTurnContext(entry.file);
    if (record === null) {
      throw new CodexNativePolicyError(
        `Native Codex session ${args.sessionId} has no recorded turn context, so bb cannot restore its sandbox and approval policy; refusing to resume with the machine's default policy.`,
      );
    }
    const parsed = turnContextPolicySchema.safeParse(record.payload);
    if (!parsed.success) {
      throw new CodexNativePolicyError(
        `Native Codex session ${args.sessionId} records a permission policy bb cannot express on resume (${parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; ")}); refusing to resume with the machine's default policy.`,
      );
    }
    return toSnapshot(parsed.data, args.cwd, args.sessionId);
  }
  throw new CodexNativePolicyError(
    `Native Codex rollout for session ${args.sessionId} was not found in ${codexHome} for ${args.cwd}, so bb cannot restore its sandbox and approval policy; refusing to resume with the machine's default policy.`,
  );
}

export function codexNativePolicyResumeParams(
  snapshot: CodexNativePolicySnapshot,
): {
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  sandbox: SandboxMode;
  config?: { [key in string]?: JsonValue };
} {
  const workspaceWrite = snapshot.workspaceWrite;
  return {
    approvalPolicy: snapshot.approvalPolicy,
    approvalsReviewer: snapshot.approvalsReviewer,
    sandbox: snapshot.sandbox,
    ...(workspaceWrite === null
      ? {}
      : {
          config: {
            "sandbox_workspace_write.writable_roots": [
              ...workspaceWrite.writableRoots,
            ],
            "sandbox_workspace_write.network_access":
              workspaceWrite.networkAccess,
            "sandbox_workspace_write.exclude_tmpdir_env_var":
              workspaceWrite.excludeTmpdirEnvVar,
            "sandbox_workspace_write.exclude_slash_tmp":
              workspaceWrite.excludeSlashTmp,
          },
        }),
  };
}
