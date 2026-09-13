import { describe, expect, it } from "vitest";
import {
  buildAbsoluteFilePath,
  getAbsoluteDirname,
  isAbsoluteFilePathWithinRoot,
  normalizeAbsoluteFilePath,
} from "./absolute-file-path";

describe("getAbsoluteDirname", () => {
  it.each([
    ["/storage/thr_1/current/summary.md", "/storage/thr_1/current"],
    ["/README.md", "/"],
    ["/storage/thr_1/", "/storage"],
    ["C:\\Users\\example\\result.output", "C:/Users/example"],
    ["C:/result.output", "C:/"],
  ])("resolves the parent of %s", (path, expected) => {
    expect(getAbsoluteDirname({ path })).toBe(expected);
  });
});

describe("normalizeAbsoluteFilePath", () => {
  it("normalizes dot segments in absolute file paths", () => {
    expect(
      normalizeAbsoluteFilePath({
        path: "/Users/me/project/docs/../README.md",
      }),
    ).toBe("/Users/me/project/README.md");
  });

  it("rejects relative file paths", () => {
    expect(normalizeAbsoluteFilePath({ path: "docs/README.md" })).toBeNull();
  });

  it("normalizes Windows drive paths without accepting UNC paths", () => {
    expect(
      normalizeAbsoluteFilePath({
        path: "c:\\Users\\example\\AppData\\Local\\Temp\\claude\\run\\tasks\\..\\result.output",
      }),
    ).toBe("C:/Users/example/AppData/Local/Temp/claude/run/result.output");
    expect(
      normalizeAbsoluteFilePath({ path: "\\\\server\\share\\result.output" }),
    ).toBeNull();
    expect(
      normalizeAbsoluteFilePath({ path: "//server/share/result.output" }),
    ).toBeNull();
  });
});

describe("isAbsoluteFilePathWithinRoot", () => {
  it("accepts normalized paths inside the root", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "/Users/me/project/docs/../README.md",
        rootPath: "/Users/me/project/",
      }),
    ).toBe(true);
  });

  it("rejects normalized paths outside the root", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "/Users/me/project/../../.ssh/id_rsa",
        rootPath: "/Users/me/project",
      }),
    ).toBe(false);
  });

  it("does not confuse sibling roots with matching prefixes", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "/Users/me/project-copy/README.md",
        rootPath: "/Users/me/project",
      }),
    ).toBe(false);
  });

  it("uses case-insensitive Windows drive containment", () => {
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "c:\\WS\\accounting_suite\\src\\..\\README.md",
        rootPath: "C:/ws/ACCOUNTING_SUITE",
      }),
    ).toBe(true);
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\WS\\accounting_suite-copy\\README.md",
        rootPath: "C:\\WS\\accounting_suite",
      }),
    ).toBe(false);
    expect(
      isAbsoluteFilePathWithinRoot({
        candidatePath: "C:\\Temp\\result.output",
        rootPath: "C:\\",
      }),
    ).toBe(true);
  });
});

describe("buildAbsoluteFilePath", () => {
  it("does not introduce an extra separator below a Windows drive root", () => {
    expect(
      buildAbsoluteFilePath({ path: "Temp\\result.output", rootPath: "C:\\" }),
    ).toBe("C:/Temp/result.output");
  });
});
