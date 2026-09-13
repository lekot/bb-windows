import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { type CommandOf } from "../../command-dispatch-support.js";
import { isRecord } from "./jsonl-core.js";
import { zcodeDbFile } from "./zcode.js";

type ZcodeDesktopRegistrationCommand = CommandOf<
  "host.check_zcode_desktop_registration"
>;
type ZcodeDesktopRegistrationResult = HostDaemonOnlineRpcResult<
  "host.check_zcode_desktop_registration"
>;
type ZcodeDesktopTaskRegistrationCommand = CommandOf<
  "host.register_zcode_desktop_task"
>;
type ZcodeDesktopTaskRegistrationResult = HostDaemonOnlineRpcResult<
  "host.register_zcode_desktop_task"
>;

type TasksDatabase = import("better-sqlite3").Database;

interface ZcodeSessionRecord {
  directory: string | null;
  path: string | null;
  title: string | null;
  permission: string | null;
  time_created: number | null;
  time_updated: number | null;
  trace_id: string | null;
  modelReference: string | null;
}

const TASKS_INSERT_COLUMNS = [
  "workspace_key",
  "workspace_path",
  "workspace_identity",
  "task_id",
  "title",
  "task_status",
  "provider",
  "mode",
  "model",
  "migration_source",
  "forked_from_task_id",
  "created_at",
  "updated_at",
  "unread_at",
  "pinned",
  "archived",
  "deleted",
  "title_overridden",
  "meta_json",
  "searchable_text",
  "cron_automation_id",
  "last_unread_at",
  "off_peak_task_id",
] as const;

function zcodeV2Directory(): string {
  return path.join(os.homedir(), ".zcode", "v2");
}

function zcodeTasksIndexPath(): string {
  return path.join(zcodeV2Directory(), "tasks-index.sqlite");
}

function sqliteErrorCode(error: unknown): string | null {
  return isRecord(error) && typeof error.code === "string" ? error.code : null;
}

async function openTasksIndex(
  mode: "readonly" | "readwrite",
): Promise<
  | { ok: true; db: TasksDatabase }
  | { ok: false; result: { status: "unavailable"; reason: string } }
> {
  const { default: Database } = await import("better-sqlite3");
  try {
    const db =
      mode === "readonly"
        ? new Database(zcodeTasksIndexPath(), {
            readonly: true,
            fileMustExist: true,
          })
        : new Database(zcodeTasksIndexPath(), { fileMustExist: true });
    return { ok: true, db };
  } catch (error) {
    const code = sqliteErrorCode(error);
    if (code === "SQLITE_BUSY" || code === "SQLITE_CANTOPEN") {
      return {
        ok: false,
        result: {
          status: "unavailable",
          reason: "ZCode Desktop tasks index is locked or unreadable",
        },
      };
    }
    return {
      ok: false,
      result: {
        status: "unavailable",
        reason: "ZCode Desktop tasks index could not be read",
      },
    };
  }
}

function quickCheckOk(db: TasksDatabase): boolean {
  try {
    return db.pragma("quick_check", { simple: true }) === "ok";
  } catch {
    return false;
  }
}

function tasksRow(db: TasksDatabase, sessionId: string) {
  return db
    .prepare(
      "SELECT task_id, title, workspace_path, provider FROM tasks WHERE task_id = ?",
    )
    .get(sessionId) as
    | {
        task_id: string;
        title: string | null;
        workspace_path: string | null;
        provider: string | null;
      }
    | undefined;
}

async function readZcodeSessionRecord(
  sessionId: string,
): Promise<ZcodeSessionRecord | { error: string }> {
  const { default: Database } = await import("better-sqlite3");
  let db: TasksDatabase;
  try {
    db = new Database(zcodeDbFile(), { readonly: true, fileMustExist: true });
  } catch {
    return {
      error:
        "Native ZCode history database was not found or could not be read",
    };
  }
  try {
    const row = db
      .prepare(
        `SELECT directory, path, title, permission, time_created, time_updated, trace_id
           FROM session WHERE id = ?`,
      )
      .get(sessionId) as
      | Omit<ZcodeSessionRecord, "modelReference">
      | undefined;
    if (row === undefined) {
      return {
        error: "Native session was not found in the ZCode history database",
      };
    }
    const modelRow = db
      .prepare(
        `SELECT data FROM message WHERE session_id = ?
           ORDER BY time_created DESC, id DESC LIMIT 100`,
      )
      .all(sessionId) as Array<{ data: string }>;
    let modelReference: string | null = null;
    for (const candidate of modelRow) {
      try {
        const parsed: unknown = JSON.parse(candidate.data);
        if (!isRecord(parsed) || parsed.role !== "assistant") continue;
        const modelId =
          typeof parsed.modelID === "string" && parsed.modelID.length > 0
            ? parsed.modelID
            : null;
        if (modelId === null) continue;
        modelReference =
          typeof parsed.providerID === "string" && parsed.providerID.length > 0
            ? `${parsed.providerID}/${modelId}`
            : modelId;
        break;
      } catch {
        continue;
      }
    }
    return { ...row, modelReference };
  } catch {
    return { error: "Native ZCode history database could not be read" };
  } finally {
    db.close();
  }
}

function parseSessionMode(permission: string | null): string {
  if (permission === null) return "build";
  try {
    const parsed: unknown = JSON.parse(permission);
    if (
      isRecord(parsed) &&
      typeof parsed.mode === "string" &&
      /^[a-z][a-z0-9_-]{1,31}$/.test(parsed.mode)
    ) {
      return parsed.mode;
    }
  } catch {
    return "build";
  }
  return "build";
}

function workspaceKeyFor(workspace: string): string {
  return path.resolve(workspace).replaceAll("/", "\\");
}

function sameWorkspace(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export async function checkZcodeDesktopRegistration(
  command: ZcodeDesktopRegistrationCommand,
): Promise<ZcodeDesktopRegistrationResult> {
  const dbPath = zcodeTasksIndexPath();
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(dbPath);
  } catch {
    return {
      status: "unavailable",
      reason: "ZCode Desktop tasks index was not found on this machine",
    };
  }
  if (!stat.isFile()) {
    return {
      status: "unavailable",
      reason: "ZCode Desktop tasks index is not a readable file",
    };
  }
  try {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare(
          "SELECT task_id, title, workspace_path, provider FROM tasks WHERE task_id = ?",
        )
        .get(command.sessionId) as
        | { task_id: string; title: string | null; workspace_path: string | null; provider: string | null }
        | undefined;
      if (row === undefined) {
        return { status: "not_registered" };
      }
      return {
        status: "registered",
        title: row.title,
        workspacePath: row.workspace_path,
        provider: row.provider,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string"
      ? error.code
      : null;
    if (code === "SQLITE_CANTOPEN" || code === "SQLITE_BUSY") {
      return {
        status: "unavailable",
        reason: "ZCode Desktop tasks index is locked or unreadable",
      };
    }
    return {
      status: "unavailable",
      reason: "ZCode Desktop tasks index could not be read",
    };
  }
}

async function createVerifiedBackup(): Promise<
  { ok: true; backupPath: string } | { ok: false; reason: string }
> {
  const opened = await openTasksIndex("readonly");
  if (!opened.ok) return { ok: false, reason: opened.result.reason };
  const { default: Database } = await import("better-sqlite3");
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = `${zcodeTasksIndexPath()}.bb-backup-${stamp}`;
  try {
    await opened.db.backup(backupPath);
  } catch {
    await fs.rm(backupPath, { force: true });
    return { ok: false, reason: "A consistent backup could not be created" };
  } finally {
    opened.db.close();
  }
  let backup: TasksDatabase;
  try {
    backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  } catch {
    await fs.rm(backupPath, { force: true });
    return { ok: false, reason: "The backup could not be verified" };
  }
  try {
    if (!quickCheckOk(backup)) {
      await fs.rm(backupPath, { force: true });
      return { ok: false, reason: "The backup failed its integrity check" };
    }
  } finally {
    backup.close();
  }
  return { ok: true, backupPath };
}

export async function registerZcodeDesktopTask(
  command: ZcodeDesktopTaskRegistrationCommand,
): Promise<ZcodeDesktopTaskRegistrationResult> {
  const dbPath = zcodeTasksIndexPath();
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(dbPath);
  } catch {
    return {
      status: "unavailable",
      reason: "ZCode Desktop tasks index was not found on this machine",
    };
  }
  if (!stat.isFile()) {
    return {
      status: "unavailable",
      reason: "ZCode Desktop tasks index is not a readable file",
    };
  }
  const preflight = await openTasksIndex("readonly");
  if (!preflight.ok) return preflight.result;
  let duplicate: ReturnType<typeof tasksRow>;
  try {
    if (!quickCheckOk(preflight.db)) {
      return {
        status: "unavailable",
        reason: "ZCode Desktop tasks index failed its integrity check",
      };
    }
    duplicate = tasksRow(preflight.db, command.sessionId);
  } finally {
    preflight.db.close();
  }
  if (duplicate !== undefined) {
    return {
      status: "already_registered",
      title: duplicate.title,
      workspacePath: duplicate.workspace_path,
      provider: duplicate.provider,
    };
  }
  const session = await readZcodeSessionRecord(command.sessionId);
  if ("error" in session) {
    return { status: "rejected", reason: session.error };
  }
  const workspace = session.path ?? session.directory;
  if (workspace === null || workspace.trim().length === 0) {
    return {
      status: "rejected",
      reason: "Native session has no recorded workspace path",
    };
  }
  if (!sameWorkspace(workspace, command.cwd)) {
    return {
      status: "rejected",
      reason: `Workspace mismatch: the native session belongs to ${workspace}, but this thread runs in ${command.cwd}`,
    };
  }
  const title = (session.title ?? command.title).trim().length > 0
    ? (session.title ?? command.title).trim()
    : command.title.trim();
  const mode = parseSessionMode(session.permission);
  const model = session.modelReference;
  const createdAt = session.time_created ?? Date.now();
  const updatedAt = session.time_updated ?? Date.now();
  const workspacePath = workspaceKeyFor(workspace);
  if (!command.apply) {
    return {
      status: "preflight_ok",
      title,
      workspacePath,
      provider: "glm",
      mode,
      model,
      createdAt,
      updatedAt,
    };
  }
  const backup = await createVerifiedBackup();
  if (!backup.ok) {
    return { status: "unavailable", reason: backup.reason };
  }
  const write = await openTasksIndex("readwrite");
  if (!write.ok) return write.result;
  try {
    if (!quickCheckOk(write.db)) {
      return {
        status: "unavailable",
        reason: `ZCode Desktop tasks index failed its integrity check; backup: ${backup.backupPath}`,
      };
    }
    const meta: Record<string, unknown> = {
      taskId: command.sessionId,
      title,
      workspacePath,
      createdAt,
      updatedAt,
      mode,
      model,
      provider: "glm",
      status: "completed",
      target: null,
      titleOverridden: false,
    };
    if (session.trace_id !== null && session.trace_id.length > 0) {
      meta.traceId = session.trace_id;
    }
    const outcome = write.db
      .transaction(() => {
        const existing = tasksRow(write.db, command.sessionId);
        if (existing !== undefined) {
          return { kind: "already" as const, row: existing };
        }
        const columns = new Set(
          (write.db.pragma("table_info(tasks)") as Array<{ name: string }>).map(
            (column) => column.name,
          ),
        );
        const missing = TASKS_INSERT_COLUMNS.filter(
          (column) => !columns.has(column),
        );
        if (missing.length > 0) {
          return { kind: "schema" as const, missing };
        }
        const placeholders = TASKS_INSERT_COLUMNS.map(() => "?").join(", ");
        const insert = write.db.prepare(
          `INSERT INTO tasks (${TASKS_INSERT_COLUMNS.join(", ")}) VALUES (${placeholders})`,
        );
        insert.run(
          workspacePath,
          workspacePath,
          null,
          command.sessionId,
          title,
          "completed",
          "glm",
          mode,
          model,
          null,
          null,
          createdAt,
          updatedAt,
          null,
          0,
          0,
          0,
          0,
          JSON.stringify(meta),
          "",
          null,
          0,
          null,
        );
        return { kind: "inserted" as const };
      })
      .immediate();
    if (outcome.kind === "already") {
      return {
        status: "already_registered",
        title: outcome.row.title,
        workspacePath: outcome.row.workspace_path,
        provider: outcome.row.provider,
      };
    }
    if (outcome.kind === "schema") {
      return {
        status: "rejected",
        reason: `ZCode Desktop tasks table is missing columns: ${outcome.missing.join(", ")}`,
      };
    }
    if (!quickCheckOk(write.db)) {
      return {
        status: "unavailable",
        reason: `ZCode Desktop tasks index failed its integrity check after writing; backup: ${backup.backupPath}`,
      };
    }
    return {
      status: "registered",
      title,
      workspacePath,
      provider: "glm",
      backupPath: backup.backupPath,
    };
  } finally {
    write.db.close();
  }
}

export { zcodeTasksIndexPath };
