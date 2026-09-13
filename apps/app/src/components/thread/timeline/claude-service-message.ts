import { decodeEntities, parseTaskNotification } from "./task-notification";

export interface ClaudeServiceMessage {
  kind: "local-command" | "ide-file" | "context-summary";
  title: string;
  body: string;
}

export function parseClaudeServiceMessage(
  text: string,
): ClaudeServiceMessage | null {
  if (text.length > 64 * 1024) return null;
  const normalized = text.trim().replace(/\\([<>])/g, "$1");
  const continuation = /^This session is being continued from a previous conversation that ran out of context\. The summary below covers the earlier portion of the conversation\.\s+Summary:\s*([\s\S]+)$/.exec(normalized);
  if (continuation) {
    return {
      kind: "context-summary",
      title: "Сводка предыдущего контекста",
      body: continuation[1].trim(),
    };
  }
  const allowed = new Set([
    "local-command-caveat",
    "command-name",
    "command-message",
    "command-args",
    "local-command-stdout",
    "ide_opened_file",
  ]);
  const fields = new Map<string, string>();
  let remaining = normalized;
  while (remaining.length > 0) {
    const match = /^<([a-z_-]+)>([\s\S]*?)<\/\1>/.exec(remaining);
    if (!match) {
      const partial = /^<ide_opened_file>([^<]+)$/.exec(remaining);
      if (fields.size === 0 && partial) {
        return {
          kind: "ide-file",
          title: "IDE: открыт файл",
          body: decodeEntities(partial[1].trim()),
        };
      }
      return null;
    }
    if (!allowed.has(match[1]) || fields.has(match[1])) return null;
    fields.set(match[1], decodeEntities(match[2].trim()));
    remaining = remaining
      .slice(match[0].length)
      .replace(/^(?:\s|\\(?=\s|<|$))+/, "");
  }
  if (fields.size === 0) return null;
  if (fields.has("ide_opened_file")) {
    if (fields.size !== 1) return null;
    return {
      kind: "ide-file",
      title: "IDE: открыт файл",
      body: fields.get("ide_opened_file") ?? "",
    };
  }
  const command = fields.get("command-name") || fields.get("command-message");
  const args = fields.get("command-args");
  const output = fields.get("local-command-stdout");
  return {
    kind: "local-command",
    title: command
      ? `Локальная команда ${command}`
      : output
        ? "Результат локальной команды"
        : "Локальные команды",
    body:
      [command ? [command, args].filter(Boolean).join(" ") : args, output]
        .filter(Boolean)
        .join("\n") || "Служебное уведомление о локальных командах.",
  };
}

export function isClaudeServiceMessage(text: string): boolean {
  return (
    parseTaskNotification(text) !== null ||
    parseClaudeServiceMessage(text) !== null
  );
}
