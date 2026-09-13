import type { PermissionMode } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { useState } from "react";
import { PromptStackCard } from "./PromptStackCard";
import type { NativePermissionObservation } from "@/hooks/queries/native-permission-mismatch";

interface NativePermissionMismatchCardProps {
  canApply?: boolean;
  disabled?: boolean;
  observation: NativePermissionObservation;
  onApply: (mode: PermissionMode) => void;
  threadId?: string;
}

function dismissalSignature(observation: NativePermissionObservation): string {
  return observation.kind === "unknown"
    ? `unknown:${observation.currentMode}:${observation.observedMode}`
    : `mismatch:${observation.currentMode}:${observation.nativeMode}:${observation.observedMode}`;
}

function dismissalStorageKey(threadId: string): string {
  return `bb.native-permission-mismatch.dismissed.${threadId}`;
}

function permissionModeLabel(mode: PermissionMode): string {
  switch (mode) {
    case "full":
      return "Полный доступ";
    case "auto":
      return "Авто";
    case "accept-edits":
      return "Правки без подтверждения";
  }
}

function selectInBbButtonLabel(mode: PermissionMode): string {
  return `Выбрать в bb: ${permissionModeLabel(mode)}`;
}

export function NativePermissionMismatchCard({
  canApply = true,
  disabled = false,
  observation,
  onApply,
  threadId,
}: NativePermissionMismatchCardProps) {
  const isUnknown = observation.kind === "unknown";
  const signature = dismissalSignature(observation);
  const storageKey = threadId ? dismissalStorageKey(threadId) : null;
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(
    () => {
      if (storageKey === null || typeof sessionStorage === "undefined") {
        return null;
      }
      try {
        return sessionStorage.getItem(storageKey);
      } catch {
        return null;
      }
    },
  );

  if (dismissedSignature === signature) {
    return null;
  }

  const dismiss = () => {
    if (storageKey !== null) {
      try {
        sessionStorage.setItem(storageKey, signature);
      } catch {
        // Dismissal still applies for this render session when storage is unavailable.
      }
    }
    setDismissedSignature(signature);
  };

  return (
    <PromptStackCard
      ariaLabel="Native session permission mode"
      className="relative overflow-hidden"
    >
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-8 flex-wrap items-center gap-1.5 py-1.5 pl-3 pr-10 text-xs"
      >
        <Icon
          name="AlertTriangle"
          className="size-3.5 shrink-0 text-warning-text"
          aria-hidden="true"
        />
        <span className="shrink-0 font-medium text-foreground">
          Разрешения исходной сессии
        </span>
        <span className="min-w-0 flex-1 text-muted-foreground">
          {isUnknown
            ? `В исходной сессии: ${observation.observedMode}. Сопоставление недоступно; выбор в bb не изменён.`
            : `Последний замер исходной сессии: ${permissionModeLabel(observation.nativeMode)}; выбрано в bb: ${permissionModeLabel(observation.currentMode)}. Выбор в bb действует на следующее сообщение и не изменяет исходную сессию.${observation.nativeMode === "full" ? " Полный доступ — без обычных запросов подтверждения." : ""}`}
        </span>
        {!isUnknown ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center whitespace-nowrap rounded border border-border bg-background px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || !canApply}
            onClick={() => onApply(observation.nativeMode)}
          >
            {selectInBbButtonLabel(observation.nativeMode)}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Скрыть уведомление о разрешениях"
          className="absolute right-1.5 top-1.5 z-10 inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={dismiss}
        >
          <Icon name="X" className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </PromptStackCard>
  );
}
