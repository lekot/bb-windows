import { describe, expect, it } from "vitest";
import type { WorkspaceDiffTarget } from "@bb/domain";
import { makeDiffFileEntry } from "@/test/fixtures/diff-files";
import {
  resolveDeletedGitDiffFilePreviewSource,
  resolveGitDiffFilePreviewRequest,
} from "./git-diff-file-preview";

function resolveSource(
  target: WorkspaceDiffTarget,
  mergeBaseRef: string | null,
) {
  return resolveDeletedGitDiffFilePreviewSource(target, mergeBaseRef);
}

describe("git diff file preview", () => {
  it("uses the old Git side for deleted files across diff targets", () => {
    expect(resolveSource({ type: "uncommitted" }, null)).toEqual({
      kind: "head",
    });
    expect(
      resolveSource(
        { type: "all", mergeBaseBranch: "main" },
        "origin/main",
      ),
    ).toEqual({ kind: "merge-base", ref: "origin/main" });
    expect(resolveSource({ type: "commit", sha: "a1b2c3d4" }, null)).toEqual({
      kind: "merge-base",
      ref: "a1b2c3d4^",
    });
  });

  it("keeps a deleted path out of the working-tree preview", () => {
    expect(
      resolveGitDiffFilePreviewRequest({
        entry: makeDiffFileEntry({
          changeKind: "deleted",
          path: "outputs/mk015_mk016_test_documents.json",
        }),
        deletedFileSource: { kind: "head" },
      }),
    ).toEqual({
      path: "outputs/mk015_mk016_test_documents.json",
      source: { kind: "head" },
      statusLabel: "deleted",
    });
  });
});
