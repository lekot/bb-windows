import type { ThreadNativeQuotaResponse } from "@bb/server-contract";

function formatReset(iso: string | null): string {
  if (iso === null) return "время неизвестно";
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "время неизвестно";
}

export function nativeQuotaTitle(quota: ThreadNativeQuotaResponse): string {
  if (!quota.supported) return "Квота провайдера недоступна для этого чата.";
  if (quota.status !== "ok") {
    return `Квота исходной подписки недоступна: ${quota.reason ?? quota.status}`;
  }
  const lines: string[] = [];
  if (quota.fiveHour !== null) {
    lines.push(
      `Пятичасовое окно: занято ${quota.fiveHour.usedPercentage}%, осталось ${quota.fiveHour.remainingPercentage}%.`,
      `Сброс: ${formatReset(quota.fiveHour.nextResetTime)}.`,
    );
  }
  if (quota.toolCalls !== null) {
    const used = quota.toolCalls.used === null ? "н/д" : String(quota.toolCalls.used);
    const total =
      quota.toolCalls.total === null ? "н/д" : String(quota.toolCalls.total);
    lines.push(`Вызовы инструментов: ${used} из ${total}.`);
  }
  lines.push(
    quota.fetchedAt === null
      ? "Время замера неизвестно."
      : `Замер: ${new Date(quota.fetchedAt).toLocaleString()}.`,
  );
  lines.push("Квота подписки — отдельно от контекста чата; проценты нативные, без пересчёта.");
  return lines.join(" ");
}

export function NativeQuotaIndicator({
  quota,
  error = false,
}: {
  quota: ThreadNativeQuotaResponse | undefined;
  error?: boolean;
}) {
  if (error) {
    return <span className="text-xs text-muted-foreground" title="Не удалось обновить квоту подписки. Предыдущий остаток может быть устаревшим.">Квота: н/д</span>;
  }
  if (quota === undefined) return null;
  if (!quota.supported) return null;
  if (quota.status !== "ok" || quota.fiveHour === null) {
    return (
      <span
        className="text-xs text-muted-foreground"
        title={nativeQuotaTitle(quota)}
      >
        Квота: н/д
      </span>
    );
  }
  return (
    <span
      className="text-xs text-muted-foreground"
      title={nativeQuotaTitle(quota)}
    >
      Квота 5ч: {quota.fiveHour.remainingPercentage}%
    </span>
  );
}
