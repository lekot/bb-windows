import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { correctVoiceText, transcribeVoiceInput } from "@/lib/api";
import type { PromptBoxHandle, PromptVoiceConfig } from "./PromptBoxInternal";

const VOICE_CORRECTION_LENGTH_FACTOR = 3;
const VOICE_CORRECTION_LENGTH_PADDING = 200;

async function requestVoiceTranscription({
  file,
  promptContext,
  signal,
}: {
  file: File;
  promptContext?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const transcription = await transcribeVoiceInput(file, promptContext, signal);
  return transcription.text;
}

function createVoiceAbortError(): DOMException {
  return new DOMException("Voice transcription was cancelled", "AbortError");
}

function normalizeVoiceCorrection(rawText: string): string {
  return rawText.replace(/\s+/g, " ").trim();
}

function isPlausibleVoiceCorrection(
  transcript: string,
  correction: string,
): boolean {
  return (
    correction.length > 0 &&
    correction.length <=
      transcript.length * VOICE_CORRECTION_LENGTH_FACTOR +
        VOICE_CORRECTION_LENGTH_PADDING
  );
}

export function usePromptVoice(
  promptBoxRef: RefObject<PromptBoxHandle | null>,
): PromptVoiceConfig {
  const mountedRef = useRef(true);
  const voiceCorrectionEnabled =
    useSystemConfig().data?.voiceCorrectionEnabled === true;
  const pendingCorrectionsRef = useRef(new Set<AbortController>());
  const [pendingCorrectionCount, setPendingCorrectionCount] = useState(0);

  const syncPendingCount = useCallback(() => {
    if (mountedRef.current) {
      setPendingCorrectionCount(pendingCorrectionsRef.current.size);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const pendingCorrections = pendingCorrectionsRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of pendingCorrections) controller.abort();
      pendingCorrections.clear();
    };
  }, []);

  const onTranscript = useCallback(
    (text: string) => {
      const promptBox = promptBoxRef.current;
      if (!promptBox) return;
      const insertion = promptBox.insertTextAtCursor(text);
      if (!insertion) return;
      if (!voiceCorrectionEnabled) return;

      const controller = new AbortController();
      pendingCorrectionsRef.current.add(controller);
      syncPendingCount();

      void correctVoiceText(text, controller.signal)
        .then((response) => {
          if (controller.signal.aborted || !response.corrected) return;
          const correction = normalizeVoiceCorrection(response.text);
          if (!isPlausibleVoiceCorrection(text, correction)) return;
          if (promptBoxRef.current !== promptBox) return;
          promptBox.replaceInsertedText({
            snapshot: insertion,
            replacement: correction,
          });
        })
        .catch(() => {})
        .finally(() => {
          pendingCorrectionsRef.current.delete(controller);
          syncPendingCount();
        });
    },
    [promptBoxRef, syncPendingCount, voiceCorrectionEnabled],
  );

  const getPromptContext = useCallback(
    () => promptBoxRef.current?.getTextBeforeCursor(),
    [promptBoxRef],
  );

  const transcribeAfterCompletionTransition = useCallback(
    async (args: Parameters<typeof requestVoiceTranscription>[0]) => {
      const text = await requestVoiceTranscription(args);
      await promptBoxRef.current?.playVoiceCompletionTransition();
      if (args.signal?.aborted) {
        throw createVoiceAbortError();
      }
      return text;
    },
    [promptBoxRef],
  );

  const voiceInput = useVoiceInput({
    onTranscript,
    onTranscribe: transcribeAfterCompletionTransition,
    getPromptContext,
  });

  const cancelVoiceInput = voiceInput.cancel;
  const cancel = useCallback(() => {
    for (const controller of pendingCorrectionsRef.current) controller.abort();
    pendingCorrectionsRef.current.clear();
    syncPendingCount();
    cancelVoiceInput();
  }, [cancelVoiceInput, syncPendingCount]);

  return useMemo<PromptVoiceConfig>(
    () => ({
      state: voiceInput.state,
      isSupported: voiceInput.isSupported,
      unsupportedReason: voiceInput.unsupportedReason,
      isCorrecting: pendingCorrectionCount > 0,
      stream: voiceInput.stream,
      start: voiceInput.start,
      stop: voiceInput.stop,
      cancel,
    }),
    [
      voiceInput.state,
      voiceInput.isSupported,
      voiceInput.unsupportedReason,
      voiceInput.stream,
      voiceInput.start,
      voiceInput.stop,
      cancel,
      pendingCorrectionCount,
    ],
  );
}
