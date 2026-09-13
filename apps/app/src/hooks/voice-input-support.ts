export type VoiceUnsupportedReason = "insecure-origin" | "unsupported-browser";

export interface VoiceSupportEnvironment {
  hasFileCapture: boolean;
  hasMediaDevices: boolean;
  hasMediaRecorder: boolean;
  isSecureContext: boolean;
}

export type VoiceCaptureMode = "file-capture" | "media-recorder";

export interface VoiceSupport {
  captureMode: VoiceCaptureMode | null;
  isSupported: boolean;
  reason: VoiceUnsupportedReason | null;
}

export function resolveVoiceSupport(
  environment: VoiceSupportEnvironment,
): VoiceSupport {
  if (environment.hasMediaDevices && environment.hasMediaRecorder) {
    return { captureMode: "media-recorder", isSupported: true, reason: null };
  }
  if (environment.hasFileCapture) {
    return { captureMode: "file-capture", isSupported: true, reason: null };
  }
  return {
    captureMode: null,
    isSupported: false,
    reason: environment.isSecureContext
      ? "unsupported-browser"
      : "insecure-origin",
  };
}

export function voiceUnsupportedMessage(
  reason: VoiceUnsupportedReason | null,
): string {
  return reason === "insecure-origin"
    ? "Voice input needs an HTTPS connection to this server"
    : "Voice input is not supported in this browser";
}

export function readVoiceSupportEnvironment(): VoiceSupportEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      hasFileCapture: false,
      hasMediaDevices: false,
      hasMediaRecorder: false,
      isSecureContext: true,
    };
  }
  return {
    hasFileCapture: typeof document.createElement === "function",
    hasMediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
    hasMediaRecorder: typeof window.MediaRecorder !== "undefined",
    isSecureContext: window.isSecureContext !== false,
  };
}
