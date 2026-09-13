import {
  parseClaudeServiceMessage,
  type ClaudeServiceMessage,
} from "./claude-service-message";
import { parseTaskNotification } from "./task-notification";

export interface NativeServiceMessage extends ClaudeServiceMessage {
  providerLabel: string;
}

function parseCodexServiceMessage(text: string): NativeServiceMessage | null {
  if (text.length > 64 * 1024) return null;
  const normalized = text.trim();
  if (!/^<environment_context>[\s\S]*<\/environment_context>$/.test(normalized)) {
    return null;
  }
  return {
    kind: "local-command",
    providerLabel: "Codex",
    title: "Контекст среды выполнения",
    body: "Служебная запись Codex о среде запуска; не сообщение пользователя.",
  };
}

export function parseNativeServiceMessage(
  text: string,
): NativeServiceMessage | null {
  const codex = parseCodexServiceMessage(text);
  if (codex !== null) return codex;
  const claude = parseClaudeServiceMessage(text);
  if (claude === null) return null;
  return { ...claude, providerLabel: "Claude" };
}

export function isNativeServiceMessage(text: string): boolean {
  return (
    parseTaskNotification(text) !== null ||
    parseNativeServiceMessage(text) !== null
  );
}
