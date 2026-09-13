import type { NativeServiceMessage } from "./native-service-message";

export function ClaudeServiceMessageCard({
  message,
  originalText,
}: {
  message: NativeServiceMessage;
  originalText: string;
}) {
  return (
    <section
      aria-label="Служебное сообщение провайдера"
      className="my-2 rounded-md border border-border/50 border-l-2 bg-surface-recessed px-3 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      <p className="mb-1 text-xs text-muted-foreground">
        {message.providerLabel} · служебное сообщение
      </p>
      <p className="text-xs font-medium text-foreground">{message.title}</p>
      {message.kind === "context-summary" ? (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer">Показать сводку</summary>
          <div className="mt-2 whitespace-pre-wrap break-words">{message.body}</div>
        </details>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-xs">
          {message.body}
        </p>
      )}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Подробности</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words">
          {originalText}
        </pre>
      </details>
    </section>
  );
}
