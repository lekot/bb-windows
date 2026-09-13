import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerTypographyCommands } from "../../commands/typography.js";

describe("bb typography commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerTypographyCommands(program, () => "http://server");

  function stubAppearance(
    typographyProfile = "compact",
    fontScalePercent = 95,
  ) {
    const put = vi.fn(async ({ json }) => ({
      themeId: "nord",
      faviconColor: "purple",
      ...json,
      customCss: null,
      resolvedCodeTheme: {
        dark: "pierre-dark",
        light: "pierre-light",
        files: {},
      },
    }));
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        appearance: {
          themeId: "nord",
          faviconColor: "purple",
          typographyProfile,
          fontScalePercent,
          customCss: null,
          resolvedCodeTheme: {
            dark: "pierre-dark",
            light: "pierre-light",
            files: {},
          },
        },
      })),
      "v1.settings.appearance.$put": put,
    });
    return put;
  }

  it("lists profiles and marks the active one", async () => {
    stubAppearance("readable", 105);

    await runCommand(["typography", "list"], register);

    const lines = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(lines).toContain("* readable");
    expect(lines).not.toContain("* standard");
    expect(lines).toContain("Active: Readable (readable) at 105%");
  });

  it("sets a profile while preserving palette, favicon, and scale", async () => {
    const put = stubAppearance("compact", 95);

    await runCommand(["typography", "set", "techno"], register);

    expect(put).toHaveBeenCalledWith({
      json: {
        themeId: "nord",
        faviconColor: "purple",
        typographyProfile: "techno",
        fontScalePercent: 95,
      },
    });
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "Typography set to Techno (techno) at 95%",
    );
  });

  it("sets the scale while preserving the profile, snapped to the step grid", async () => {
    const put = stubAppearance("editorial", 100);

    await runCommand(["typography", "scale", "103"], register);

    expect(put).toHaveBeenCalledWith({
      json: {
        themeId: "nord",
        faviconColor: "purple",
        typographyProfile: "editorial",
        fontScalePercent: 105,
      },
    });
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "Text scale set to 105%",
    );
  });

  it("resets to the standard profile at 100%", async () => {
    const put = stubAppearance("techno", 110);

    await runCommand(["typography", "reset"], register);

    expect(put).toHaveBeenCalledWith({
      json: {
        themeId: "nord",
        faviconColor: "purple",
        typographyProfile: "standard",
        fontScalePercent: 100,
      },
    });
  });

  it("prints machine-readable JSON for list and set", async () => {
    stubAppearance("standard", 100);

    await runCommand(["typography", "list", "--json"], register);
    const listPayload = collectLogPayloads(vi.mocked(console.log))[0];
    const parsed = JSON.parse(listPayload);
    expect(parsed.active).toEqual({
      typographyProfile: "standard",
      fontScalePercent: 100,
    });
    expect(parsed.profiles.map((profile: { id: string }) => profile.id)).toEqual(
      ["standard", "compact", "readable", "editorial", "techno"],
    );
  });

  it("rejects invalid profiles and out-of-range scales before writing", async () => {
    const put = stubAppearance();

    await expect(
      runCommand(["typography", "set", "fold"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(["typography", "scale", "130"], register),
    ).rejects.toThrow("process.exit:1");

    expect(put).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Invalid typography profile 'fold'",
    );
  });

  it("documents the typography command surface in help", async () => {
    const help = await getHelpOutput(["typography"], register);

    expect(help).toContain("list");
    expect(help).toContain("set [options] <profile>");
    expect(help).toContain("scale [options] <percent>");
    expect(help).toContain("reset");
  });
});
