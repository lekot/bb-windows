import { describe, expect, it } from "vitest";
import {
  appThemeSchema,
  appThemeSelectionSchema,
  defaultAppTheme,
  defaultFontScalePercent,
  defaultTypographyProfile,
  FONT_SCALE_MAX_PERCENT,
  FONT_SCALE_MIN_PERCENT,
  fontScalePercentSchema,
  clampFontScalePercent,
  snapFontScalePercent,
  stepFontScalePercent,
  TYPOGRAPHY_PROFILE_IDS,
  typographyProfileSchema,
  typographyProfiles,
} from "../src/index.js";

describe("typography profiles", () => {
  it("accepts every documented profile id", () => {
    for (const id of TYPOGRAPHY_PROFILE_IDS) {
      expect(typographyProfileSchema.parse(id)).toBe(id);
    }
  });

  it("rejects unknown profile ids", () => {
    expect(typographyProfileSchema.safeParse("fold").success).toBe(false);
    expect(typographyProfileSchema.safeParse("").success).toBe(false);
  });

  it("has unique metadata with labels for every profile", () => {
    expect(typographyProfiles.map((profile) => profile.id)).toEqual(
      TYPOGRAPHY_PROFILE_IDS,
    );
    const names = new Set(typographyProfiles.map((profile) => profile.name));
    const labels = new Set(typographyProfiles.map((profile) => profile.label));
    expect(names.size).toBe(typographyProfiles.length);
    expect(labels.size).toBe(typographyProfiles.length);
  });
});

describe("font scale", () => {
  it("accepts integers within the documented range", () => {
    expect(fontScalePercentSchema.parse(FONT_SCALE_MIN_PERCENT)).toBe(90);
    expect(fontScalePercentSchema.parse(100)).toBe(100);
    expect(fontScalePercentSchema.parse(FONT_SCALE_MAX_PERCENT)).toBe(110);
  });

  it("rejects out-of-range and fractional values", () => {
    expect(fontScalePercentSchema.safeParse(89).success).toBe(false);
    expect(fontScalePercentSchema.safeParse(111).success).toBe(false);
    expect(fontScalePercentSchema.safeParse(102.5).success).toBe(false);
  });

  it("clamps, steps, and snaps to the 5% grid", () => {
    expect(clampFontScalePercent(50)).toBe(FONT_SCALE_MIN_PERCENT);
    expect(clampFontScalePercent(200)).toBe(FONT_SCALE_MAX_PERCENT);
    expect(stepFontScalePercent(100, 1)).toBe(105);
    expect(stepFontScalePercent(100, -1)).toBe(95);
    expect(stepFontScalePercent(FONT_SCALE_MAX_PERCENT, 1)).toBe(
      FONT_SCALE_MAX_PERCENT,
    );
    expect(snapFontScalePercent(97)).toBe(95);
    expect(snapFontScalePercent(98)).toBe(100);
  });
});

describe("app theme typography contract", () => {
  it("fills typography defaults when a stored payload predates them", () => {
    const parsed = appThemeSchema.parse({
      themeId: "default",
      customCss: null,
      faviconColor: "default",
      resolvedCodeTheme: defaultAppTheme.resolvedCodeTheme,
    });
    expect(parsed.typographyProfile).toBe(defaultTypographyProfile);
    expect(parsed.fontScalePercent).toBe(defaultFontScalePercent);
  });

  it("keeps typography explicit once set", () => {
    const parsed = appThemeSchema.parse({
      ...defaultAppTheme,
      typographyProfile: "editorial",
      fontScalePercent: 105,
    });
    expect(parsed.typographyProfile).toBe("editorial");
    expect(parsed.fontScalePercent).toBe(105);
  });

  it("treates omitted typography fields as keep-current on writes", () => {
    const selection = appThemeSelectionSchema.parse({
      themeId: "nord",
      faviconColor: "default",
    });
    expect(selection.typographyProfile).toBeUndefined();
    expect(selection.fontScalePercent).toBeUndefined();

    const withTypography = appThemeSelectionSchema.parse({
      themeId: "nord",
      faviconColor: "default",
      typographyProfile: "techno",
      fontScalePercent: 95,
    });
    expect(withTypography.typographyProfile).toBe("techno");
    expect(withTypography.fontScalePercent).toBe(95);
  });

  it("rejects invalid typography values on writes", () => {
    expect(
      appThemeSelectionSchema.safeParse({
        themeId: "nord",
        faviconColor: "default",
        typographyProfile: "nope",
      }).success,
    ).toBe(false);
    expect(
      appThemeSelectionSchema.safeParse({
        themeId: "nord",
        faviconColor: "default",
        fontScalePercent: 130,
      }).success,
    ).toBe(false);
  });
});
