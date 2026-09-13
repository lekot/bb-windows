// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { correctVoiceText, transcribeVoiceInput } from "@/lib/api";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import type {
  PromptBoxHandle,
  PromptInsertionSnapshot,
} from "./PromptBoxInternal";
import { usePromptVoice } from "./usePromptVoice";

vi.mock("@/lib/api", () => ({
  correctVoiceText: vi.fn(),
  transcribeVoiceInput: vi.fn(),
}));

vi.mock("@/hooks/useVoiceInput", () => ({ useVoiceInput: vi.fn() }));

vi.mock("@/hooks/queries/system-queries", () => ({ useSystemConfig: vi.fn() }));

const voiceInput = {
  state: "idle" as const,
  isSupported: true,
  unsupportedReason: null,
  stream: null,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  isRecording: false,
  isProcessing: false,
  isListening: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createPromptBox() {
  let liveText = "";
  const applied: boolean[] = [];
  const handle: PromptBoxHandle = {
    captureHeightForLayoutChange: vi.fn(),
    focusEnd: vi.fn(),
    getTextBeforeCursor: () => liveText || undefined,
    playVoiceCompletionTransition: () => Promise.resolve(),
    insertTextAtCursor: (text): PromptInsertionSnapshot | null => {
      const normalized = text.replace(/\s+/g, " ").trim();
      if (!normalized) return null;
      const insertedFrom = liveText.length;
      const glue = liveText && !/\s$/u.test(liveText) ? " " : "";
      liveText = `${liveText}${glue}${normalized}`;
      return {
        liveText,
        liveMentions: [],
        insertedFrom,
        insertedTo: liveText.length,
        insertedText: liveText.slice(insertedFrom),
      };
    },
    replaceInsertedText: ({ snapshot, replacement }) => {
      const matches = liveText === snapshot.liveText;
      applied.push(matches);
      if (!matches) return false;
      const leading = /^\s+/u.exec(snapshot.insertedText)?.[0] ?? "";
      const trailing = /\s+$/u.exec(snapshot.insertedText)?.[0] ?? "";
      liveText = `${liveText.slice(0, snapshot.insertedFrom)}${leading}${replacement}${trailing}${liveText.slice(snapshot.insertedTo)}`;
      return true;
    },
  };
  return {
    applied,
    handle,
    read: () => liveText,
    write: (text: string) => {
      liveText = text;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("usePromptVoice", () => {
  beforeEach(() => {
    vi.mocked(useSystemConfig).mockReturnValue({
      data: { voiceCorrectionEnabled: true },
    } as ReturnType<typeof useSystemConfig>);
  });

  it("waits for the completion transition after transcription resolves", async () => {
    vi.mocked(useVoiceInput).mockReturnValue({
      ...voiceInput,
      state: "transcribing",
      isProcessing: true,
    });
    vi.mocked(transcribeVoiceInput).mockResolvedValue({ text: "Transcript" });
    let finishTransition: (() => void) | undefined;
    const promptBox = createPromptBox();
    promptBox.handle.playVoiceCompletionTransition = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishTransition = resolve;
        }),
    );

    renderHook(() => usePromptVoice({ current: promptBox.handle }));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];
    const transcription = options?.onTranscribe({
      file: new File([], "recording.webm", { type: "audio/webm" }),
    });
    await act(async () => Promise.resolve());
    expect(
      promptBox.handle.playVoiceCompletionTransition,
    ).toHaveBeenCalledOnce();
    finishTransition?.();
    await expect(transcription).resolves.toBe("Transcript");
  });

  it("inserts raw text before applying an asynchronous correction", async () => {
    vi.mocked(useVoiceInput).mockReturnValue(voiceInput);
    const correction = deferred<{ corrected: boolean; text: string }>();
    vi.mocked(correctVoiceText).mockReturnValue(correction.promise);
    const promptBox = createPromptBox();
    const { result } = renderHook(() =>
      usePromptVoice({ current: promptBox.handle }),
    );
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];

    act(() => options?.onTranscript("raw wrds"));
    expect(promptBox.read()).toBe("raw wrds");
    expect(result.current.isCorrecting).toBe(true);

    await act(async () => {
      correction.resolve({ corrected: true, text: "corrected words" });
    });
    expect(promptBox.read()).toBe("corrected words");
    expect(result.current.isCorrecting).toBe(false);
  });

  it("keeps raw text after a manual edit", async () => {
    vi.mocked(useVoiceInput).mockReturnValue(voiceInput);
    const correction = deferred<{ corrected: boolean; text: string }>();
    vi.mocked(correctVoiceText).mockReturnValue(correction.promise);
    const promptBox = createPromptBox();
    renderHook(() => usePromptVoice({ current: promptBox.handle }));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];

    act(() => options?.onTranscript("raw wrds"));
    promptBox.write("raw wrds edited");
    await act(async () => {
      correction.resolve({ corrected: true, text: "corrected words" });
    });
    expect(promptBox.read()).toBe("raw wrds edited");
    expect(promptBox.applied).toEqual([false]);
  });

  it("inserts raw text without requesting correction when it is disabled", () => {
    vi.mocked(useVoiceInput).mockReturnValue(voiceInput);
    vi.mocked(useSystemConfig).mockReturnValue({
      data: { voiceCorrectionEnabled: false },
    } as ReturnType<typeof useSystemConfig>);
    const promptBox = createPromptBox();
    renderHook(() => usePromptVoice({ current: promptBox.handle }));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];

    act(() => options?.onTranscript("raw wrds"));
    expect(promptBox.read()).toBe("raw wrds");
    expect(correctVoiceText).not.toHaveBeenCalled();
  });

  it("aborts correction on cancel and blocks the late response", async () => {
    vi.mocked(useVoiceInput).mockReturnValue(voiceInput);
    const correction = deferred<{ corrected: boolean; text: string }>();
    vi.mocked(correctVoiceText).mockReturnValue(correction.promise);
    const promptBox = createPromptBox();
    const { result } = renderHook(() =>
      usePromptVoice({ current: promptBox.handle }),
    );
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];

    act(() => options?.onTranscript("raw wrds"));
    act(() => result.current.cancel());
    expect(vi.mocked(correctVoiceText).mock.calls[0]?.[1]?.aborted).toBe(true);
    await act(async () => {
      correction.resolve({ corrected: true, text: "corrected words" });
    });
    expect(promptBox.read()).toBe("raw wrds");
    expect(promptBox.applied).toEqual([]);
  });

  it("aborts correction when the composer unmounts", () => {
    vi.mocked(useVoiceInput).mockReturnValue(voiceInput);
    vi.mocked(correctVoiceText).mockReturnValue(
      new Promise<{ corrected: boolean; text: string }>(() => {}),
    );
    const promptBox = createPromptBox();
    const { unmount } = renderHook(() =>
      usePromptVoice({ current: promptBox.handle }),
    );
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];

    act(() => options?.onTranscript("raw wrds"));
    const signal = vi.mocked(correctVoiceText).mock.calls[0]?.[1];
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(promptBox.read()).toBe("raw wrds");
  });

  it("preserves both dictations when corrections resolve out of order", async () => {
    vi.mocked(useVoiceInput).mockReturnValue(voiceInput);
    const first = deferred<{ corrected: boolean; text: string }>();
    const second = deferred<{ corrected: boolean; text: string }>();
    vi.mocked(correctVoiceText)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const promptBox = createPromptBox();
    renderHook(() => usePromptVoice({ current: promptBox.handle }));
    const options = vi.mocked(useVoiceInput).mock.calls[0]?.[0];

    act(() => options?.onTranscript("first raw"));
    act(() => options?.onTranscript("second raw"));
    await act(async () => {
      second.resolve({ corrected: true, text: "second corrected" });
    });
    await act(async () => {
      first.resolve({ corrected: true, text: "first corrected" });
    });
    expect(promptBox.read()).toBe("first raw second corrected");
    expect(promptBox.applied).toEqual([true, false]);
  });
});
