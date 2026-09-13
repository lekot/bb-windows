import { useCallback, useEffect } from "react";
import type { FontScalePercent, TypographyProfileId } from "@bb/domain";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useUpdateAppearance } from "@/hooks/mutations/settings-mutations";
import { applyTypography } from "@/lib/typography";

export interface TypographySelectionChange {
  typographyProfile: TypographyProfileId;
  fontScalePercent: FontScalePercent;
}

// A route change can unmount the typography control before system config has
// finished loading. Keep the pending choice outside the component so the next
// screen can persist it instead of restoring the previous server value.
let pendingTypographySelection: TypographySelectionChange | null = null;

export function useTypographySelection(): {
  isPending: boolean;
  setTypography: (next: TypographySelectionChange) => void;
} {
  const { data } = useSystemConfig();
  const appearance = data?.appearance;
  const updateAppearance = useUpdateAppearance();

  useEffect(() => {
    if (appearance === undefined || pendingTypographySelection === null) return;
    const next = pendingTypographySelection;
    pendingTypographySelection = null;
    updateAppearance.mutate({
      themeId: appearance.themeId,
      faviconColor: appearance.faviconColor,
      ...next,
    });
  }, [appearance, updateAppearance]);

  const setTypography = useCallback(
    (next: TypographySelectionChange) => {
      applyTypography({
        profile: next.typographyProfile,
        scalePercent: next.fontScalePercent,
      });
      if (appearance === undefined) {
        pendingTypographySelection = next;
        return;
      }
      pendingTypographySelection = null;
      updateAppearance.mutate({
        themeId: appearance.themeId,
        faviconColor: appearance.faviconColor,
        ...next,
      });
    },
    [appearance, updateAppearance],
  );

  return { isPending: updateAppearance.isPending, setTypography };
}
