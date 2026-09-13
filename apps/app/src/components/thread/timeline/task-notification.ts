export interface TaskNotification {
  taskId: string;
  toolUseId: string | null;
  outputFile: string | null;
  status: string;
  summary: string;
  exitCode: number | null;
  note?: string;
  result?: string;
}

export function decodeEntities(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (original, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity] ?? original;
      const code =
        entity[1].toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : original;
    },
  );
}

export function parseTaskNotification(text: string): TaskNotification | null {
  if (text.length > 64 * 1024) return null;
  const normalized = text.trim().replace(/\\([<>])/g, "$1");
  const envelope =
    /^<task-notification>\s*([\s\S]*?)\s*<\/task-notification>$/.exec(
      normalized,
    );
  if (!envelope) return null;
  const fields = new Map<string, string>();
  const allowed = new Set([
    "task-id",
    "tool-use-id",
    "output-file",
    "status",
    "summary",
    "note",
    "result",
    "usage",
  ]);
  let remaining = envelope[1];
  while (remaining.length > 0) {
    const field = /^<([a-z-]+)>([\s\S]*?)<\/\1>\s*/.exec(remaining);
    if (!field || !allowed.has(field[1]) || fields.has(field[1])) return null;
    fields.set(field[1], decodeEntities(field[2].trim()));
    remaining = remaining.slice(field[0].length);
  }
  const taskId = fields.get("task-id");
  const status = fields.get("status");
  const summary = fields.get("summary");
  if (!taskId || !status || !summary || !/^[\w-]+$/.test(status)) return null;
  const exit = /\bexit code\s+(-?\d+)\b/i.exec(summary);
  const exitCode = exit ? Number(exit[1]) : null;
  return {
    taskId,
    status,
    summary,
    ...(fields.has("note") ? { note: fields.get("note")! } : {}),
    ...(fields.has("result") ? { result: fields.get("result")! } : {}),
    toolUseId: fields.get("tool-use-id") || null,
    outputFile: fields.get("output-file") || null,
    exitCode:
      exitCode !== null && Number.isSafeInteger(exitCode) ? exitCode : null,
  };
}
