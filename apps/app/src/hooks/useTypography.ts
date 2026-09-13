import { useEffect, useSyncExternalStore } from "react";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  applyTypography,
  getAppliedTypography,
  getTypographyEpoch,
  subscribeTypographyChange,
  TYPOGRAPHY_EXTERNAL_CHANGE_EVENT,
  typographyFromExternalChange,
  type AppliedTypography,
} from "@/lib/typography";

export function useTypography(): void {
  const { data } = useSystemConfig();
  const appearance = data?.appearance;

  useEffect(() => {
    if (appearance === undefined) return;
    applyTypography({
      profile: appearance.typographyProfile,
      scalePercent: appearance.fontScalePercent,
    });
  }, [appearance?.typographyProfile, appearance?.fontScalePercent]);

  useEffect(() => {
    const syncExternalTypography = (event: Event) => {
      const next = typographyFromExternalChange(event);
      if (next !== null) applyTypography(next);
    };
    document.addEventListener(
      TYPOGRAPHY_EXTERNAL_CHANGE_EVENT,
      syncExternalTypography,
    );
    return () => {
      document.removeEventListener(
        TYPOGRAPHY_EXTERNAL_CHANGE_EVENT,
        syncExternalTypography,
      );
    };
  }, []);
}

export function useTypographyEpoch(): number {
  return useSyncExternalStore(
    subscribeTypographyChange,
    getTypographyEpoch,
    getTypographyEpoch,
  );
}

export function useAppliedTypography(): AppliedTypography {
  useTypographyEpoch();
  return getAppliedTypography();
}
