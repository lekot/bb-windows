import { Button } from "@bb/shared-ui/button";
import { useEffect, useRef, useState } from "react";
import { isTaskJournalEmpty } from "./task-journal";
import { ResponsiveDrawerShell } from "@bb/shared-ui/responsive-overlay";
import { MarkdownPreview } from "../../ui/markdown-preview";
import type { TaskNotification } from "./task-notification";
import type { ThreadTimelineLocalFileLinkHandler } from "./types";

export function TaskNotificationCard({
  notification,
  originalText,
  onOpenLocalFileLink,
  threadId,
}: {
  notification: TaskNotification;
  originalText: string;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  threadId?: string;
}) {
  const [resultOpen, setResultOpen] = useState(false);
  const [journalState, setJournalState] = useState<
    "idle" | "checking" | "empty" | "error"
  >("idle");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    setJournalState("idle");
    return () => {
      requestRef.current?.abort();
    };
  }, [threadId, notification.outputFile]);
  const openJournal = async () => {
    const path = notification.outputFile;
    if (!path) return;
    if (!threadId) {
      onOpenLocalFileLink?.({ path, lineRange: null });
      return;
    }
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setJournalState("checking");
    try {
      const empty = await isTaskJournalEmpty(
        threadId,
        path,
        AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      );
      if (request.signal.aborted) return;
      if (empty) setJournalState("empty");
      else {
        setJournalState("idle");
        onOpenLocalFileLink?.({ path, lineRange: null });
      }
    } catch {
      if (!request.signal.aborted) setJournalState("error");
    }
  };
  const failed =
    notification.status === "failed" ||
    notification.status === "error" ||
    (notification.exitCode !== null && notification.exitCode !== 0);
  const running =
    notification.status === "running" ||
    notification.status === "pending" ||
    notification.status === "in_progress";
  const completed = notification.status === "completed";
  const cancelled =
    notification.status === "cancelled" ||
    notification.status === "killed" ||
    notification.status === "stopped";
  const title = failed
    ? "Фоновая задача завершилась с ошибкой"
    : running
      ? "Фоновая задача выполняется"
      : completed
        ? /^Agent "/.test(notification.summary)
          ? "Подагент завершил ответ"
          : "Фоновая задача завершена"
        : cancelled
          ? "Фоновая задача остановлена"
          : "Уведомление фоновой задачи";
  const outputFile = notification.outputFile;
  const canOpen =
    outputFile !== null &&
    !/[\u0000-\u001f]/.test(outputFile) &&
    (/^[a-z]:[\\/]/i.test(outputFile) || /^\/(?!\/)/.test(outputFile)) &&
    onOpenLocalFileLink !== undefined;
  const commandTitle =
    /^Background command "([\s\S]+)" (?:completed|failed)\b/.exec(
      notification.summary,
    )?.[1];
  return (
    <section
      aria-label="Уведомление фоновой задачи"
      className={`my-2 rounded-md border border-l-2 bg-surface-recessed px-3 py-2 text-xs leading-relaxed text-muted-foreground ${failed ? "border-destructive/40" : "border-border/50"}`}
    >
      <p className="mb-1 text-xs text-muted-foreground">
        Claude · служебное сообщение
      </p>
      <div
        className={`flex items-center gap-2 text-xs font-medium ${failed ? "text-destructive" : "text-foreground"}`}
      >
        <span aria-hidden="true">
          {failed ? "×" : running ? "◌" : completed ? "✓" : "•"}
        </span>
        <span>{title}</span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs">
        {commandTitle ?? notification.summary}
      </p>
      {notification.exitCode !== null ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Код завершения: {notification.exitCode}
        </p>
      ) : null}
      {notification.result ? (
        <>
          <Button
            className="mt-1 h-7 px-2 text-xs"
            size="sm"
            variant="outline"
            onClick={() => setResultOpen(true)}
          >
            Открыть результат
          </Button>
          <ResponsiveDrawerShell
            open={resultOpen}
            onOpenChange={setResultOpen}
            srLabel="Ответ подагента"
            contentClassName="left-auto top-0 mt-0 h-dvh max-h-dvh w-full max-w-3xl rounded-none"
          >
            <div className="flex items-center justify-between gap-3 border-b px-4 pb-3">
              <h2 className="text-sm font-medium text-foreground">
                Ответ подагента
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setResultOpen(false)}
              >
                Закрыть
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-foreground">
              <p className="mb-4 text-xs text-muted-foreground">
                {notification.summary}
              </p>
              <MarkdownPreview
                content={notification.result}
                allowHtml={false}
                imagePolicy="alt-text"
              />
            </div>
          </ResponsiveDrawerShell>
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer">Результат в чате</summary>
            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">
              {notification.result}
            </div>
          </details>
        </>
      ) : null}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Подробности</summary>
        {canOpen ? (
          <Button
            className="mt-1 h-7 px-2 text-xs"
            size="sm"
            variant="outline"
            disabled={journalState === "checking"}
            onClick={() => {
              void openJournal();
            }}
          >
            {journalState === "checking"
              ? "Проверяю журнал…"
              : "Открыть журнал"}
          </Button>
        ) : null}
        {journalState === "empty" ? (
          <p role="status" className="mt-1 text-xs text-muted-foreground">
            {notification.result
              ? "Журнал пуст — ответ находится в «Открыть результат»."
              : "Журнал пуст — записей пока нет."}
          </p>
        ) : journalState === "error" ? (
          <p role="status" className="mt-1 text-xs text-destructive">
            Не удалось проверить журнал. Попробуйте ещё раз.
          </p>
        ) : null}
        {notification.note ? (
          <p className="mt-2 whitespace-pre-wrap break-words">
            {notification.note}
          </p>
        ) : null}
        <dl className="mt-2 grid gap-1 break-words">
          <dt>Задача</dt>
          <dd>{notification.taskId}</dd>
          <dt>Статус</dt>
          <dd>{notification.status}</dd>
          {notification.toolUseId ? (
            <>
              <dt>Вызов инструмента</dt>
              <dd>{notification.toolUseId}</dd>
            </>
          ) : null}
          {outputFile ? (
            <>
              <dt>Файл журнала</dt>
              <dd>{outputFile}</dd>
            </>
          ) : null}
        </dl>
        <pre className="mt-3 whitespace-pre-wrap break-words">
          {originalText}
        </pre>
      </details>
    </section>
  );
}
