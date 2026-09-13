# Windows Screen

Bundled Windows plugin. For source development, install from the checkout with `bb plugin install path:./plugins/windows-screen --yes`.

Latest screenshots are stored in the plugin SQLite database, not the 256 KiB-limited KV store. Legacy KV screenshots remain readable until replaced by a new capture.

Click the preview to open a separate browser window with fit, 100%, and zoom controls (up to 400%). Browsers may show it as a tab or require popup permission. This enlarges the saved image, not the capture resolution.

In a session's right-panel add menu select **Скриншот ПК** and click the capture button. No automatic capture. Monitor 0 is primary; other indices follow Windows enumeration. The host needs an unlocked interactive desktop. Locked/unavailable desktops return an error; no unlock or login is attempted.

Agent tool: `CaptureWindowsScreen({monitor: 0})`, returning JPEG content. CLI: `bb windows-screen capture <thread-id> [monitor-index] --json`. SDK: `sdk.plugins.callRpc({pluginId: "windows-screen", method: "capture", input: {threadId, monitor: 0}, outputSchema: shotSchema})`; RPC `latest` takes `{threadId}`. Host is resolved from the session environment, never from the browser device.

Maximum image edge 1600 pixels, 20-second process timeout, one capture at a time per host worker. Only the latest image per thread is retained in plugin storage; agent tool output may also be retained in conversation history. No video, mouse or keyboard actions. Screenshots can contain sensitive information and are available to everyone with access to the BB instance. Uninstall/disable stops new requests, not copies already saved by clients.
