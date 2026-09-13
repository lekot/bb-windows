import { useId, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import { useHoverPopover } from "../../ui/hooks/use-hover-popover.js";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  calculateContextWindowUsagePercent,
  formatCompactTokenCount,
} from "./thread-context-window-usage.js";

export interface ThreadCompactActionState {
  inFlight: boolean;
  error: string | null;
  disabledReason: string | null;
}

import {
  ContextWindowReveal,
  ThreadContextWindowDetails,
  ThreadContextWindowSegments,
} from "./ThreadContextWindowDetails.js";

interface ThreadContextWindowCardProps {
  usage: ThreadContextWindowUsage;
  className?: string;
}

interface ThreadContextWindowIndicatorProps {
  usage: ThreadContextWindowUsage | null;
  defaultOpen?: boolean;
  note?: string | null;
  sourceLabel?: string | null;
  tokenLabel?: string;
  onRequestCompact?: () => void;
  compactState?: ThreadCompactActionState | null;
}

const CONTEXT_WINDOW_POPOVER_CLOSE_DELAY_MS = 60;
const CONTEXT_WINDOW_LONG_PRESS_MS = 500;
const CONTEXT_WINDOW_LONG_PRESS_SLOP_PX = 10;
const CONTEXT_WINDOW_PANEL_CLASS_NAME =
  "w-80 rounded-md border bg-popover p-2 text-popover-foreground shadow-md max-md:w-full max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-4 max-md:pt-2 max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:shadow-none";

function isKeyboardFocus(target: HTMLElement): boolean {
  if (typeof target.matches !== "function") return true;
  try {
    return target.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function ThreadContextWindowCard({
  usage,
  className,
}: ThreadContextWindowCardProps) {
  const details = usage?.snapshot?.categories.length
    ? usage.snapshot
    : undefined;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const detailsId = useId();
  const usedPercent = calculateContextWindowUsagePercent(usage);
  const leftPercent = Math.max(0, 100 - usedPercent);
  const visualPercent = Math.min(Math.max(usedPercent, 0), 100);

  const toneClass =
    usedPercent >= 90
      ? "text-destructive"
      : usedPercent >= 75
        ? "text-warning-text"
        : "text-muted-foreground";

  const usedTokensLabel = formatCompactTokenCount(usage.usedTokens);
  const windowTokensLabel = formatCompactTokenCount(usage.modelContextWindow);
  const titleLabel = usage.estimated ? "Estimated context" : "Context window";

  return (
    <div
      className={cn(
        "@container/context-window w-56 rounded-md border bg-popover p-2 text-popover-foreground shadow-md max-md:px-4",
        details &&
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        details && detailsExpanded && "w-90",
        className,
      )}
    >
      <div className="flex flex-col gap-2 max-md:gap-3">
        <div className="flex items-baseline justify-between gap-2 text-xs max-md:text-sm">
          <span
            className={cn(
              "text-muted-foreground",
              details && detailsExpanded && "font-medium text-foreground",
            )}
          >
            {titleLabel}
          </span>
          <span className={cn("font-medium tabular-nums", toneClass)}>
            {usedPercent}% used
          </span>
        </div>
        <div
          className={cn(
            "relative h-1.5 w-full overflow-hidden rounded-full bg-border transition-[height] duration-200 motion-reduce:transition-none max-md:h-2",
            details && detailsExpanded && "order-2 h-4 max-md:h-5",
          )}
        >
          <div
            className={cn(
              "h-full rounded-full bg-current transition-opacity duration-200 ease-out motion-reduce:transition-none",
              toneClass,
              details && detailsExpanded && "opacity-0",
            )}
            style={{ width: `${visualPercent}%` }}
          />
          {details ? (
            <ThreadContextWindowSegments
              details={details}
              modelContextWindow={usage.modelContextWindow}
              visible={detailsExpanded}
            />
          ) : null}
        </div>
        <div
          className={cn(
            "flex items-baseline justify-between gap-2 text-xs tabular-nums text-muted-foreground max-md:text-sm",
            details && detailsExpanded && "order-1",
          )}
        >
          <span>
            <span
              className={cn(
                details && detailsExpanded && "font-medium text-foreground",
              )}
            >
              {usedTokensLabel}
            </span>{" "}
            / {windowTokensLabel} tokens
          </span>
          <span>{leftPercent}% left</span>
        </div>
      </div>
      {details ? (
        <>
          <div className="-mx-2 max-md:-mx-4">
            <ContextWindowReveal id={detailsId} open={detailsExpanded}>
              <ThreadContextWindowDetails
                details={details}
                capacity={usage.modelContextWindow}
              />
            </ContextWindowReveal>
          </div>
          <button
            type="button"
            className="ml-auto mt-2 flex cursor-pointer items-center gap-1.5 rounded-xs text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:mt-3 max-md:py-1 max-md:text-sm"
            aria-expanded={detailsExpanded}
            aria-controls={detailsId}
            onClick={() => setDetailsExpanded((value) => !value)}
          >
            {detailsExpanded ? "Hide details" : "Show details"}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              aria-hidden="true"
              className={cn(
                "size-3 transition-transform duration-200 ease-out motion-reduce:transition-none",
                detailsExpanded && "rotate-180",
              )}
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
        </>
      ) : null}
    </div>
  );
}

export function ThreadContextWindowIndicator({
  usage,
  defaultOpen,
  note,
  sourceLabel,
  tokenLabel,
  onRequestCompact,
  compactState = null,
}: ThreadContextWindowIndicatorProps) {
  const details = usage?.snapshot?.categories.length
    ? usage.snapshot
    : undefined;
  const {
    open: hoverOpen,
    triggerHoverProps,
    contentHoverProps,
    handleOpenChange,
  } = useHoverPopover({
    closeDelayMs: details ? 200 : CONTEXT_WINDOW_POPOVER_CLOSE_DELAY_MS,
    hoverableContent: details !== undefined,
  });
  const open = defaultOpen || hoverOpen;

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const pointerOverTriggerRef = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  const usedPercent = usage ? calculateContextWindowUsagePercent(usage) : null;
  const hasKnownWindow = usedPercent !== null;
  const visualPercent = hasKnownWindow
    ? Math.min(Math.max(usedPercent, 0), 100)
    : 0;

  const toneClass =
    hasKnownWindow && usedPercent >= 90
      ? "text-destructive"
      : hasKnownWindow && usedPercent >= 75
        ? "text-warning-text"
        : "text-muted-foreground";

  const indicatorSvg = (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4", toneClass)}
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r={6.5}
        fill="none"
        strokeWidth="2"
        className="stroke-border-hairline"
      />
      {hasKnownWindow ? (
        <circle
          cx="8"
          cy="8"
          r={6.5}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 6.5}
          strokeDashoffset={2 * Math.PI * 6.5 * (1 - visualPercent / 100)}
          transform="rotate(-90 8 8)"
        />
      ) : (
        <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      )}
    </svg>
  );

  const usedTokensLabel = usage
    ? formatCompactTokenCount(usage.usedTokens)
    : tokenLabel;
  const cardTitleLabel = usage
    ? usage.estimated
      ? "Estimated context"
      : "Context window"
    : "Окно контекста";
  const usedLabel = usage
    ? `Занято ${usage.estimated ? "~" : ""}${usedPercent}% окна`
    : "Размер окна контекста не подтверждён";
  const compactEnabled =
    onRequestCompact !== undefined &&
    compactState !== null &&
    !compactState.inFlight &&
    compactState.disabledReason === null;
  const compactTitle =
    onRequestCompact === undefined
      ? usedLabel
      : compactState?.disabledReason !== null &&
          compactState?.disabledReason !== undefined
        ? `Сжатие контекста: ${compactState.disabledReason}`
        : compactState?.inFlight
          ? "Сжимаю контекст…"
          : "Сжать контекст (клик). Подробности — наведение, фокус или долгое нажатие";

  const ringButton =
    onRequestCompact === undefined ? (
      <button
        type="button"
        {...triggerHoverProps}
        className="-m-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={usedLabel}
        title={usedLabel}
      >
        {indicatorSvg}
      </button>
    ) : (
      <button
        type="button"
        aria-disabled={!compactEnabled}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (event.button !== 0) return;
          suppressClickRef.current = false;
          longPressOriginRef.current = { x: event.clientX, y: event.clientY };
          longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            longPressOriginRef.current = null;
            suppressClickRef.current = true;
            handleOpenChange(true);
          }, CONTEXT_WINDOW_LONG_PRESS_MS);
        }}
        onPointerMove={(event) => {
          const origin = longPressOriginRef.current;
          if (origin === null) return;
          const distance = Math.hypot(
            event.clientX - origin.x,
            event.clientY - origin.y,
          );
          if (distance >= CONTEXT_WINDOW_LONG_PRESS_SLOP_PX) cancelLongPress();
        }}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onClick={(event) => {
          event.stopPropagation();
          cancelLongPress();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (compactEnabled) onRequestCompact();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            handleOpenChange(false);
          }
        }}
        onFocus={(event) => {
          triggerHoverProps.onFocus();
          if (isKeyboardFocus(event.currentTarget)) handleOpenChange(true);
        }}
        onBlur={() => {
          triggerHoverProps.onBlur();
          if (!pointerOverTriggerRef.current) handleOpenChange(false);
        }}
        className="-m-1 inline-flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-default"
        aria-label={compactTitle}
        title={compactTitle}
      >
        {indicatorSvg}
      </button>
    );

  return (
    <span className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <span
            className="inline-flex"
            onPointerEnter={() => {
              pointerOverTriggerRef.current = true;
              triggerHoverProps.onPointerEnter();
            }}
            onPointerLeave={() => {
              pointerOverTriggerRef.current = false;
              triggerHoverProps.onPointerLeave();
            }}
          >
            {ringButton}
          </span>
        </PopoverTrigger>
        {usage ? (
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            {...contentHoverProps}
            mobileTitle={cardTitleLabel}
            className="w-auto border-0 bg-transparent p-0 shadow-none max-md:p-0"
          >
            <ThreadContextWindowCard
              usage={usage}
              className="max-md:w-full max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:px-4 max-md:pt-2 max-md:pb-[max(1rem,env(safe-area-inset-bottom))] max-md:shadow-none"
            />
          </PopoverContent>
        ) : (
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            {...contentHoverProps}
            mobileTitle={cardTitleLabel}
            className={CONTEXT_WINDOW_PANEL_CLASS_NAME}
          >
            <div className="space-y-2 max-md:space-y-3">
              {note ? (
                <p className="text-xs text-muted-foreground">{note}</p>
              ) : null}
              {usedTokensLabel ? (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {usedTokensLabel}
                </p>
              ) : null}
            </div>
          </PopoverContent>
        )}
      </Popover>
      {compactState?.error ? (
        <span
          role="alert"
          className="max-w-48 truncate text-xs text-destructive"
          title={compactState.error}
        >
          {compactState.error}
        </span>
      ) : null}
      {compactState?.inFlight ? (
        <span className="text-xs text-muted-foreground">Сжимаю…</span>
      ) : null}
      {sourceLabel ? (
        <span className="whitespace-nowrap text-xs leading-none text-muted-foreground tabular-nums">
          замер {sourceLabel}
        </span>
      ) : null}
    </span>
  );
}
