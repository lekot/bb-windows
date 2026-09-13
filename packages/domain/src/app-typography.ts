import { z } from "zod";

export const TYPOGRAPHY_PROFILE_IDS = [
  "standard",
  "compact",
  "readable",
  "editorial",
  "techno",
] as const;
export type TypographyProfileId = (typeof TYPOGRAPHY_PROFILE_IDS)[number];

export const typographyProfileSchema = z.enum(TYPOGRAPHY_PROFILE_IDS);
export type TypographyProfile = z.infer<typeof typographyProfileSchema>;

export function isTypographyProfileId(
  value: string,
): value is TypographyProfileId {
  return (TYPOGRAPHY_PROFILE_IDS as readonly string[]).includes(value);
}

interface TypographyProfileMeta {
  id: TypographyProfileId;
  name: string;
  label: string;
  hint: string;
}

export const typographyProfiles: readonly TypographyProfileMeta[] = [
  {
    id: "standard",
    name: "Standard",
    label: "Стандарт",
    hint: "Inter · system mono",
  },
  {
    id: "compact",
    name: "Compact",
    label: "Компакт",
    hint: "Fact · Magistral",
  },
  {
    id: "readable",
    name: "Readable",
    label: "Читаемый",
    hint: "Frutiger · PT Mono",
  },
  {
    id: "editorial",
    name: "Editorial",
    label: "Редакционный",
    hint: "Fact · Crassula",
  },
  {
    id: "techno",
    name: "Techno",
    label: "Техно",
    hint: "PT Mono · Magistral",
  },
];

export const FONT_SCALE_MIN_PERCENT = 90;
export const FONT_SCALE_MAX_PERCENT = 110;
export const FONT_SCALE_STEP_PERCENT = 5;

export const fontScalePercentSchema = z
  .number()
  .int()
  .min(FONT_SCALE_MIN_PERCENT)
  .max(FONT_SCALE_MAX_PERCENT);
export type FontScalePercent = z.infer<typeof fontScalePercentSchema>;

export function clampFontScalePercent(value: number): FontScalePercent {
  return Math.min(
    FONT_SCALE_MAX_PERCENT,
    Math.max(FONT_SCALE_MIN_PERCENT, Math.round(value)),
  );
}

export function stepFontScalePercent(
  value: number,
  delta: number,
): FontScalePercent {
  return clampFontScalePercent(
    Math.round(value) + Math.sign(delta) * FONT_SCALE_STEP_PERCENT,
  );
}

export function snapFontScalePercent(value: number): FontScalePercent {
  const stepped =
    Math.round(value / FONT_SCALE_STEP_PERCENT) * FONT_SCALE_STEP_PERCENT;
  return clampFontScalePercent(stepped);
}

export const defaultTypographyProfile: TypographyProfileId = "standard";
export const defaultFontScalePercent: FontScalePercent = 100;
