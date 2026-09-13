import type { WorkspaceDiffTarget } from "@bb/domain";
import type { DiffFileEntry } from "@bb/server-contract";
import type {
  EnvironmentFilePreviewSource,
  WorkspaceFilePreviewStatusLabel,
} from "@bb/client-core";

export interface GitDiffFilePreviewRequest {
  path: string;
  source: EnvironmentFilePreviewSource;
  statusLabel: WorkspaceFilePreviewStatusLabel | null;
}

export type GitDiffFilePreviewHandler = (
  request: GitDiffFilePreviewRequest,
) => void;

export function resolveDeletedGitDiffFilePreviewSource(
  target: WorkspaceDiffTarget,
  mergeBaseRef: string | null,
): EnvironmentFilePreviewSource | null {
  switch (target.type) {
    case "uncommitted":
      return { kind: "head" };
    case "branch_committed":
    case "all":
      return mergeBaseRef ? { kind: "merge-base", ref: mergeBaseRef } : null;
    case "commit":
      return { kind: "merge-base", ref: `${target.sha}^` };
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

export function resolveGitDiffFilePreviewRequest({
  entry,
  deletedFileSource,
}: {
  entry: DiffFileEntry;
  deletedFileSource: EnvironmentFilePreviewSource | null;
}): GitDiffFilePreviewRequest | null {
  if (entry.changeKind === "deleted") {
    if (deletedFileSource === null) {
      return null;
    }
    return {
      path: entry.previousPath ?? entry.path,
      source: deletedFileSource,
      statusLabel: "deleted",
    };
  }

  return {
    path: entry.path,
    source: { kind: "working-tree" },
    statusLabel: null,
  };
}
