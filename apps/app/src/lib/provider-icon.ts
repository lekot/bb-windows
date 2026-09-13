import type { PluginProviderIconRegistration } from "@get-bb/plugin-sdk/app";
import type { CSSProperties, ComponentType } from "react";
import { createElement } from "react";
import { isPresentationTintColor, type ProviderInfo } from "@bb/domain";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";

interface ProviderIconInfo {
  icon: ComponentType<{ className?: string }>;
  ariaLabel: string;
}

const ZCodeAppIcon: ComponentType<{ className?: string }> = ({ className }) =>
  createElement("img", {
    src: "/zcode-app-icon.png",
    alt: "",
    "aria-hidden": "true",
    className: `${className ?? ""} scale-125 -translate-y-px`.trim(),
  });
interface ProviderIconSource {
  logoUrl: string | null;
  icon?: { glyph: string };
  family?: string;
  displayName?: string;
}

const providerIcons = new Map<string, ComponentType<{ className?: string }>>();

export function getProviderIconInfo(
  providerKind: PluginProviderIconRegistration["providerKind"],
  providerId: string,
  source: ProviderIconSource | null = null,
): ProviderIconInfo {
  if (providerId === "acp-zcode") {
    return { icon: ZCodeAppIcon, ariaLabel: "ZCode" };
  }
  const cacheKey = JSON.stringify([
    providerKind,
    providerId,
    source?.logoUrl,
    source?.icon?.glyph,
  ]);
  let icon = providerIcons.get(cacheKey);
  if (icon === undefined) {
    const ResolvedProviderIcon: ComponentType<{ className?: string }> = ({
      className,
    }) =>
      createElement(ProviderIcon, {
        providerKind,
        provider: {
          id: providerId,
          logoUrl: source?.logoUrl,
          icon: source?.icon,
        },
        className,
      });
    icon = ResolvedProviderIcon;
    providerIcons.set(cacheKey, icon);
  }
  return {
    icon,
    ariaLabel:
      source?.displayName ??
      (source?.family === "acp" ? "ACP provider" : providerId),
  };
}

export function getProviderIconTintStyle(
  provider: Pick<ProviderInfo, "strings"> | undefined,
): CSSProperties | undefined {
  const tint = provider?.strings?.iconTint;
  if (
    tint === undefined ||
    !isPresentationTintColor(tint.light) ||
    !isPresentationTintColor(tint.dark)
  ) {
    return undefined;
  }
  return { color: `light-dark(${tint.light.trim()}, ${tint.dark.trim()})` };
}
