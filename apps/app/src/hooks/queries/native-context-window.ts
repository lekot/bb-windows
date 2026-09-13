import { useQuery } from "@tanstack/react-query";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import { nativeHistoryQueryOptions } from "./native-history-query";

interface NativeContextSample {
  usedTokens: number;
  observedAt: string | null;
  model: string | null;
  contextWindow?: number | null;
}

function contextModelKey(model: string): string {
  const normalized = model.replace(/\[1m\]$/, "");
  if (
    /^(?:(?:builtin:)?zai(?:-coding-plan)?\/)?glm-5\.3(?:-flash)?$/i.test(
      normalized,
    )
  ) {
    return normalized
      .replace(/^(?:builtin:)?zai(?:-coding-plan)?\//i, "")
      .toLowerCase();
  }
  return normalized;
}

function knownContextWindow(model: string | null): number | null {
  if (model === null) return null;
  return /^glm-5\.3(?:-flash)?$/i.test(contextModelKey(model))
    ? 1_000_000
    : null;
}

export function resolveNativeContextWindow(args: {
  enabled: boolean;
  providerName: string | null;
  sample: NativeContextSample | null;
  bbUsage: ThreadContextWindowUsage | null;
  selectedModel: string | null;
  failed?: boolean;
  running?: boolean;
}): {
  usage: ThreadContextWindowUsage | null;
  note: string | null;
  sourceLabel: string | null;
  tokenLabel?: string;
} {
  if (!args.enabled)
    return { usage: args.bbUsage, note: null, sourceLabel: null };
  const selectedKnownWindow = knownContextWindow(args.selectedModel);
  const effectiveBbUsage =
    args.bbUsage && selectedKnownWindow
      ? { ...args.bbUsage, modelContextWindow: selectedKnownWindow }
      : args.bbUsage;
  const currentTokens = args.running
    ? effectiveBbUsage?.usedTokens
    : args.sample?.usedTokens;
  const nativeWindow = args.sample?.contextWindow;
  if (
    effectiveBbUsage !== null &&
    currentTokens !== undefined &&
    currentTokens > effectiveBbUsage.modelContextWindow &&
    (args.running || nativeWindow === null || nativeWindow === undefined)
  ) {
    const sampleTime = formatObservedTime(args.sample?.observedAt);
    return {
      usage: null,
      tokenLabel: `Контекст: ${currentTokens.toLocaleString()} ток.`,
      sourceLabel: args.running ? "bb" : sampleTime,
      note: `Замер контекста ${currentTokens.toLocaleString()} токенов противоречит размеру окна ${effectiveBbUsage.modelContextWindow.toLocaleString()}. Размер окна не подтверждён; процент не рассчитан.`,
    };
  }
  if (args.running)
    return {
      usage: effectiveBbUsage,
      sourceLabel: "bb",
      note: "Агент работает. Показана последняя оценка bb; замер исходной сессии обновится после ответа.",
    };
  const sample = args.sample;
  const providerLabel = args.providerName ?? "исходного клиента";
  if (!sample)
    return {
      usage: null,
      sourceLabel: null,
      note: args.failed
        ? "Не удалось обновить замер контекста исходной сессии."
        : "Замер контекста исходной сессии пока недоступен.",
    };
  const timestamp = sample.observedAt ? new Date(sample.observedAt) : null;
  const observed =
    timestamp && Number.isFinite(timestamp.getTime())
      ? timestamp.toLocaleString()
      : "время неизвестно";
  const sameModel =
    sample.model !== null &&
    args.selectedModel !== null &&
    contextModelKey(sample.model) === contextModelKey(args.selectedModel);
  const confirmedWindow =
    typeof sample.contextWindow === "number" && sample.contextWindow > 0
      ? sample.contextWindow
      : null;
  const knownWindow = sameModel ? knownContextWindow(sample.model) : null;
  const size =
    confirmedWindow ??
    knownWindow ??
    (sameModel ? effectiveBbUsage?.modelContextWindow : null);
  const usage =
    size && size > 0
      ? {
          usedTokens: sample.usedTokens,
          modelContextWindow: size,
          estimated: true,
        }
      : null;
  return {
    usage,
    sourceLabel: formatObservedTime(sample.observedAt),
    ...(usage === null
      ? { tokenLabel: `Контекст: ${sample.usedTokens.toLocaleString()} ток.` }
      : {}),
    note: `${args.failed ? "Обновление не удалось. Сохранённый замер. " : ""}Исходная сессия ${providerLabel}: ${sample.usedTokens.toLocaleString()} токенов контекста, ${observed}${sample.model === null ? "" : `, источник ${sample.model}`}. Замер последнего запроса по данным провайдера; не суммарный расход диалога. Значение может отличаться между bb и родным клиентом из-за разных provider-путей. ${usage ? (confirmedWindow !== null ? "Окно подтверждено нативным замером; процент оценочный." : knownWindow !== null ? "Для линейки GLM-5.3 используется окно 1 млн токенов; процент оценочный." : "Размер окна — по данным bb; процент оценочный.") : "Размер окна для этой модели не подтверждён; процент не рассчитан."}`,
  };
}

function formatObservedTime(
  observedAt: string | null | undefined,
): string | null {
  if (observedAt == null) return null;
  const date = new Date(observedAt);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function useNativeContextWindow(
  threadId: string,
  enabled: boolean,
  bbUsage: ThreadContextWindowUsage | null | undefined,
  selectedModel: string | null,
  running = false,
  providerName: string | null = null,
) {
  const query = useQuery({ ...nativeHistoryQueryOptions(threadId), enabled });
  return resolveNativeContextWindow({
    enabled,
    providerName,
    sample: query.data?.contextUsage ?? null,
    bbUsage: bbUsage ?? null,
    selectedModel,
    failed: query.isError,
    running,
  });
}
