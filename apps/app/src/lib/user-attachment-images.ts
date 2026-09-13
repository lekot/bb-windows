import { buildProjectAttachmentContentUrl, buildThreadHostFileContentUrl } from "./file-content-urls";

export function toUserAttachmentImageSrc(
  pathOrUrl: string,
  projectId?: string,
  threadId?: string,
): string {
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (threadId && (/^[a-zA-Z]:[\\/]/u.test(pathOrUrl) || pathOrUrl.startsWith('/') || pathOrUrl.startsWith('\\\\'))) {
    return buildThreadHostFileContentUrl(threadId, pathOrUrl);
  }
  if (projectId) {
    return buildProjectAttachmentContentUrl(projectId, pathOrUrl);
  }

  if (/^file:/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const normalized = pathOrUrl.replaceAll("\\", "/");
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }
  return pathOrUrl;
}
