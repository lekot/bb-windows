import path from "node:path";

export function isBbManagedWorkspacePath(args: {
  dataDir: string;
  path: string;
}): boolean {
  const normalize = (value: string) => value.replaceAll("\\", "/");
  return [
    path.join(args.dataDir, "worktrees"),
    path.join(args.dataDir, "personal-workspaces"),
  ].some((root) => {
    const normalizedPath = normalize(args.path);
    const normalizedRoot = normalize(root);
    return (
      normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(`${normalizedRoot}/`)
    );
  });
}
