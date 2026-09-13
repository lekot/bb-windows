import { fetchWithAppSurface } from "@/lib/app-surface";
import { buildThreadHostFileContentUrl } from "@/lib/file-content-urls";

export async function isTaskJournalEmpty(
  threadId: string,
  path: string,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetchWithAppSurface(
    buildThreadHostFileContentUrl(threadId, path),
    { signal },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.body === null) return true;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return true;
      if (chunk.value.byteLength > 0) return false;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
