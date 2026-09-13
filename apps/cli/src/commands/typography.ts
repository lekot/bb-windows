import { Command } from "commander";
import {
  defaultFontScalePercent,
  defaultTypographyProfile,
  fontScalePercentSchema,
  snapFontScalePercent,
  TYPOGRAPHY_PROFILE_IDS,
  typographyProfileSchema,
  typographyProfiles,
  type AppTheme,
  type TypographyProfileId,
} from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

function parseProfile(value: string): TypographyProfileId {
  const parsed = typographyProfileSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid typography profile '${value}'. Expected one of: ${TYPOGRAPHY_PROFILE_IDS.join(", ")}.`,
    );
  }
  return parsed.data;
}

function parseScale(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid text scale '${value}'. Expected 90-110.`);
  }
  const checked = fontScalePercentSchema.safeParse(parsed);
  if (!checked.success) {
    throw new Error(
      `Invalid text scale '${value}'. Expected an integer between 90 and 110.`,
    );
  }
  return snapFontScalePercent(parsed);
}

function describeTypography(theme: AppTheme): string {
  const meta = typographyProfiles.find(
    (profile) => profile.id === theme.typographyProfile,
  );
  const name = meta ? `${meta.name} (${meta.id})` : theme.typographyProfile;
  return `${name} at ${theme.fontScalePercent}%`;
}

export function registerTypographyCommands(
  program: Command,
  getUrl: () => string,
): void {
  const typography = program
    .command("typography")
    .description("Manage the app typography profile and text scale");

  typography
    .command("list")
    .description("List typography profiles and the active selection")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const active = await sdk.theme.get();
        if (
          outputJson(opts, {
            active: {
              typographyProfile: active.typographyProfile,
              fontScalePercent: active.fontScalePercent,
            },
            profiles: typographyProfiles,
          })
        ) {
          return;
        }
        console.log("");
        for (const profile of typographyProfiles) {
          const marker =
            active.typographyProfile === profile.id ? "*" : " ";
          console.log(`${marker} ${profile.id.padEnd(12)} ${profile.hint}`);
        }
        console.log("");
        console.log(`Active: ${describeTypography(active)}`);
      }),
    );

  typography
    .command("set <profile>")
    .description(
      `Switch the typography profile (${TYPOGRAPHY_PROFILE_IDS.join(", ")})`,
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (value: string, opts: JsonOutputOptions) => {
        const profile = parseProfile(value);
        const sdk = createCliBbSdk(getUrl());
        const active = await sdk.theme.get();
        const updated = await sdk.theme.set({
          themeId: active.themeId,
          faviconColor: active.faviconColor,
          typographyProfile: profile,
          fontScalePercent: active.fontScalePercent,
        });
        if (outputJson(opts, updated)) return;
        console.log(`Typography set to ${describeTypography(updated)}`);
      }),
    );

  typography
    .command("scale <percent>")
    .description("Set the text scale (90-110, snapped to 5% steps)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (value: string, opts: JsonOutputOptions) => {
        const scale = parseScale(value);
        const sdk = createCliBbSdk(getUrl());
        const active = await sdk.theme.get();
        const updated = await sdk.theme.set({
          themeId: active.themeId,
          faviconColor: active.faviconColor,
          typographyProfile: active.typographyProfile,
          fontScalePercent: scale,
        });
        if (outputJson(opts, updated)) return;
        console.log(`Text scale set to ${updated.fontScalePercent}%`);
      }),
    );

  typography
    .command("reset")
    .description("Reset to the Standard profile at 100% text scale")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const active = await sdk.theme.get();
        const updated = await sdk.theme.set({
          themeId: active.themeId,
          faviconColor: active.faviconColor,
          typographyProfile: defaultTypographyProfile,
          fontScalePercent: defaultFontScalePercent,
        });
        if (outputJson(opts, updated)) return;
        console.log(`Typography reset to ${describeTypography(updated)}`);
      }),
    );
}
