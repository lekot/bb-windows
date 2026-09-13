# BB for Windows

**Public preview: verified on the development Windows PC; clean-machine acceptance is pending.**
The current acceptance record is [Windows fork audit](docs/windows-fork-audit.md).
This source distribution targets Windows x64 without WSL. It runs the web app,
server and host-daemon; it does not package the upstream Electron desktop app.

## Install

Install Git, PowerShell 7, Node.js 22.19 or newer and the repository-pinned pnpm:

```powershell
npm install --global pnpm@9.15.0
git clone https://github.com/zr54211/bb-windows.git bb-windows
cd bb-windows
pwsh -NoProfile -File scripts/windows/check.ps1
pwsh -NoProfile -File scripts/windows/install.ps1
```

Native dependencies use prebuilt packages when available. If the selected Node
version has no matching native prebuild, compilation requires the relevant
Windows C++ build tools and Python. Installation stops on failure; it must not be
treated as successful merely because JavaScript dependencies were downloaded.
Install/build in a stopped checkout. Keep a separate staging checkout when
another instance is serving its existing build files.

## Start and stop

```powershell
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Start
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Status
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Stop
```

Open `http://127.0.0.1:38886`. The daemon uses port 38887. The launcher is hidden;
a named Windows mutex prevents duplicate supervisors for the same data directory.
BB supervises server/daemon exits; the outer supervisor restarts a failed BB
runtime. A Windows Job Object contains its descendants. Stop requests allow
graceful shutdown, with a 20-second bound before the owned job is terminated.
Logs and the database stay under `%LOCALAPPDATA%\BBWindows`, outside the checkout.
`Status` reports supervisor ownership, not provider health.

Use `-DataDir`, `-ServerPort` and `-DaemonPort` for a separate instance. Supply the
same data directory to Start, Stop, Status, Install and Update. Alternatively set
`BB_WINDOWS_DATA_DIR`. Default access is loopback only. `-Lan` explicitly binds
the server to all IPv4 interfaces; it does not configure TLS or Windows Firewall.
Enable LAN access only after separately configuring access protection. No
certificate, firewall rule or personal proxy configuration is installed.

The CLI is separate from service lifecycle:

```powershell
& .\apps\host-daemon\dist\bb.cmd --help
$env:PATH = (Join-Path $PWD 'apps/host-daemon/dist') + ';' + $env:PATH
bb status --json
```

For custom server/daemon ports, set `BB_SERVER_URL` and `BB_HOST_DAEMON_PORT` in
the CLI shell. The installer does not change your persistent PATH.

## Providers and credentials

Each colleague authenticates their own Codex and Claude CLI. Install OpenCode
and DeepSeek Harness separately and configure their supported DeepSeek models.
`check.ps1 -Providers` checks command presence, not authentication or inference.
Use `bb provider list --json` and `bb provider models <id> --machine <id> --json`
to inspect actual availability; select models from that machine's catalog.

Optional environment values are listed in
[scripts/windows/.env.example](scripts/windows/.env.example). Copy it to a private
file outside Git and start with `-EnvFile <path>`. Node loads it without printing
its values. `DEEPSEEK_API_KEY` is inherited by Harness. Executable overrides
accept executable paths, not shell command strings. Harness resolves `dsh.cmd`
on PATH unless `BB_DEEPSEEK_HARNESS_EXECUTABLE` is set; it does not assume a
particular npm installation directory. OpenCode uses its own authenticated
configuration and `BB_OPENCODE_EXECUTABLE` when provided.

The live smoke used Codex 0.153.4, Claude Code 2.1.270, OpenCode 1.18.30 and
DeepSeek Harness 0.1.5-rc.1. The tested npm-distributed components can be pinned:

```powershell
npm install --global @openai/codex@0.153.4 opencode-ai@1.18.30 @deepseek-ai/dsh@0.1.5-rc.1
```

These commands install software, not credentials. Claude Code was tested through
its native executable. Authenticate each provider separately before the smoke.

ZCode needs the separately built adapter and an authenticated native ZCode CLI:

```powershell
git clone https://github.com/jpalmae/zcode-acp .runtime/zcode-acp
git -C .runtime/zcode-acp checkout 42fe149d4b501469343c01f23ba3801832306d53
$patch = Join-Path $PWD 'scripts/patches/zcode-acp-windows.patch'
git -C .runtime/zcode-acp apply $patch
pwsh -File scripts/build-zcode-light.ps1
```

This additionally requires Rust/Cargo and its Windows linker prerequisites.
Configure the ACP plugin's `customAgents` setting with slug `zcode`, the built
adapter's absolute executable path and the native CLI/config locations for that
machine. Keep `ZCODE_ACP_CONFIG_PATH`, `ZCODE_ACP_MODEL` and any native CLI path
override in local configuration. Never copy another user's authenticated ZCode
configuration. The saved compatibility patch is experimental and pinned; later
ZCode versions require revalidation. See [ZCode notes](docs/windows-zcode.md).

For a fresh ACP configuration, after starting BB and adding its CLI to PATH:

```powershell
$agent = @{
  id = 'zcode'
  displayName = 'ZCode'
  command = (Resolve-Path .runtime/zcode-acp/target/debug/zcode-acp.exe).Path
  args = @()
  env = @{
    ZCODE_ACP_ZCODE_PATH = Join-Path $env:ProgramFiles 'ZCode/resources/glm/zcode.cjs'
    ZCODE_ACP_CONFIG_PATH = Join-Path $env:USERPROFILE '.zcode/cli/config.json'
    ZCODE_ACP_MODEL = 'zai/glm-5.3'
  }
}
bb plugin config provider-acp set customAgents (ConvertTo-Json -InputObject @($agent) -Depth 4 -Compress)
bb plugin reload
```

Adjust the native CLI location if installed elsewhere. This sets the complete
custom-agent list; merge with existing entries when updating an existing setup.

## Selected distribution

The prepared plugin payload includes PC Control, Workspace Explorer, Windows
Screen, Git Graph and Monaco with Markdown preview, alongside core providers and
support plugins. The built-in sidebar quota badge remains. Tasks, Taskboard,
Usage Tracker, Theme Preview, Project Preflight and API Tester are not bundled.
Some excluded upstream plugin sources remain in the maintenance checkout to
preserve upstream integration; they are not installed into a fresh runtime.
Do not copy an existing runtime database or plugin directory into a release.

Color themes and typography profiles remain. Inter, Golos Text and JetBrains
Mono come from pinned fontsource packages. Fact, Frutiger, Crassula, Magistral and
PT Mono can resolve only from fonts already installed by the user; the fork no
longer bundles the copied TTFs with unverified distribution permissions.

## Verify

After preparing an isolated checkout:

```powershell
pnpm exec turbo run test:windows:lifecycle
pwsh -NoProfile -File scripts/windows/smoke-providers.ps1 -Project <SMOKE_PROJECT_ID>
```

Lifecycle smoke uses separate temporary data and ports 49886/49887. It starts
concurrently, kills only verified test-runtime children, checks recovery,
stops, and restarts. Its logs remain at the printed test directory.
Provider smoke creates real billable test threads through five routes:
Codex, Claude, ZCode, DeepSeek/OpenCode and DeepSeek/Harness. A private copy of
`providers.example.json` can pin model IDs selected from the live catalog.
Passing CLI smoke does not prove that an already-open chat received its response;
verify that separately in the browser without refreshing, plus each chosen plugin.

## Update and integrate upstream

Colleagues update from the approved fork remote, not directly from upstream:

```powershell
pwsh -NoProfile -File scripts/windows/update.ps1 -Remote origin -Branch main
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Start
```

Update requires a clean tree and a fast-forward. It fetches first, stops the
selected instance, merges and prepares. It leaves BB stopped if preparation
fails. Preserve your startup arguments when restarting; the updater does not
silently reset custom ports or LAN selection. Back up the stopped data directory
before updates involving database migrations; code rollback alone cannot undo a
database migration.

Maintainers integrate upstream in a separate branch/checkpoint:

```powershell
git fetch upstream main
git switch -c integrate/upstream-YYYY-MM-DD
git merge --no-ff upstream/main
```

Resolve conflicts, review the daemon protocol version and migrations, run the
build/tests and Windows acceptance checks, then merge the reviewed integration
branch into the fork. Do not rebase shared history or force-push.

The public preview repository is https://github.com/zr54211/bb-windows. Complete release and historical
secret review before marking a stable release. The maintenance checkout's `origin` is not the distribution URL.
Publishing Git history also publishes deleted files; exclusions from the current
bundle cannot sanitize historical personal documents or credentials. No publish
or push command is part of these scripts.

The published `main` comes from local `release/windows-candidate` and has upstream ancestry without the
old private fork commits. The original maintenance checkout's `main` remains its private history and
must not be used as the initial publication source. To prepare another snapshot
from committed maintenance changes, choose a new branch name:

```powershell
node scripts/windows/prepare-release.mjs release/windows-YYYY-MM-DD
git worktree add ../bb-windows-release release/windows-YYYY-MM-DD
cd ../bb-windows-release
pnpm install --lockfile-only --ignore-scripts
git add pnpm-lock.yaml
git commit -m "Refresh release workspace lockfile"
pwsh -NoProfile -File scripts/windows/install.ps1
```

Review `release-exclusions.json` and the resulting tree before distribution.
The script restores excluded areas to the pinned upstream baseline, preserving
upstream maintenance sources but discarding local experiments there. It creates
a new ref only and refuses to overwrite an existing branch. Subsequent accepted
release updates should be ordinary reviewed commits on the release branch, not
repeated snapshot replacement. Do not push all branches or all refs.

A trial merge of upstream `cf51227e1` found conflicts in model selection,
timeline scrolling, thread queries/prompt composition, and migration 0119.
The trial was aborted. This candidate stays on baseline `267938526`; integrating
those upstream changes requires resolving the contracts and regenerating the
Drizzle migration snapshot, then running the affected tests. Never resolve the
migration collision by manually editing snapshot JSON.
