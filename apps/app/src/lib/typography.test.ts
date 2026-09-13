// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyCachedTypography,
  applyTypography,
  getAppliedTypography,
  getTypographyEpoch,
  subscribeTypographyChange,
  TYPOGRAPHY_DATA_ATTRIBUTE,
  TYPOGRAPHY_EXTERNAL_CHANGE_EVENT,
  TYPOGRAPHY_MIRROR_STORAGE_KEY,
  typographyFromExternalChange,
} from "./typography";

describe("typography application", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(TYPOGRAPHY_DATA_ATTRIBUTE);
    document.documentElement.style.removeProperty("--bb-font-scale");
    localStorage.clear();
  });

  it("applies a profile through the html attribute and the scale inline", () => {
    applyTypography({ profile: "readable", scalePercent: 105 });

    expect(
      document.documentElement.getAttribute(TYPOGRAPHY_DATA_ATTRIBUTE),
    ).toBe("readable");
    expect(
      document.documentElement.style.getPropertyValue("--bb-font-scale"),
    ).toBe("1.05");
    expect(getAppliedTypography()).toEqual({
      profile: "readable",
      scalePercent: 105,
    });
  });

  it("keeps the standard profile as the attribute-less default", () => {
    applyTypography({ profile: "standard", scalePercent: 100 });

    expect(
      document.documentElement.hasAttribute(TYPOGRAPHY_DATA_ATTRIBUTE),
    ).toBe(false);
    expect(getAppliedTypography()).toEqual({
      profile: "standard",
      scalePercent: 100,
    });
  });

  it("clamps out-of-range scale values at the boundary", () => {
    applyTypography({ profile: "standard", scalePercent: 250 });
    expect(
      document.documentElement.style.getPropertyValue("--bb-font-scale"),
    ).toBe("1.1");

    applyTypography({ profile: "standard", scalePercent: 10 });
    expect(
      document.documentElement.style.getPropertyValue("--bb-font-scale"),
    ).toBe("0.9");
  });

  it("mirrors the selection and notifies epoch subscribers", () => {
    const events: number[] = [];
    const unsubscribe = subscribeTypographyChange(() =>
      events.push(getTypographyEpoch()),
    );
    const before = getTypographyEpoch();

    applyTypography({ profile: "techno", scalePercent: 95 });

    expect(events).toHaveLength(1);
    expect(events[0]).toBe(before + 1);
    expect(JSON.parse(localStorage.getItem(TYPOGRAPHY_MIRROR_STORAGE_KEY)!)).toEqual(
      { profile: "techno", scalePercent: 95 },
    );
    unsubscribe();

    applyTypography({ profile: "standard", scalePercent: 100 });
    expect(events).toHaveLength(1);
  });

  it("restores a valid mirror and resets on a corrupt one", () => {
    localStorage.setItem(
      TYPOGRAPHY_MIRROR_STORAGE_KEY,
      JSON.stringify({ profile: "editorial", scalePercent: 110 }),
    );
    applyCachedTypography();
    expect(getAppliedTypography()).toEqual({
      profile: "editorial",
      scalePercent: 110,
    });

    localStorage.setItem(TYPOGRAPHY_MIRROR_STORAGE_KEY, "{not json");
    applyCachedTypography();
    expect(getAppliedTypography()).toEqual({
      profile: "standard",
      scalePercent: 100,
    });

    localStorage.setItem(
      TYPOGRAPHY_MIRROR_STORAGE_KEY,
      JSON.stringify({ profile: "fold", scalePercent: 100 }),
    );
    applyCachedTypography();
    expect(getAppliedTypography()).toEqual({
      profile: "standard",
      scalePercent: 100,
    });

    localStorage.setItem(
      TYPOGRAPHY_MIRROR_STORAGE_KEY,
      JSON.stringify({ profile: "compact", scalePercent: 999 }),
    );
    applyCachedTypography();
    expect(getAppliedTypography()).toEqual({
      profile: "compact",
      scalePercent: 110,
    });
  });

  it("accepts a valid external preview selection and rejects malformed events", () => {
    expect(
      typographyFromExternalChange(
        new CustomEvent(TYPOGRAPHY_EXTERNAL_CHANGE_EVENT, {
          detail: { profile: "editorial", scalePercent: 105 },
        }),
      ),
    ).toEqual({ profile: "editorial", scalePercent: 105 });
    expect(
      typographyFromExternalChange(
        new CustomEvent(TYPOGRAPHY_EXTERNAL_CHANGE_EVENT, {
          detail: { profile: "missing", scalePercent: 105 },
        }),
      ),
    ).toBeNull();
  });
});

describe("typography pre-paint script contract", () => {
  const html = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.html"),
    "utf8",
  );

  it("reads the same mirror key before the stylesheet applies", () => {
    expect(html).toContain(`localStorage.getItem("bb.typography")`);
    expect(html).toContain(`--bb-font-scale`);
    expect(html).toContain(`bbTypography`);
  });

  it("runs in the head, before the module bundle", () => {
    const headScriptAt = html.indexOf("bbTypography");
    const moduleScriptAt = html.indexOf("/src/main.tsx");
    expect(headScriptAt).toBeGreaterThan(-1);
    expect(moduleScriptAt).toBeGreaterThan(headScriptAt);
  });

  it("accepts exactly the shipped profile ids", () => {
    const idsMatch = html.match(
      /\["standard", "compact", "readable", "editorial", "techno"\]/,
    );
    expect(idsMatch).not.toBeNull();
    expect(html).toContain("Math.min(110, Math.max(90");
  });
});
