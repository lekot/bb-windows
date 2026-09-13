import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  buildTree,
  filterTree,
  includeActiveFile,
  normalizeRelativePath,
} from "./file-tree.js";

describe("normalizeRelativePath", () => {
  it("normalizes Windows separators and dot prefixes", () => {
    expect(normalizeRelativePath(".\\src\\ui\\button.ts\\")).toBe(
      "src/ui/button.ts",
    );
  });
});

describe("includeActiveFile", () => {
  it("adds only the already-open file when the listing is truncated", () => {
    const entries = [{ path: "readme.md", kind: "file" as const }];

    expect(
      includeActiveFile(entries, "src\\.v8-testedapp.json", true),
    ).toEqual([
      ...entries,
      { path: "src/.v8-testedapp.json", kind: "file" },
    ]);
  });

  it("does not add an entry for a complete listing or a listed file", () => {
    const entries = [{ path: "src/file.ts", kind: "file" as const }];

    expect(includeActiveFile(entries, "src\\file.ts", false)).toBe(entries);
    expect(includeActiveFile(entries, "src\\file.ts", true)).toBe(entries);
  });
});

describe("buildTree", () => {
  it("nests flat paths and sorts directories before files", () => {
    const tree = buildTree([
      { path: "readme.md", kind: "file" },
      { path: "src", kind: "directory" },
      { path: "src/index.ts", kind: "file" },
      { path: "src/lib", kind: "directory" },
      { path: "src/lib/util.ts", kind: "file" },
    ]);

    expect(tree.map((node) => node.name)).toEqual(["src", "readme.md"]);
    const src = tree[0]!;
    expect(src.children.map((node) => node.name)).toEqual(["lib", "index.ts"]);
    expect(src.children[0]!.children[0]!.path).toBe("src/lib/util.ts");
  });

  it("synthesises directories that the listing omitted", () => {
    const tree = buildTree([{ path: "a/b/c.ts", kind: "file" }]);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.kind).toBe("directory");
    expect(tree[0]!.children[0]!.path).toBe("a/b");
    expect(tree[0]!.children[0]!.children[0]!.path).toBe("a/b/c.ts");
  });

  it("sorts case-insensitively", () => {
    const tree = buildTree([
      { path: "beta.ts", kind: "file" },
      { path: "Alpha.ts", kind: "file" },
    ]);

    expect(tree.map((node) => node.name)).toEqual(["Alpha.ts", "beta.ts"]);
  });
});

describe("ancestorsOf", () => {
  it("lists each containing directory, nearest last", () => {
    expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"]);
  });

  it("has none for a root-level file", () => {
    expect(ancestorsOf("readme.md")).toEqual([]);
  });
});

describe("filterTree", () => {
  const tree = buildTree([
    { path: "src/index.ts", kind: "file" },
    { path: "src/ui/button.tsx", kind: "file" },
    { path: "docs/guide.md", kind: "file" },
  ]);

  it("keeps matches with the directories leading to them, and says which to open", () => {
    const filtered = filterTree(tree, "button");

    expect(filtered.nodes.map((node) => node.name)).toEqual(["src"]);
    expect([...filtered.expand].sort()).toEqual(["src", "src/ui"]);
  });

  it("matches on the whole relative path, not just the file name", () => {
    const filtered = filterTree(tree, "src/ui");

    expect(filtered.nodes.map((node) => node.name)).toEqual(["src"]);
    expect(filtered.nodes[0]!.children.map((node) => node.path)).toEqual([
      "src/ui",
    ]);
  });

  it("is case-insensitive and returns nothing when nothing matches", () => {
    expect(filterTree(tree, "BUTTON").nodes.map((node) => node.name)).toEqual([
      "src",
    ]);
    expect(filterTree(tree, "nothing-here").nodes).toEqual([]);
  });

  it("passes the tree through untouched when the query is blank", () => {
    const filtered = filterTree(tree, "   ");

    expect(filtered.nodes).toHaveLength(2);
    expect(filtered.expand.size).toBe(0);
  });
});
