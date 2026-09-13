import { useQuery } from "@tanstack/react-query";
import type { ThreadNativeQuotaResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";

const NATIVE_QUOTA_POLL_INTERVAL_MS = 5 * 60_000;

export const nativeQuotaQueryKey = (threadId: string) =>
  ["thread-native-quota", threadId] as const;

export function useNativeQuota(threadId: string, enabled: boolean) {
  return useQuery<ThreadNativeQuotaResponse>({
    queryKey: nativeQuotaQueryKey(threadId),
    queryFn: ({ signal }) =>
      sdk.threads.nativeQuota({ signal, threadId }),
    enabled,
    staleTime: NATIVE_QUOTA_POLL_INTERVAL_MS,
    refetchInterval: (query) =>
      query.state.data?.supported === false
        ? false
        : NATIVE_QUOTA_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    retry: false,
    gcTime: 60_000,
  });
}
