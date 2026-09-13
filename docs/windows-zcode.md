# ZCode on Windows in bb

Compatibility target: `acp-zcode`, display name **ZCode** through the installed ACP providers plugin. Native ACP config options expose only **GLM-5.3** and **GLM-5.3-Flash**, with **Low / High / Max** reasoning. Older entries remain in the user's CLI configuration but are excluded from this adapter's runtime catalog. No desktop process or WSL is required during agent execution.

## Installed components

- ZCode desktop 3.11.2 supplies CLI 0.16.5 at `C:/Program Files/ZCode/resources/glm/zcode.cjs`.
- Adapter checkout: `.runtime/zcode-acp`, upstream https://github.com/jpalmae/zcode-acp at `42fe149d4b501469343c01f23ba3801832306d53`.
- Local compatibility patch: `scripts/patches/zcode-acp-windows.patch`; installed binary `target/debug/zcode-acp.exe` inside that checkout.
- Each user keeps their own credentials in `$env:USERPROFILE/.zcode/cli/config.json`. The compatible catalog includes `glm-5.3` and `GLM-5.3-Flash`. No key is stored in bb settings or this repository.
- ACP custom-agent settings use `ZCODE_ACP_MODEL=zai/glm-5.3` and `ZCODE_ACP_CONFIG_PATH=$env:USERPROFILE/.zcode/cli/config.json`. Runtime provider configuration is passed to the local ZCode process over stdin for create/resume; this is required by CLI 0.16.5.

Model selection uses native `session/setModel` with refreshed runtime model configuration; reasoning uses `session/setThoughtLevel`. Both return validated native settings through ACP `session/set_config_option`. Internal cancellation recovery reapplies the selected model and reasoning. bb runtime restoration reapplies its sticky selection.

The bb ACP bridge now also applies native config options before each new turn, not only at session construction. Model changes are applied before reasoning, and failures prevent silently sending the prompt to the old model. This uses existing turn options without changing the host-daemon wire contract.

When bb supplies an instruction prefix again, the adapter queries native `session/messages` and removes only an exact repeat of the latest user-message instruction prefix. Changed instructions are retained; failed history reads preserve the whole prompt. Existing history is not rewritten. `model-io` can still log full context snapshots: this is distinct from repeating instructions in a new user message.

## Compatibility fixes

Windows non-verbatim executable path; hidden subprocesses; native persistent session IDs; runtime-preference handshake; actual mode RPC forwarding; new MCP schema and MCP forwarding on resume; pending-turn registration before send acknowledgement. ACP image capability is enabled; unsupported embedded-input capability remains disabled.

## Image attachments

Choose **GLM-5.3-Flash** and attach/paste an image in the existing bb composer. The bb host reads the uploaded/local image, passes ACP image content, and the adapter sends a native `session/send.attachments` entry with `kind=image`, `mimeType`, `dataBase64`, `filename`, and `sizeBytes`. No image file path is substituted for the actual content. Native runtime metadata declares Flash's `supportsImages=true`; GLM-5.3 is text-only and receives an explicit error if an image is supplied, without silently switching models.

PNG, JPEG, WebP and GIF are accepted, including image-only messages. Limits: 10 MiB per image, 20 MiB and 8 images per message; invalid base64/unsupported MIME types are rejected. This does not add remote image URL fetching, PDF, or video support.

CLI/SDK use the existing attachment surfaces: `bb thread tell <thread-id> "Describe the picture" --model zai/GLM-5.3-Flash --image "C:/absolute/path/image.png"` (repeat `--image` for multiple images). The same host-readable attachment inputs are available through the existing SDK; no bb wire fields were added.

CLI 0.16.5 acknowledged `session/stop` but continued generation in the direct test. ACP cancel now terminates that session's owned native process tree and rehydrates the same persisted session on the next prompt. bb Stop also releases the provider runtime. Cancellation does not roll back file edits or external actions already completed.

## Verification

- Native direct GLM-5.3 reply: `ZCODE_GLM53_OK`.
- `node scripts/windows-zcode-acp-probe.mjs`: read README marker, close/load with remembered word, cancel, follow-up after cancel — passed.
- bb thread `thr_uc2a428qzp`, **ZCode GLM-5.3 Windows smoke**, project Windows smoke: real file tool returned `BB_NATIVE_WINDOWS_0609` and Windows demo path. Stop/restart preserved `BB_ZCODE_MEMORY_0709`; active-generation Stop followed by another prompt also succeeded. Resumed agent reported `mcp__bb-bridge__CaptureWindowsScreen` available; capture was not requested.
- Adapter unit tests: 11 passed. Logs: `windows-zcode-*.log` (ignored).
- Updated ACP probe: instruction dedup after load; Flash + Max verified in actual model I/O; cancellation followed by a response still using Flash + Max.
- Existing bb smoke session: selected Flash + Max through the bb CLI; actual request used `GLM-5.3-Flash`, `output_config.effort=max`, returned `CHECK-731`, and the new user message had 92 characters without repeated instructions. Sticky selection subsequently restored to GLM-5.3 + Max.
- Live bb sequence without Stop: GLM-5.3/Max → GLM-5.3-Flash/Low → GLM-5.3/Max. Both model and effort checked in actual model I/O, rather than relying on response text.
- ACP bridge typecheck and two targeted live-config tests passed. The full ACP test suite had process-fixture failures/timeouts on this Windows run and was interrupted; it is not a passing full-suite result.
- `node scripts/windows-zcode-acp-probe.mjs <menu-screenshot.png>`: only two model options; text-only model rejects images; Flash read model names from the user's screenshot without tools; image-only prompt succeeded; cancel/recovery still passed. Log: `windows-zcode-image-probe.log`.
- The same screenshot sent through the actual bb chat produced a native model-I/O user content block with `type=image`, `mediaType`, and `dataUrl`. Recognition worked, though the model misread one digit in the Turbo label; attachment delivery does not guarantee perfect OCR. The test chat is left on Flash + Max for image use.

## Process passport and MCP diagnostics

Verified with `node scripts/windows-zcode-passport-probe.mjs`: real stdio MCP fixture connected, an intentionally missing executable registered as one failure, Windows creation identity matched. No model call is needed for this probe. The full existing ACP probe also passed model switching, resume and cancel/recovery with passport writing enabled.

Run `./scripts/Get-ZCodeStatus.ps1` on the Windows host. Use `-ThreadId <bb-thread-id>` to select a chat, `-Json` for agent-readable output, or `-All` to include exited sessions. `-StatusDirectory` selects a non-default report directory. These are local diagnostics, not a new bb API or browser panel.

The adapter appends sanitized snapshots to `bb-status/<native-session-id>.jsonl` beside `ZCODE_ACP_CONFIG_PATH` (normally `$env:USERPROFILE/.zcode/cli`). Reports map BB_THREAD_ID, native session, adapter/native PID, process creation identity, launch time, working directory, selected model/reasoning and turn state. Windows PID is validated against its exact process creation FILETIME, so PID reuse is not reported as a live session. A missing identity or inaccessible process is `unverified`; the recorded turn state alone does not prove the process is alive. Sessions launched before this adapter build need a restart to create reports. Existing reports are retained; this is a diagnostic history, not the source of truth for bb sessions.

MCP diagnostics consume the native `process/mcpTelemetry` event with `kind=session_startup` and the matching session ID. The snapshot contains configured/connected/failed server counts and connected stdio process count after native connection setup. This is actual startup connection evidence, not just configured server names; it is not a continuous health check or proof that every tool works. `not_checked` means no matching startup evidence has arrived. MCPDetails includes the event timestamp; stopped sessions retain historical results. The global `mcp/list` status was deliberately rejected: CLI 0.16.5 gives it a separate `protocol-settings` lease, so its empty list does not describe session connections. No extra process, polling or forced MCP reconnection is introduced. Diagnostics do not block prompts, alter permissions, or enforce project-specific required servers. No credentials, environment dumps, raw MCP errors, authorization URLs or message contents are written.

## Rebuild and operate

Do not compile over a running adapter executable. Stop only its test/session first. Recreate the checkout at the pinned commit, apply the saved patch using `git apply`, then run `scripts/build-zcode-light.ps1` from PowerShell. `-Task test` runs unit tests. The helper sets one Cargo job and BelowNormal priority; uses the unoptimized development profile. Do not use a parallel release build while other agents are working.

For changes to the bb ACP bridge, run `pnpm exec turbo run build --filter=bb-plugin-provider-acp --concurrency=1`. Its dependency rebuilds the SDK runtime first. The packaged Windows runtime uses `apps/server/dist/builtin-plugins/provider-acp/dist`: deploy the generated `host.js`, `host.js.map`, and `host.meta.json` there together and reload only `provider-acp` after releasing idle ACP sessions. Other providers need no restart.

In bb: refresh browser → provider **ZCode** → model **GLM-5.3** or **GLM-5.3-Flash** → reasoning **Max** (or Low / High). Existing Codex/Claude project sessions were not changed. An older chat using `acp-default` needs a concrete model selected once.

Agent/CLI equivalent: `bb provider models acp-zcode --environment <environment-id> --json`, then `bb thread update <thread-id> --model zai/GLM-5.3-Flash --reasoning-level max`. The existing SDK model-catalog and thread-update surfaces expose the same settings; no new bb API is introduced.

Limitations: experimental adapter for a vendor-private protocol, not official ZCode support. Flash is a model, not the generic bb speed/service-tier toggle; that toggle is not wired. Native mode starts at `build`; bb's Full Access selector is not yet mapped to native `yolo`, so ZCode can still ask for approval. Session enumeration and fork/import of arbitrary older desktop sessions are not validated. Avoid the adapter's legacy OAuth flow; use the already configured native CLI credentials.
