import { useQuery } from "@tanstack/react-query";
import type { PermissionMode } from "@bb/domain";
import { permissionModeValues } from "@bb/domain";
import { nativeHistoryQueryOptions } from "./native-history-query";

const NATIVE_PERMISSION_MODES = new Map<string, PermissionMode>([
  ["acceptEdits", "accept-edits"],
  ["auto", "auto"],
  ["bypassPermissions", "full"],
]);

const BB_PERMISSION_MODES = new Set<PermissionMode>(permissionModeValues);

export type NativePermissionObservation =
  | {
      kind: "mismatch";
      currentMode: PermissionMode;
      nativeMode: PermissionMode;
      observedMode: string;
    }
  | {
      kind: "unknown";
      currentMode: PermissionMode;
      observedMode: string;
    };

export function resolveNativePermissionMismatch(args: {
  currentMode: PermissionMode;
  observedMode: string | null | undefined;
  resumesNativeSession?: boolean;
  supported?: boolean;
}): NativePermissionObservation | null {
  if (args.resumesNativeSession === false) return null;
  if (args.supported === false) return null;
  const observedMode = args.observedMode?.trim() ?? "";
  if (observedMode.length === 0) return null;

  const nativeMode = NATIVE_PERMISSION_MODES.get(observedMode);
  const hostMappedMode = BB_PERMISSION_MODES.has(observedMode as PermissionMode)
    ? (observedMode as PermissionMode)
    : null;
  const resolvedMode = nativeMode ?? hostMappedMode;
  if (resolvedMode === null) {
    return {
      kind: "unknown",
      currentMode: args.currentMode,
      observedMode,
    };
  }
  if (resolvedMode === args.currentMode) return null;
  return {
    kind: "mismatch",
    currentMode: args.currentMode,
    nativeMode: resolvedMode,
    observedMode,
  };
}

export function useNativePermissionMismatch(
  threadId: string,
  enabled: boolean,
  currentMode: PermissionMode,
): NativePermissionObservation | null {
  const query = useQuery({ ...nativeHistoryQueryOptions(threadId), enabled });
  if (!enabled) return null;
  return resolveNativePermissionMismatch({
    currentMode,
    observedMode: query.data?.metadata.permissionMode,
    resumesNativeSession: query.data?.metadata.sessionOrigin === "native",
    supported: query.data?.supported,
  });
}
