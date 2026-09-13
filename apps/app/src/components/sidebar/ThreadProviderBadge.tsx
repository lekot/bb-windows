import type { MouseEventHandler } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { useSystemProviders } from "@/hooks/queries/system-queries";

interface ThreadProviderBadgeProps {
  onClick?: MouseEventHandler<HTMLSpanElement>;
  providerId: string;
}

export function ThreadProviderBadge({
  onClick,
  providerId,
}: ThreadProviderBadgeProps) {
  const provider = useSystemProviders().data?.find(
    (candidate) => candidate.id === providerId,
  );
  const providerIcon = getProviderIconInfo("agent", providerId, provider ?? null);
  const ProviderIcon = providerIcon?.icon;
  const label = provider?.displayName ?? providerIcon?.ariaLabel ?? providerId;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-sidebar-thread-provider-badge={providerId}
          role="img"
          aria-label={label}
          title={label}
          className="relative top-px z-10 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground"
          onClick={onClick}
        >
          {ProviderIcon ? (
            provider ? (
              <ProviderIconMark
                provider={provider}
                icon={ProviderIcon}
                className="size-3.5"
              />
            ) : (
              <ProviderIcon className="size-3.5" />
            )
          ) : (
            <Icon name="Bot" className="size-3.5" aria-hidden="true" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
