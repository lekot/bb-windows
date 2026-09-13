import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultFaviconColor,
  defaultFontScalePercent,
  defaultTypographyProfile,
} from "@bb/domain";
import {
  getStoredAppearance,
  getStoredFaviconColor,
  getStoredThemeId,
  setStoredAppearance,
  type DbConnection,
} from "../../src/index.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

describe("app theme data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => {
    db.$client.close();
  });

  it("returns defaults before anything is stored", () => {
    expect(getStoredAppearance(db)).toEqual({
      themeId: "default",
      faviconColor: defaultFaviconColor,
      typographyProfile: defaultTypographyProfile,
      fontScalePercent: defaultFontScalePercent,
    });
  });

  it("persists the full appearance including typography", () => {
    setStoredAppearance(db, {
      themeId: "nord",
      faviconColor: "teal",
      typographyProfile: "editorial",
      fontScalePercent: 105,
    });

    expect(getStoredAppearance(db)).toEqual({
      themeId: "nord",
      faviconColor: "teal",
      typographyProfile: "editorial",
      fontScalePercent: 105,
    });
    expect(getStoredThemeId(db)).toBe("nord");
    expect(getStoredFaviconColor(db)).toBe("teal");
  });

  it("keeps typography when a caller re-writes palette fields only", () => {
    setStoredAppearance(db, {
      themeId: "nord",
      faviconColor: "default",
      typographyProfile: "techno",
      fontScalePercent: 95,
    });
    const stored = getStoredAppearance(db);
    setStoredAppearance(db, {
      themeId: "dracula",
      faviconColor: stored.faviconColor,
      typographyProfile: stored.typographyProfile,
      fontScalePercent: stored.fontScalePercent,
    });

    expect(getStoredAppearance(db)).toMatchObject({
      themeId: "dracula",
      typographyProfile: "techno",
      fontScalePercent: 95,
    });
  });
});
