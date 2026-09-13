import {
  clampFontScalePercent,
  defaultFontScalePercent,
  defaultTypographyProfile,
  isTypographyProfileId,
  type FontScalePercent,
  type TypographyProfileId,
} from "@bb/domain";

export const TYPOGRAPHY_MIRROR_STORAGE_KEY = "bb.typography";
export const TYPOGRAPHY_DATA_ATTRIBUTE = "data-bb-typography";
export const TYPOGRAPHY_SCALE_PROPERTY = "--bb-font-scale";
export const TYPOGRAPHY_EXTERNAL_CHANGE_EVENT = "bb:typography-change";

export interface AppliedTypography {
  profile: TypographyProfileId;
  scalePercent: FontScalePercent;
}

export function typographyFromExternalChange(
  event: Event,
): AppliedTypography | null {
  // Plugin frontends can run in a separate JavaScript realm. `instanceof
  // CustomEvent` is therefore unreliable even though the event is delivered
  // through the shared host window.
  const detail = (event as CustomEvent<unknown>).detail as
    | Partial<AppliedTypography>
    | null
    | undefined;
  if (
    detail === null ||
    typeof detail !== "object" ||
    typeof detail.profile !== "string" ||
    !isTypographyProfileId(detail.profile) ||
    typeof detail.scalePercent !== "number" ||
    !Number.isFinite(detail.scalePercent)
  ) {
    return null;
  }
  return {
    profile: detail.profile,
    scalePercent: clampFontScalePercent(detail.scalePercent),
  };
}

let typographyEpoch = 0;
const typographySubscribers = new Set<() => void>();

export function subscribeTypographyChange(callback: () => void): () => void {
  typographySubscribers.add(callback);
  return () => {
    typographySubscribers.delete(callback);
  };
}

export function getTypographyEpoch(): number {
  return typographyEpoch;
}

function currentApplied(): AppliedTypography {
  const root = document.documentElement;
  const attr = root.getAttribute(TYPOGRAPHY_DATA_ATTRIBUTE);
  const profile = attr !== null && isTypographyProfileId(attr)
    ? attr
    : defaultTypographyProfile;
  const raw = Number.parseFloat(
    root.style.getPropertyValue(TYPOGRAPHY_SCALE_PROPERTY),
  );
  const scalePercent = Number.isFinite(raw)
    ? clampFontScalePercent(raw * 100)
    : defaultFontScalePercent;
  return { profile, scalePercent };
}

export function getAppliedTypography(): AppliedTypography {
  if (typeof document === "undefined") {
    return {
      profile: defaultTypographyProfile,
      scalePercent: defaultFontScalePercent,
    };
  }
  return currentApplied();
}

export function applyTypography(input: AppliedTypography): void {
  if (typeof document === "undefined") return;
  const applied: AppliedTypography = {
    profile: input.profile,
    scalePercent: clampFontScalePercent(input.scalePercent),
  };
  const root = document.documentElement;
  const next =
    applied.profile === defaultTypographyProfile
      ? null
      : applied.profile;
  if (next === null) {
    root.removeAttribute(TYPOGRAPHY_DATA_ATTRIBUTE);
  } else {
    root.setAttribute(TYPOGRAPHY_DATA_ATTRIBUTE, next);
  }
  root.style.setProperty(
    TYPOGRAPHY_SCALE_PROPERTY,
    String(applied.scalePercent / 100),
  );
  try {
    localStorage.setItem(
      TYPOGRAPHY_MIRROR_STORAGE_KEY,
      JSON.stringify({
        profile: applied.profile,
        scalePercent: applied.scalePercent,
      }),
    );
  } catch {}
  typographyEpoch += 1;
  typographySubscribers.forEach((callback) => callback());
}

function parseStoredMirror(
  stored: string | null,
): AppliedTypography | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored ?? "null");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { profile, scalePercent } = parsed as {
    profile?: unknown;
    scalePercent?: unknown;
  };
  if (typeof profile !== "string" || !isTypographyProfileId(profile)) {
    return null;
  }
  return {
    profile,
    scalePercent:
      typeof scalePercent === "number" && Number.isFinite(scalePercent)
        ? clampFontScalePercent(scalePercent)
        : defaultFontScalePercent,
  };
}

export function applyCachedTypography(): void {
  if (typeof document === "undefined") return;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(TYPOGRAPHY_MIRROR_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const cached = parseStoredMirror(stored);
  applyTypography(
    cached ?? {
      profile: defaultTypographyProfile,
      scalePercent: defaultFontScalePercent,
    },
  );
}
