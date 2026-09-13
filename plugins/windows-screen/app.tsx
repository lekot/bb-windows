import { useEffect, useState } from "react";
import { definePluginApp, useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract, shotSchema } from "./contract.js";
import { openScreenViewer } from "./viewer.js";

function ScreenPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [shot, setShot] = useState<z.infer<typeof shotSchema> | null>(null);
  const [monitor, setMonitor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    setShot(null);
    rpc.call("latest", { threadId }).then((value) => { if (!disposed) setShot(value); }).catch(() => {});
    return () => { disposed = true; };
  }, [rpc, threadId]);
  async function capture() {
    setBusy(true); setError("");
    try { setShot(await rpc.call("capture", { threadId, monitor })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div style={{ padding: 16, overflow: "auto", height: "100%" }}>
    <p>Экран ПК этой сессии. Снимки доступны всем пользователям bb в локальной сети.</p>
    <label>Монитор (0 — основной): <input aria-label="Монитор" type="number" min={0} max={15} value={monitor} onChange={(e) => setMonitor(Number(e.target.value))} /></label>
    <button disabled={busy} onClick={() => void capture()}>{busy ? "Снимаю…" : "Скриншот ПК"}</button>
    {error && <p role="alert">{error}</p>}
    {shot && <><p>{shot.hostName} · {new Date(shot.capturedAt).toLocaleString()} · монитор {shot.monitor} · {shot.width}×{shot.height}</p>
      <button aria-label="Открыть снимок в отдельном окне" title="Нажмите, чтобы увеличить" style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", cursor: "zoom-in" }} onClick={() => {
        if (!openScreenViewer(`data:${shot.mimeType};base64,${shot.data}`)) setError("Браузер заблокировал окно. Разрешите всплывающие окна для bb и повторите.");
      }}><img alt="Последний снимок экрана ПК" src={`data:${shot.mimeType};base64,${shot.data}`} style={{ width: "100%", height: "auto" }} /></button>
      <a download="bb-screen.jpg" href={`data:${shot.mimeType};base64,${shot.data}`}>Скачать снимок</a></>}
  </div>;
}
export default definePluginApp((app) => {
  app.slots.threadPanelAction({ id: "windows-screen", title: "Скриншот ПК", icon: "Camera", component: ScreenPanel });
});
