import {
  typographyProfiles,
  type TypographyProfileId,
} from "@bb/domain";

export const TYPOGRAPHY_SETTING_DESCRIPTION =
  "Orthogonal to the color palette: profiles swap font families and density for the UI, headings, and code.";

export const FONT_SCALE_STEPPER_BUTTON_CLASS =
  "h-7 w-7 justify-center border-border/60 bg-card p-0 text-xs";

export function typographyProfileLabel(id: TypographyProfileId): string {
  return typographyProfiles.find((profile) => profile.id === id)?.label ?? id;
}

export function typographyProfileHint(id: TypographyProfileId): string {
  return typographyProfiles.find((profile) => profile.id === id)?.hint ?? "";
}
