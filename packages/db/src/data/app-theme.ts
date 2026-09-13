import { eq } from "drizzle-orm";
import {
  defaultAppTheme,
  defaultFaviconColor,
  defaultFontScalePercent,
  defaultTypographyProfile,
  type FaviconColorPreference,
  type FontScalePercent,
  type TypographyProfileId,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { appTheme } from "../schema.js";

const APP_THEME_ROW_ID = "current";

export interface StoredAppearance {
  themeId: string;
  faviconColor: FaviconColorPreference;
  typographyProfile: TypographyProfileId;
  fontScalePercent: FontScalePercent;
}

export function getStoredAppearance(db: DbConnection): StoredAppearance {
  const row = db.select().from(appTheme).where(eq(appTheme.id, APP_THEME_ROW_ID)).get();
  if (!row) {
    return {
      themeId: defaultAppTheme.themeId,
      faviconColor: defaultFaviconColor,
      typographyProfile: defaultTypographyProfile,
      fontScalePercent: defaultFontScalePercent,
    };
  }
  return {
    themeId: row.themeId,
    faviconColor: row.faviconColor,
    typographyProfile: row.typographyProfile,
    fontScalePercent: row.fontScalePercent,
  };
}

export function getStoredThemeId(db: DbConnection): string {
  return getStoredAppearance(db).themeId;
}

export function getStoredFaviconColor(db: DbConnection): FaviconColorPreference {
  return getStoredAppearance(db).faviconColor;
}

export function setStoredAppearance(
  db: DbConnection,
  appearance: StoredAppearance,
): void {
  const updatedAt = Date.now();
  const { themeId, faviconColor, typographyProfile, fontScalePercent } =
    appearance;
  db.insert(appTheme)
    .values({
      id: APP_THEME_ROW_ID,
      themeId,
      faviconColor,
      typographyProfile,
      fontScalePercent,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: appTheme.id,
      set: { themeId, faviconColor, typographyProfile, fontScalePercent, updatedAt },
    })
    .run();
}
