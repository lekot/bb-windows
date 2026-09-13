import { describe, expect, it } from "vitest";
import {
  resolveVoiceSupport,
  voiceUnsupportedMessage,
} from "./voice-input-support";

describe("resolveVoiceSupport", () => {
  it("is supported when the browser has both APIs", () => {
    expect(
      resolveVoiceSupport({
        hasFileCapture: true,
        hasMediaDevices: true,
        hasMediaRecorder: true,
        isSecureContext: true,
      }),
    ).toEqual({
      captureMode: "media-recorder",
      isSupported: true,
      reason: null,
    });
  });

  it("uses native audio file capture on a plain-HTTP LAN server", () => {
    expect(
      resolveVoiceSupport({
        hasFileCapture: true,
        hasMediaDevices: false,
        hasMediaRecorder: true,
        isSecureContext: false,
      }),
    ).toEqual({
      captureMode: "file-capture",
      isSupported: true,
      reason: null,
    });
  });

  it("blames the browser on a secure origin", () => {
    expect(
      resolveVoiceSupport({
        hasFileCapture: false,
        hasMediaDevices: true,
        hasMediaRecorder: false,
        isSecureContext: true,
      }),
    ).toEqual({
      captureMode: null,
      isSupported: false,
      reason: "unsupported-browser",
    });
  });

  it("blames the origin when neither capture path is available", () => {
    expect(
      resolveVoiceSupport({
        hasFileCapture: false,
        hasMediaDevices: false,
        hasMediaRecorder: true,
        isSecureContext: false,
      }),
    ).toEqual({
      captureMode: null,
      isSupported: false,
      reason: "insecure-origin",
    });
  });
});

describe("voiceUnsupportedMessage", () => {
  it("names the fix for each reason", () => {
    expect(voiceUnsupportedMessage("insecure-origin")).toBe(
      "Voice input needs an HTTPS connection to this server",
    );
    expect(voiceUnsupportedMessage("unsupported-browser")).toBe(
      "Voice input is not supported in this browser",
    );
    expect(voiceUnsupportedMessage(null)).toBe(
      "Voice input is not supported in this browser",
    );
  });
});
