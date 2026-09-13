// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVoiceInput } from "./useVoiceInput";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn() },
}));

vi.mock("@/lib/audio-input-device-preference", () => ({
  buildAudioInputConstraints: () => ({ audio: true }),
  useAudioInputDevicePreferenceValue: () => null,
}));

vi.mock("@/lib/document-visibility", () => ({
  isDocumentVisible: () => true,
  subscribeToDocumentVisibility: () => () => undefined,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useVoiceInput mobile file capture", () => {
  it("transcribes captured audio when direct recording is unavailable", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
    let captureInput: HTMLInputElement | null = null;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
      function (this: HTMLInputElement) {
        captureInput = this;
      },
    );
    const onTranscript = vi.fn();
    const onTranscribe = vi.fn().mockResolvedValue("  mobile transcript  ");
    const { result } = renderHook(() =>
      useVoiceInput({
        getPromptContext: () => "existing prompt",
        onTranscript,
        onTranscribe,
      }),
    );

    await waitFor(() => expect(result.current.isSupported).toBe(true));
    await act(async () => result.current.start());

    expect(captureInput).not.toBeNull();
    const input = captureInput as unknown as HTMLInputElement;
    expect(input.accept).toBe("audio/*");
    expect(input.getAttribute("capture")).toBe("user");
    const file = new File(["audio"], "recording.m4a", { type: "audio/mp4" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => input.dispatchEvent(new Event("change")));

    await waitFor(() =>
      expect(onTranscript).toHaveBeenCalledWith("mobile transcript"),
    );
    expect(onTranscribe).toHaveBeenCalledWith({
      file,
      promptContext: "existing prompt",
      signal: expect.any(AbortSignal),
    });
    expect(document.body.contains(input)).toBe(false);
  });

  it("does not transcribe when the mobile capture sheet is cancelled", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
    let captureInput: HTMLInputElement | null = null;
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
      function (this: HTMLInputElement) {
        captureInput = this;
      },
    );
    const onTranscribe = vi.fn();
    const { result } = renderHook(() =>
      useVoiceInput({ onTranscript: vi.fn(), onTranscribe }),
    );

    await waitFor(() => expect(result.current.isSupported).toBe(true));
    await act(async () => result.current.start());
    const input = captureInput as unknown as HTMLInputElement;
    input.dispatchEvent(new Event("cancel"));

    expect(onTranscribe).not.toHaveBeenCalled();
    expect(document.body.contains(input)).toBe(false);
  });
});
