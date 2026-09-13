# PC Control

A builtin bb plugin for the single-PC workflow: a compact always-on pill
(CPU + RAM) in the corner of the app window, a "PC Control" tab in the
thread side panel (and the root New thread screen's Actions list) with a
resource overview, the process table, and saved program profiles. The same
features are available headless through the `bb pc` CLI.

The plugin deliberately has **no host picker and no multi-machine UX**: every
call is routed to the server's enrolled host daemon (the connected host, or
the first enrolled host). Windows is the primary target; macOS and Linux get
a reduced fallback for metrics and process listing.

## What it does

- **Pill overlay** — a small always-on pill pinned to the bottom-right of the
  app window (`experimental_appOverlay`): CPU and RAM percentages with mini
  bars and a tiny status dot — fresh (green) / stale (amber, values dimmed
  with the last update time) / error (red, last values dimmed). On narrow
  screens (below the `sm` breakpoint) the pill collapses into a 4 px bar
  along the bottom screen edge — a freshness cap plus CPU and RAM segments
  colored by load level — so nothing floats over the composer. Clicking
  either opens the thread side panel with the full PC Control tab (on thread
  surfaces; on surfaces without a thread side panel the click is declined by
  the host). Details stay in the panel; the pill stays small and calm.
- **Overview** — CPU percent (ring), memory (ring), and uptime,
  auto-refreshed every 2 seconds while the panel is open, with a
  fresh/stale/error status line and dimming of stale or failed readings.
- **Processes** — name, PID, CPU, and RAM per process. Search, CPU/RAM sort
  toggle, capped output, and manual refresh (no polling). Collection runs
  one PowerShell process per refresh on Windows (`Get-Process` → CSV, UTF-8
  output, decimal commas normalized) and `ps` on POSIX; per-process CPU% is
  derived from CPU-seconds deltas between refreshes.
- **Programs** — saved profiles (`name`, `exe`, `args`, `cwd`, optional
  `processName`). Create, edit, delete, start, stop, and restart. Running
  state and PIDs are resolved from the live process list. Stop and restart
  always require an in-UI confirmation dialog.

The system snapshot (CPU/RAM/uptime) is collected entirely in-process from
`node:os` — polling the pill spawns nothing. PowerShell runs only when the
process table or a program action is actually requested.

## CLI

```
bb pc status                                  # CPU, memory, uptime
bb pc processes [--sort cpu|memory] [--limit n] [--query text]
bb pc apps [--json]                           # profiles + running state
bb pc start <profile>                         # by profile name or id
bb pc stop <profile>
bb pc restart <profile>
```

`status`, `processes`, and `apps` support `--json` for agent-friendly output.
Mutating commands act only on an existing saved profile; anything else exits
with `Unknown profile`.

## Architecture

```
apps (app.tsx)                bb pc CLI (server.ts)
      │ rpc                        │
      ▼                            ▼
server.ts ── profiles in bb.storage.kv ("profiles" key, zod-validated)
      │
      │ typed host RPC (host-contract.ts, zod at the boundary)
      ▼
host.ts (bb.host entry on the local host-daemon)
      ├── pc/metrics.ts        os.cpus()/totalmem()/freemem()/uptime()
      ├── pc/process-listing.ts PowerShell CSV / ps parsing, CPU-second deltas
      └── pc/apps.ts           spawn / taskkill lifecycle
```

- The **server never touches the local filesystem and never spawns
  processes**. It owns profiles, validation policy, host routing, and output
  shaping; all OS operations run inside the `bb.host` entry on the local
  host-daemon worker.
- Contracts are typed with `defineRpcContract` + zod on both ends
  (`contract.ts` for the frontend RPC, `host-contract.ts` for host RPC),
  following the git-graph plugin's structure.
- Profiles are stored through the official plugin storage API
  (`bb.storage.kv`), namespaced by the plugin id — not in a file next to the
  checkout.

## Load thresholds

Load colors live in one place — `components/load-thresholds.ts`:
normal < 85%, warning 85–95%, critical ≥ 95% (applied to CPU and memory
indicators).

## Safety rules

- **No shell interpolation anywhere.** `spawn`/`execFile` are always called
  with a fixed argv. The PowerShell `-Command` payload is a constant script;
  user input (profile fields, search queries) never enters command text.
  `taskkill` receives `/PID <n> /T` (plus `/F` on escalation) as argv.
- **Only profile-linked processes can be stopped.** Stop resolves PIDs by
  matching the saved profile (`processName`, defaulting to the exe base
  name, or the full exe path). The host re-verifies each PID's identity
  right before killing; unrelated processes are skipped. There is no free
  command line or shell field in the profile model.
- Stop asks the process to exit gracefully first (`taskkill /T` posts
  WM_CLOSE), polls up to 5 s, then escalates to `/T /F`. The whole stop
  operation is capped at 20 s.
- Validation limits: absolute exe/cwd paths (≤600 chars), ≤32 args of ≤1024
  chars each without control characters, `.exe` required on Windows, exe and
  cwd must exist, ≤32 profiles, unique names.
- Listing caps: ≤500 process samples per refresh, ≤4 MiB command output,
  15 s command timeout, ≤100 rows returned per RPC, ≤32 matched PIDs per
  profile.
- Concurrent readers share one sampler/collector state; calls that arrive
  too soon get the cached last value instead of nulls, and the baseline is
  never clobbered (safe for several app windows polling at once).

## Limitations

- CPU percent needs two samples; the very first overview refresh shows `—`
  until the second sample arrives (the panel's 2 s cadence makes this a
  one-time blip).
- `Get-Process` cannot read `Path` for elevated processes it does not own;
  such processes match by name only.
- Profile running-state is name-based. If an unrelated process shares the
  profile's process name, it counts as running (and would be stopped after
  confirmation) — set a distinct `processName` on the profile if needed.
- Started programs are detached; they keep running when the daemon or the
  plugin stops.
- The pill cannot hide itself while its panel tab is open (the SDK does not
  expose side-panel state).
- The plugin targets the single enrolled PC; it does not model multiple
  machines.

## Manual QA

Run the dev app against a live daemon (`scripts/bb-dev-app`), then:

1. Thread right panel → new tab → **PC Control** appears; same on the root
   New thread screen's Actions list. The pill is visible in the corner on
   every screen.
2. Overview tab: CPU and memory rings plus uptime appear, values change
   within ~2–4 s; stop the daemon to see the error state with dimmed last
   values; pause updates >10 s to see the stale marker.
3. Processes tab: rows appear sorted by CPU; search filters by name/PID;
   the sort toggle reorders; Refresh re-collects on demand only.
4. Programs tab: create a profile pointing at a harmless exe (e.g.
   `C:\Windows\System32\notepad.exe`); it appears stopped.
   Start → status becomes `running · <pid>`; the process exists in the
   Processes tab. Stop asks for confirmation and terminates it; Restart
   asks for confirmation, stops, and starts again with a new pid.
   Edit and delete work; delete asks for confirmation.
5. CLI: `bb pc status`, `bb pc processes --limit 5`, `bb pc apps --json`,
   `bb pc start <name>`, `bb pc stop <name>`, `bb pc restart <name>`,
   and `bb pc start no-such-profile` exits 1 with `Unknown profile`.
6. Daemon offline: pill shows the error dot and dashes; panel shows the
   error inline (no crash); CLI exits 1.

## Development

```
pnpm exec turbo run typecheck --filter=bb-plugin-pc-control
pnpm exec turbo run test --filter=bb-plugin-pc-control
```

Tests never launch real user programs: collectors, parsers, lifecycle, host
routing, and the CLI all run against injected fakes; the UI runs against a
scripted RPC client.
