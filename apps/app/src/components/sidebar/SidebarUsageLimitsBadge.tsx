import { useMemo, useState } from "react";
import type { ProviderInfo } from "@bb/domain";
import type {
  ProviderUsage,
  ProviderUsageResponse,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  barColorClass,
  formatReset,
  usageWindowValue,
} from "@/components/settings/UsageLimitsSettingsSection";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import {
  useSystemConfig,
  useSystemProviderUsageLimits,
  useSystemProviders,
  type ProviderUsageQueryState,
} from "@/hooks/queries/system-queries";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { getProviderIconInfo } from "@/lib/provider-icon";

const KEY_WINDOW_LABEL = "current session";
const IDLE_USAGE_REFRESH_INTERVAL_MS = 5 * 60_000;

interface ProviderUsageChip {
  providerId: string;
  displayName: string;
  provider: ProviderInfo | undefined;
  remainingPercent: number | null;
  windows: ProviderUsageWindow[];
  hint: string | null;
}

function remainingPercentFor(window: ProviderUsageWindow | undefined): number | null {
  if (window === undefined) return null;
  return Math.min(100, Math.max(0, Math.round(100 - window.usedPercent)));
}

function keyWindow(windows: readonly ProviderUsageWindow[]): ProviderUsageWindow | undefined {
  return (
    windows.find(
      (window) => window.label.toLowerCase() === KEY_WINDOW_LABEL,
    ) ?? windows[0]
  );
}

function namedWindow(
  windows: readonly ProviderUsageWindow[],
  label: string,
): ProviderUsageWindow | undefined {
  return windows.find(
    (window) => window.label.toLowerCase() === label.toLowerCase(),
  );
}

function unavailableHint(
  usage: ProviderUsage | undefined,
  provider: ProviderInfo | undefined,
): string | null {
  const name = provider?.displayName ?? "This provider";
  if (usage === undefined) return `${name} usage is loading.`;
  switch (usage.status) {
    case "unauthenticated":
      return provider?.strings?.signInHint ?? `Sign in to ${name} to see usage.`;
    case "expired":
      return (
        provider?.strings?.expiredHint ??
        `Your ${name} session expired. Sign in again.`
      );
    case "error":
      return usage.message;
    case "not_installed":
      return `${name} is not installed on this machine.`;
    default:
      return null;
  }
}

function buildChips(args: {
  providers: readonly ProviderInfo[];
  usage: ProviderUsageResponse;
  providerStates: Record<string, ProviderUsageQueryState>;
}): ProviderUsageChip[] {
  return args.providers.flatMap((provider) => {
    const usage = args.usage[provider.id];
    if (usage?.status === "not_installed") return [];
    const state = args.providerStates[provider.id];
    const ok = usage?.status === "ok";
    const windows = ok ? usage.windows : [];
    const remaining = remainingPercentFor(keyWindow(windows));
    return [{
      providerId: provider.id,
      displayName: provider.id === "acp-zcode" ? "GLM" : provider.displayName,
      provider,
      remainingPercent: remaining,
      windows,
      hint:
        state?.isError === true
          ? `Couldn't load ${provider.displayName} usage right now.`
          : unavailableHint(usage, provider),
    }];
  });
}

function ChipPercent({ chip }: { chip: ProviderUsageChip }) {
  if (chip.remainingPercent !== null) {
    const tone =
      chip.remainingPercent <= 10
        ? "font-medium text-destructive"
        : chip.remainingPercent <= 20
          ? "font-medium text-warning"
          : "font-medium text-sidebar-foreground";
    return (
      <span className={cn("relative top-px tabular-nums", tone)}>
        {chip.remainingPercent}%
      </span>
    );
  }
  return (
    <span
      className="relative top-px text-muted-foreground/70"
      aria-label="usage unavailable"
    >
      —
    </span>
  );
}

function CompactPercentValue({ remaining }: { remaining: number | null }) {
  if (remaining === null) {
    return <span className="text-muted-foreground/70">—</span>;
  }
  return (
    <span
      className={cn(
        remaining <= 10
          ? "font-medium text-destructive"
          : remaining <= 20
            ? "font-medium text-warning"
            : "font-medium text-sidebar-foreground",
      )}
    >
      {remaining}%
    </span>
  );
}

function CompactChipUsage({ chip }: { chip: ProviderUsageChip }) {
  if (chip.providerId !== "claude-code") {
    return <ChipPercent chip={chip} />;
  }
  const current = remainingPercentFor(keyWindow(chip.windows));
  const weekly = remainingPercentFor(namedWindow(chip.windows, "Weekly limit"));
  const fable = remainingPercentFor(namedWindow(chip.windows, "Fable"));
  const value = (remaining: number | null) =>
    remaining === null ? "—" : `${remaining}%`;
  return (
    <span
      className="relative top-px whitespace-nowrap tabular-nums text-sidebar-foreground"
      title={`5 hours: ${value(current)} · Weekly: ${value(weekly)} · Fable: ${value(fable)}`}
    >
      <CompactPercentValue remaining={current} /> ·{" "}
      <CompactPercentValue remaining={weekly} /> ·{" "}
      <CompactPercentValue remaining={fable} />
    </span>
  );
}

function ChipProviderIcon({ chip }: { chip: ProviderUsageChip }) {
  if (chip.providerId === "acp-zcode") {
    return (
      <span
        data-provider-icon="acp-zcode"
        className="flex size-3 shrink-0 items-center justify-center"
        title="GLM"
      >
        <img
          aria-hidden="true"
          className="size-3"
          src="/zcode-app-icon.png"
          alt=""
          draggable={false}
        />
      </span>
    );
  }
  const iconInfo = getProviderIconInfo(
    "agent",
    chip.providerId,
    chip.provider ?? null,
  );
  const ProviderIcon = iconInfo?.icon;
  return (
    <span
      className={cn(
        "flex size-3 shrink-0 items-center justify-center",
        chip.remainingPercent === null && "opacity-50",
      )}
      title={chip.displayName}
    >
      {ProviderIcon ? (
        <ProviderIconMark
          provider={{
            id: chip.providerId,
            strings: chip.provider?.strings,
          }}
          icon={ProviderIcon}
          className="size-3"
        />
      ) : (
        <span className="size-3 rounded-sm bg-muted-foreground/40" />
      )}
    </span>
  );
}

function PopoverWindowRow({ window }: { window: ProviderUsageWindow }) {
  const reset = formatReset(window.resetsAt);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-foreground">{window.label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {usageWindowValue(window)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", barColorClass(window.usedPercent))}
          style={{ width: `${Math.max(window.usedPercent, 2)}%` }}
        />
      </div>
      {reset ? <p className="text-xs text-muted-foreground">{reset}</p> : null}
    </div>
  );
}

export function SidebarUsageLimitsBadge() {
  const [open, setOpen] = useState(false);
  const systemConfigQuery = useSystemConfig();
  const hostsQuery = useHosts();
  const primaryHost = selectPrimaryHost(
    hostsQuery.data,
    systemConfigQuery.data?.primaryHostId ?? null,
  );
  const usageHostId =
    primaryHost?.id ??
    systemConfigQuery.data?.primaryHostId ??
    undefined;
  const providersQuery = useSystemProviders(
    usageHostId === undefined
      ? {
          capability: "usage",
          enabled: systemConfigQuery.data !== undefined,
        }
      : {
          capability: "usage",
          enabled: systemConfigQuery.data !== undefined,
          hostId: usageHostId,
        },
  );
  const providers = providersQuery.data ?? [];
  const usageQuery = useSystemProviderUsageLimits({
    ...(usageHostId === undefined ? {} : { hostId: usageHostId }),
    enabled: systemConfigQuery.data !== undefined && providersQuery.isSuccess,
    providerIds: providers.map((provider) => provider.id),
    refetchIntervalMs: IDLE_USAGE_REFRESH_INTERVAL_MS,
  });

  const chips = useMemo(
    () =>
      buildChips({
        providers,
        usage: usageQuery.usage,
        providerStates: usageQuery.providerStates,
      }),
    [providers, usageQuery.usage, usageQuery.providerStates],
  );

  const hasAnyWindow = chips.some((chip) => chip.windows.length > 0);
  const hasAnyHint = chips.some((chip) => chip.hint !== null);
  if (providers.length === 0) {
    if (providersQuery.isLoading || systemConfigQuery.isLoading) {
      return (
        <div
          data-testid="sidebar-usage-limits"
          className="px-2 pb-1 group-data-[collapsible=icon]:hidden"
        >
          <div className="h-[23px] w-40 animate-pulse rounded-full bg-sidebar-accent" />
        </div>
      );
    }
    return null;
  }

  return (
    <div
      data-testid="sidebar-usage-limits"
      className="px-1 pb-0.5 group-data-[collapsible=icon]:hidden"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Provider usage limits"
            data-testid="sidebar-usage-limits-trigger"
            className={cn(
              "flex h-[23px] w-full items-center rounded-md border border-sidebar-border px-3",
              "text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
          >
            <span className="flex min-w-0 flex-1 items-center justify-between overflow-hidden">
              {chips.slice(0, 4).map((chip) => (
                <span
                  key={chip.providerId}
                  className="flex shrink-0 items-center justify-center gap-1"
                  title={
                    chip.remainingPercent !== null
                      ? `${chip.displayName}: ${chip.remainingPercent}% of the current session window left`
                      : `${chip.displayName}: usage unavailable`
                  }
                >
                  <ChipProviderIcon chip={chip} />
                  <CompactChipUsage chip={chip} />
                </span>
              ))}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          className="w-72"
          data-testid="sidebar-usage-limits-popover"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  Usage limits
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {primaryHost ? primaryHost.name : "Primary machine"} ·
                  subscription usage
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                disabled={usageQuery.isFetching}
                onClick={() => {
                  void usageQuery.refetch();
                }}
                aria-label={
                  usageQuery.isFetching
                    ? "Reloading usage data"
                    : "Reload usage data"
                }
                data-testid="sidebar-usage-limits-refresh"
              >
                <Icon
                  name="RotateCcw"
                  className={cn(
                    "size-3.5",
                    usageQuery.isFetching && "animate-spin",
                  )}
                />
              </Button>
            </div>
            {chips.map((chip) => (
              <div key={chip.providerId} className="space-y-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <div className="flex min-w-0 items-center gap-2">
                  <ChipProviderIcon chip={chip} />
                  <span className="truncate text-xs font-medium text-foreground">
                    {chip.displayName}
                  </span>
                  <span className="ml-auto shrink-0">
                    <ChipPercent chip={chip} />
                  </span>
                </div>
                {chip.windows.length > 0 ? (
                  <div className="space-y-2.5">
                    {chip.windows.map((window) => (
                      <PopoverWindowRow key={window.label} window={window} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {chip.hint ?? "No usage limits reported for this plan."}
                  </p>
                )}
              </div>
            ))}
            {!hasAnyWindow && !hasAnyHint ? (
              <p className="text-xs text-muted-foreground">
                No usage windows reported right now.
              </p>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
