export function openScreenViewer(source: string): boolean {
  const viewer = window.open("about:blank", "_blank", "popup,width=1200,height=850,resizable=yes,scrollbars=yes");
  if (!viewer) return false;
  viewer.opener = null;
  const doc = viewer.document;
  doc.title = "Скриншот ПК — bb";
  doc.body.style.cssText = "margin:0;background:#171717;color:#eee;font:16px system-ui;";
  const toolbar = doc.createElement("div");
  toolbar.style.cssText = "position:sticky;top:0;display:flex;gap:12px;align-items:center;padding:12px;background:#242424;z-index:1;";
  const image = doc.createElement("img");
  image.alt = "Скриншот ПК";
  image.style.cssText = "display:block;margin:0 auto;cursor:zoom-in;";
  const label = doc.createElement("span");
  let scale = 1;
  let fitted = true;
  function render() {
    if (!image.naturalWidth) return;
    if (fitted) scale = Math.min(1, viewer!.innerWidth / image.naturalWidth, Math.max(1, viewer!.innerHeight - toolbar.offsetHeight) / image.naturalHeight);
    image.style.width = `${image.naturalWidth * scale}px`;
    image.style.height = "auto";
    label.textContent = `${Math.round(scale * 100)}%`;
    image.style.cursor = fitted ? "zoom-in" : "zoom-out";
  }
  function button(text: string, action: () => void) {
    const element = doc.createElement("button");
    element.textContent = text;
    element.style.cssText = "padding:6px 12px;cursor:pointer;";
    element.onclick = action;
    toolbar.append(element);
  }
  button("Вписать", () => { fitted = true; render(); });
  button("100%", () => { fitted = false; scale = 1; render(); });
  button("−", () => { fitted = false; scale = Math.max(0.1, scale / 1.25); render(); });
  button("+", () => { fitted = false; scale = Math.min(4, scale * 1.25); render(); });
  toolbar.append(label);
  image.onclick = () => { fitted = !fitted; scale = 1; render(); };
  image.onload = render;
  viewer.onresize = render;
  doc.body.append(toolbar, image);
  image.src = source;
  return true;
}
