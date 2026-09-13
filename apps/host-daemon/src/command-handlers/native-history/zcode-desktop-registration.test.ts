import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkZcodeDesktopRegistration,
  registerZcodeDesktopTask,
  zcodeTasksIndexPath,
} from "./zcode-desktop-registration.js";

const SESSION_ID = "sess_test-a9ec-5047-0492-4bc2-7ba-baeb4867ac23";
const WORKSPACE = "C:\\workspace\\bb-example";

let tempHome: string;
let originalHome: string | undefined;
const db = await import("better-sqlite3").then((m) => m.default);

function createTasksIndex(entries: Array<Record<string, unknown>>): string {
  const dbPath = zcodeTasksIndexPath();
  const conn = new db(dbPath);
  conn.exec(`CREATE TABLE tasks (
    workspace_key TEXT,
    workspace_path TEXT,
    task_id TEXT,
    title TEXT,
    provider TEXT
  )`);
  for (const entry of entries) {
    conn.prepare(
      "INSERT INTO tasks (workspace_key, workspace_path, task_id, title, provider) VALUES (?, ?, ?, ?, ?)",
    ).run(
      entry.workspace_key ?? "test",
      entry.workspace_path ?? "C:/test",
      entry.task_id,
      entry.title ?? null,
      entry.provider ?? "glm",
    );
  }
  conn.close();
  return dbPath;
}

const FULL_TASKS_DDL = `CREATE TABLE tasks (
  workspace_key TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  workspace_identity TEXT,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  task_status TEXT,
  provider TEXT,
  mode TEXT NOT NULL DEFAULT 'build',
  model TEXT,
  migration_source TEXT,
  forked_from_task_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  unread_at INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  title_overridden INTEGER NOT NULL DEFAULT 0,
  meta_json TEXT NOT NULL DEFAULT '{}',
  searchable_text TEXT NOT NULL DEFAULT '',
  cron_automation_id TEXT,
  last_unread_at INTEGER NOT NULL DEFAULT 0,
  off_peak_task_id TEXT
)`;

function createFullTasksIndex(): string {
  const dbPath = zcodeTasksIndexPath();
  const conn = new db(dbPath);
  conn.exec(FULL_TASKS_DDL);
  conn.close();
  return dbPath;
}

function createCliDbSession(options: {
  path?: string | null;
  title?: string | null;
  permission?: string | null;
  omitSession?: boolean;
}): void {
  const dbPath = path.join(tempHome, ".zcode", "cli", "db", "db.sqlite");
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new db(dbPath);
  conn.exec(`CREATE TABLE session (
    id TEXT PRIMARY KEY,
    directory TEXT,
    path TEXT,
    title TEXT,
    permission TEXT,
    time_created INTEGER,
    time_updated INTEGER,
    trace_id TEXT
  )`);
  conn.exec(`CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    time_created INTEGER,
    data TEXT
  )`);
  if (!options.omitSession) {
    conn
      .prepare(
        "INSERT INTO session (id, directory, path, title, permission, time_created, time_updated, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        SESSION_ID,
        "C:/workspace/bb-example",
        options.path === undefined ? "C:/workspace/bb-example" : options.path,
        options.title === undefined
          ? "Native session title"
          : options.title,
        options.permission === undefined
          ? '{"mode":"build"}'
          : options.permission,
        1788779406621,
        1788923731869,
        "7dec2ec1-49f0-4bd4-b414-f9cd76babf63",
      );
    conn
      .prepare(
        "INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)",
      )
      .run(
        "msg_test_model",
        SESSION_ID,
        1788923000000,
        JSON.stringify({
          role: "assistant",
          modelID: "glm-5.3",
          providerID: "zai",
          tokens: { input: 104663, output: 1000 },
        }),
      );
  }
  conn.close();
}

function registerCommand(overrides: {
  apply?: boolean;
  cwd?: string;
} = {}) {
  return {
    type: "host.register_zcode_desktop_task" as const,
    sessionId: SESSION_ID,
    cwd: overrides.cwd ?? WORKSPACE,
    title: "bb thread title",
    apply: overrides.apply ?? false,
  };
}

async function countTaskRows(): Promise<number> {
  const conn = new db(zcodeTasksIndexPath(), { readonly: true });
  try {
    const row = conn.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {
      n: number;
    };
    return row.n;
  } finally {
    conn.close();
  }
}

async function listBackupFiles(): Promise<string[]> {
  const dir = path.dirname(zcodeTasksIndexPath());
  const entries = await fs.readdir(dir);
  return entries.filter((name) => name.includes(".bb-backup-"));
}

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "zcode-desktop-"));
  originalHome = process.env.USERPROFILE ?? process.env.HOME;
  process.env.USERPROFILE = tempHome;
  process.env.HOME = tempHome;
  await fs.mkdir(path.join(tempHome, ".zcode", "v2"), { recursive: true });
});

afterEach(async () => {
  if (originalHome !== undefined) {
    process.env.USERPROFILE = originalHome;
    process.env.HOME = originalHome;
  }
  await fs.rm(tempHome, { force: true, recursive: true });
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("checkZcodeDesktopRegistration", () => {
  it("reports registered when the session exists in tasks-index", async () => {
    createTasksIndex([{ task_id: SESSION_ID, title: "Test", provider: "glm" }]);
    const result = await checkZcodeDesktopRegistration({
      type: "host.check_zcode_desktop_registration",
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({
      status: "registered",
      title: "Test",
      workspacePath: "C:/test",
      provider: "glm",
    });
  });

  it("reports not_registered when the session is absent", async () => {
    createTasksIndex([]);
    const result = await checkZcodeDesktopRegistration({
      type: "host.check_zcode_desktop_registration",
      sessionId: SESSION_ID,
    });
    expect(result).toEqual({ status: "not_registered" });
  });

  it("reports unavailable when tasks-index does not exist", async () => {
    const result = await checkZcodeDesktopRegistration({
      type: "host.check_zcode_desktop_registration",
      sessionId: SESSION_ID,
    });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toContain("not found");
    }
  });
});

describe("registerZcodeDesktopTask", () => {
  it("runs a read-only preflight without touching the index", async () => {
    createFullTasksIndex();
    createCliDbSession({});
    const result = await registerZcodeDesktopTask(registerCommand());
    expect(result).toEqual({
      status: "preflight_ok",
      title: "Native session title",
      workspacePath: WORKSPACE,
      provider: "glm",
      mode: "build",
      model: "zai/glm-5.3",
      createdAt: 1788779406621,
      updatedAt: 1788923731869,
    });
    expect(await countTaskRows()).toBe(0);
    expect(await listBackupFiles()).toEqual([]);
  });

  it("registers after a verified backup and stays idempotent", async () => {
    createFullTasksIndex();
    createCliDbSession({});
    const result = await registerZcodeDesktopTask(registerCommand({ apply: true }));
    expect(result.status).toBe("registered");
    if (result.status !== "registered") return;
    expect(result.title).toBe("Native session title");
    expect(result.workspacePath).toBe(WORKSPACE);
    const backupStat = await fs.stat(result.backupPath);
    expect(backupStat.size).toBeGreaterThan(0);
    expect(await countTaskRows()).toBe(1);

    const conn = new db(zcodeTasksIndexPath(), { readonly: true });
    try {
      const row = conn
        .prepare(
          "SELECT workspace_key, task_status, provider, mode, model, meta_json FROM tasks WHERE task_id = ?",
        )
        .get(SESSION_ID) as {
        workspace_key: string;
        task_status: string;
        provider: string;
        mode: string;
        model: string;
        meta_json: string;
      };
      expect(row.workspace_key).toBe(WORKSPACE);
      expect(row.task_status).toBe("completed");
      expect(row.provider).toBe("glm");
      expect(row.mode).toBe("build");
      expect(row.model).toBe("zai/glm-5.3");
      expect(JSON.parse(row.meta_json)).toMatchObject({
        taskId: SESSION_ID,
        mode: "build",
        model: "zai/glm-5.3",
        provider: "glm",
        status: "completed",
        traceId: "7dec2ec1-49f0-4bd4-b414-f9cd76babf63",
      });
    } finally {
      conn.close();
    }

    const second = await registerZcodeDesktopTask(
      registerCommand({ apply: true }),
    );
    expect(second).toEqual({
      status: "already_registered",
      title: "Native session title",
      workspacePath: WORKSPACE,
      provider: "glm",
    });
    expect(await countTaskRows()).toBe(1);
    expect((await listBackupFiles()).length).toBe(1);
  });

  it("reports already_registered for an existing row without a backup", async () => {
    const dbPath = createFullTasksIndex();
    const conn = new db(dbPath);
    conn
      .prepare(
        "INSERT INTO tasks (workspace_key, workspace_path, task_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(WORKSPACE, WORKSPACE, SESSION_ID, "Existing", 1, 2);
    conn.close();
    const result = await registerZcodeDesktopTask(registerCommand({ apply: true }));
    expect(result).toEqual({
      status: "already_registered",
      title: "Existing",
      workspacePath: WORKSPACE,
      provider: null,
    });
    expect(await countTaskRows()).toBe(1);
    expect(await listBackupFiles()).toEqual([]);
  });

  it("rejects when the native session is missing or the cli database is absent", async () => {
    createFullTasksIndex();
    createCliDbSession({ omitSession: true });
    const missing = await registerZcodeDesktopTask(registerCommand({ apply: true }));
    expect(missing).toEqual({
      status: "rejected",
      reason: "Native session was not found in the ZCode history database",
    });
    await fs.rm(path.join(tempHome, ".zcode", "cli", "db", "db.sqlite"));
    const noDb = await registerZcodeDesktopTask(registerCommand({ apply: true }));
    expect(noDb.status).toBe("rejected");
    if (noDb.status === "rejected") {
      expect(noDb.reason).toContain("could not be read");
    }
  });

  it("rejects a workspace mismatch without writing", async () => {
    createFullTasksIndex();
    createCliDbSession({});
    const result = await registerZcodeDesktopTask(
      registerCommand({ apply: true, cwd: "C:\\Other\\project" }),
    );
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toContain("Workspace mismatch");
    }
    expect(await countTaskRows()).toBe(0);
    expect(await listBackupFiles()).toEqual([]);
  });

  it("reports unavailable when the tasks index is not a database", async () => {
    await fs.writeFile(zcodeTasksIndexPath(), "not a database", "utf8");
    createCliDbSession({});
    const result = await registerZcodeDesktopTask(registerCommand({ apply: true }));
    expect(result.status).toBe("unavailable");
  });
});
