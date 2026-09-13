interface ResolveAbsoluteFilePathArgs {
  path: string;
  rootPath: string | null | undefined;
}

interface BuildAbsoluteFilePathArgs {
  path: string;
  rootPath: string;
}

interface GetAbsoluteDirnameArgs {
  path: string;
}

interface IsAbsoluteFilePathWithinRootArgs {
  candidatePath: string;
  rootPath: string;
}

interface NormalizeAbsoluteFilePathArgs {
  path: string;
}

function trimTrailingSlash(path: string): string {
  if (path === "/" || /^[A-Za-z]:\/$/u.test(path)) {
    return path;
  }
  return path.replace(/\/+$/u, "");
}

function trimLeadingSlash(path: string): string {
  return path.replace(/^\/+/u, "");
}

function isAbsoluteFilePath(path: string): boolean {
  return (
    (path.startsWith("/") && !path.startsWith("//")) ||
    /^[A-Za-z]:[\\/]/u.test(path)
  );
}

function normalizePathSegments(path: string): string[] {
  const normalizedSegments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalizedSegments.length > 0) {
        normalizedSegments.pop();
      }
      continue;
    }
    normalizedSegments.push(segment);
  }
  return normalizedSegments;
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//u.test(path);
}

export function normalizeAbsoluteFilePath({
  path,
}: NormalizeAbsoluteFilePathArgs): string | null {
  if (!isAbsoluteFilePath(path)) {
    return null;
  }

  const windowsDriveMatch = /^([A-Za-z]):[\\/](.*)$/u.exec(path);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1].toUpperCase();
    const normalizedSegments = normalizePathSegments(
      windowsDriveMatch[2].replace(/\\/gu, "/"),
    );
    return normalizedSegments.length === 0
      ? `${drive}:/`
      : `${drive}:/${normalizedSegments.join("/")}`;
  }

  const normalizedSegments = normalizePathSegments(path);
  return normalizedSegments.length === 0
    ? "/"
    : `/${normalizedSegments.join("/")}`;
}

export function isAbsoluteFilePathWithinRoot({
  candidatePath,
  rootPath,
}: IsAbsoluteFilePathWithinRootArgs): boolean {
  const normalizedCandidatePath = normalizeAbsoluteFilePath({
    path: candidatePath,
  });
  const normalizedRootPath = normalizeAbsoluteFilePath({ path: rootPath });
  if (normalizedCandidatePath === null || normalizedRootPath === null) {
    return false;
  }

  if (normalizedRootPath === "/") {
    return normalizedCandidatePath.startsWith("/");
  }

  if (isWindowsDrivePath(normalizedRootPath)) {
    const normalizedCandidatePathFolded = normalizedCandidatePath.toLowerCase();
    const normalizedRootPathFolded = normalizedRootPath.toLowerCase();
    return (
      normalizedCandidatePathFolded === normalizedRootPathFolded ||
      normalizedCandidatePathFolded.startsWith(
        normalizedRootPath.endsWith("/")
          ? normalizedRootPathFolded
          : `${normalizedRootPathFolded}/`,
      )
    );
  }

  return (
    normalizedCandidatePath === normalizedRootPath ||
    normalizedCandidatePath.startsWith(`${normalizedRootPath}/`)
  );
}

export function buildAbsoluteFilePath({
  path,
  rootPath,
}: BuildAbsoluteFilePathArgs): string {
  if (isAbsoluteFilePath(path)) {
    return path;
  }

  const normalizedRootPath =
    normalizeAbsoluteFilePath({ path: rootPath }) ?? trimTrailingSlash(rootPath);
  const relativePath = isWindowsDrivePath(normalizedRootPath)
    ? trimLeadingSlash(path).replace(/\\/gu, "/")
    : trimLeadingSlash(path);
  if (normalizedRootPath === "/") {
    return `/${relativePath}`;
  }
  return normalizedRootPath.endsWith("/")
    ? `${normalizedRootPath}${relativePath}`
    : `${normalizedRootPath}/${relativePath}`;
}

export function resolveAbsoluteFilePath({
  path,
  rootPath,
}: ResolveAbsoluteFilePathArgs): string | null {
  if (isAbsoluteFilePath(path)) {
    return normalizeAbsoluteFilePath({ path });
  }
  if (!rootPath) {
    return null;
  }
  return buildAbsoluteFilePath({ path, rootPath });
}

export function getAbsoluteDirname({ path }: GetAbsoluteDirnameArgs): string {
  const normalizedPath = normalizeAbsoluteFilePath({ path }) ?? path;
  const trimmed = trimTrailingSlash(normalizedPath);
  if (/^[A-Za-z]:$/u.test(trimmed)) {
    return `${trimmed}/`;
  }
  const lastSlashIndex = trimmed.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    return "/";
  }
  if (lastSlashIndex === 2 && /^[A-Za-z]:/u.test(trimmed)) {
    return trimmed.slice(0, 3);
  }
  return trimmed.slice(0, lastSlashIndex);
}
