# Windows fork audit — 2026-09-13

Release status: **locally verified candidate; clean-machine acceptance pending**.
The baseline findings below are historical; the verification record at the end
states what was actually implemented and exercised during this task.

## Baseline

- Initial branch: `main`; working tree was clean.
- Initial HEAD: `e4da5786ccf9325340c552c520920d9468cc0031`.
- Fetched upstream: `https://github.com/get-bb/bb.git`, main at `cf51227e1`.
- Merge base: `267938526dfcbc0edb228ce827b5bec202c1af97`.
- Divergence: 50 local commits, 6 upstream commits; 49 local non-merge patches.
- Local delta against the merge base: 854 files, 107710 insertions, 2373 deletions.
- `git cherry upstream/main HEAD` found no patch-equivalent local commits.
- `origin` points to a temporary local checkout; it is not a distribution remote.
  `forgejo` is the internal remote. No push or history rewrite was performed.

## Inventory

| Category | Verified source areas | Disposition |
| --- | --- | --- |
| Windows platform | process-utils, host terminal/ConPTY, workspace paths, hidden helpers, CLI shim, portable plugin builds | Required; retain and verify |
| Runtime lifecycle | packages/bb-app/src/launcher.ts, config runtime records, scripts/start-windows-spike*.ps1 | Existing supervision is reusable; Windows stop and outer supervisor need work |
| Providers | provider-codex, provider-claude-code, provider-acp, provider bridges, native session history | Retain; test new threads and delivery end to end |
| ZCode | scripts/patches/zcode-acp-windows.patch, snapshot/preload helpers | External adapter pinned in docs; not a self-contained installation yet |
| DeepSeek | provider-acp/src/known-agents.ts | OpenCode and Harness are distinct launch paths; Harness assumes a global npm directory and User-scoped key |
| Selected UI | PC Control, Git Graph, Workspace Explorer, Windows Screen, Monaco Markdown preview, typography, sidebar quotas | Retain selected distribution components |
| Excluded features | Tasks, Taskboard, Project Preflight, Theme Preview, standalone Usage Tracker | Exclude from distribution; quota-strip selection awaiting clarification |
| Incidental features | voice correction service integration, voice deployment handoffs, HTML resource/typography mockups, diagnostic probes | Do not ship personal configuration or demonstrations |
| Reliability | thread queries, realtime cache owners, provisioning mutations, server dispatch checks | Retain; prior descriptions are not test evidence |
| Upstream overlap | six new upstream commits affect timeline rendering, image lightbox, model catalogs and provider handoff | Potential semantic overlap in thread UI; no exact patch duplicates found |

`TaskNotificationCard` represents provider execution events, not the Tasks plugin;
removing it by filename would damage native session rendering.

## Concrete findings

1. The spike launcher binds `0.0.0.0`, enables local voice defaults and references
   a machine-specific voice endpoint. It must not serve as the distribution default.
2. The background launcher loops unconditionally and has no outer singleton or
   persistent stop intent. Stopping its child alone causes an immediate restart.
3. `packages/config/src/verified-process-stop.ts` uses Unix `ps` for identity and
   start-time verification. That does not provide native Windows stop support.
4. `apps/cli/bin/bb.cmd` selected its packaged layout only by `bb-chunks` presence.
   A partial package could fall through to the host-daemon `dist/index.js`.
5. Workspace Explorer and Windows Screen are workspace packages but absent from
   the bundled registry and bundled-plugin dependencies. Runtime installation on
   this machine is not proof that a fresh installation includes them.
6. Tasks and Theme Preview are in the official bundled list; Project Preflight is
   automatically enabled. Disabling a UI shortcut does not exclude their payloads.
7. Both the native SidebarUsageLimitsBadge and Usage Tracker implement quota UI.
   They must not be treated as interchangeable without checking the chosen strip.
8. Five copied TTF files live in `apps/app/src/assets/fonts/minis`. Distribution
   permission/source notices were not found beside them. Existing fontsource
   dependencies offer a reproducible alternative, subject to the chosen profiles.
9. Historical Windows docs/probes contain personal paths, project identifiers and
   local service addresses. A clean current tree alone cannot sanitize Git history.
10. No tracked runtime database or log was found by extension/path inspection.
    Two tracked PEM files are named localhost test fixtures; a full historical
    secret scan and fixture verification are still required.
11. The current machine runs a background BB instance from this checkout. Build
    artifacts must be validated in staging rather than overwritten while served.

## Fork structure

Keep upstream ancestry and add small normal commits; do not rebase published
history. Isolate installation, configuration examples, lifecycle smoke tests and
release packaging under `scripts/windows/` with one Windows README. Keep platform
primitives in existing platform packages and product policy in the server. Keep
the distribution plugin list explicit and test it against package dependencies.

Exclude demonstration/personal files from release artifacts. Preserve original
history locally for traceability, but do not publish it until historical scanning
is complete. Deleting a file in a new commit does not remove it from history.
If history contains private material, publication strategy requires a separate
decision; rewriting the existing repository is not authorized.

Use `git fetch upstream main`, create an integration branch from the accepted
fork release, and `git merge --no-ff upstream/main`. Review platform patches,
plugin composition, migrations and daemon wire-version changes. Install with the
frozen lockfile and run the Windows acceptance suite before merging integration
back. Colleagues update only from accepted fork releases, never directly from
upstream. No force push is needed.

## Implemented and verified

The Windows launcher now uses a named mutex, hidden PowerShell supervisor,
Windows Job Object and persistent graceful-stop request. Fresh data defaults to
loopback binding and a per-user data directory outside Git. Install, dependency
check, configuration example, update, lifecycle and provider-smoke scripts are
under `scripts/windows/`; colleague commands are in `README.windows.md`.

The CLI shim cannot fall through to daemon code. Windows Node re-execution,
bundled npm invocation and asynchronous CLI error shutdown were corrected;
the real HTTP error reproduction no longer aborts in libuv handle cleanup.
Harness resolves an executable override or PATH and inherits the configured key.

Selected payload: Codex, Claude, ACP routes for ZCode/OpenCode/Harness, PC Control,
Workspace Explorer, Windows Screen, Git Graph, Monaco Markdown, native quota
badge, themes and typography. Tasks, Taskboard, standalone Usage Tracker,
Theme Preview, Project Preflight and API Tester are not bundled. Five copied
TTFs were removed; local-font aliases fall back to pinned fontsource packages.

| Check | Observed result |
| --- | --- |
| Isolated source preparation on Windows x64, Node 24.13.1, pnpm 9.15.0 | Passed |
| Full installer in the sanitized release worktree | Passed with frozen lockfile and native SQLite prebuild repair |
| CLI suite | 621 passed, 10 platform skips, one scaffold-build timeout in the full run; after a bounded timeout correction, all 10 tests in that file passed |
| CLI Windows regressions | Source/package shim, extensionless re-exec and repeated HTTP failures passed in the suite |
| App/theme/quota/realtime tests | 169 passed |
| Selected plugin tests | 280 passed: PC Control 91, Git Graph 122, Monaco 44, Explorer 18, Screen 5 |
| ACP tests | 18 passed, including inherited-key Harness launch and exit status |
| Server provisioning/catalog/policy tests | 24 passed initially; all 32 plugin-policy tests passed after fixing stale expectations |
| Portable path and audio fixtures | 62 app tests and 9 daemon tests passed |
| Typechecks | CLI, server, daemon, app, ACP, Screen and Explorer passed |
| Concurrent startup and crash recovery | Passed twice, including the final sanitized build: one server and daemon, recovery after killing each child and the runtime, stop, restart, no retained test listeners |
| Real new threads | Codex, Claude, ZCode, OpenCode/DeepSeek and Harness/DeepSeek all returned their distinct requested markers |
| Already-open chat | Codex follow-up submitted through Chrome UI; separate assistant marker appeared without navigation/reload and was confirmed in persisted CLI output |
| UI panels | PC Control metrics, Explorer file listing, Markdown preview, stored Windows screenshot and Git Graph commit were observed; typography profiles and quota badge were visible |
| Screenshot execution | Host plugin returned valid JPEG data at 1600 × 670; image stayed in local test evidence |
| Compact PC Control | Corrected the desktop-pill breakpoint; 91 plugin tests passed, and an 800 × 600 browser check confirmed the Submit button receives the click |

Tests used isolated data and a synthetic Git project. The existing user BB
instance was not stopped or rebuilt. Test browser and BB listeners were closed.
Raw logs, screenshots, provider model catalogs and test databases remain ignored
local evidence; they are not committed or included in release history.

## Release ancestry and security review

`release/windows-candidate` starts at upstream merge base `267938526`, with a
sanitized snapshot commit `777a76492`. Original `main` and its existing commits
remain untouched. The release filter excluded 367 current paths and restored
144 upstream source paths; it does not copy the private local commits. The
release lockfile was regenerated in `433922857` (281 obsolete lines removed).
Excluded upstream plugin maintenance sources can remain in Git while their
runtime payloads are absent. Local Taskboard/Usage Tracker and diagnostic demos
are absent from the candidate's selected delta.

A pattern scan inspected 1092 text blobs unique to the old fork history and
627 text blobs unique to the initial release candidate. Neither scan found
known credential prefixes or new private-key blocks. The old history contained
personal locations; the candidate scan found none of those locations. This is
a targeted scan, not a guarantee that arbitrary secrets cannot exist. The two
localhost PEM fixtures are inherited upstream test assets, not copied machine
certificates. No tracked runtime DB/log was found or added.

Only the release branch is suitable as the basis of a new repository; do not
push `main`, all refs or the ignored runtime directories. Nothing was published,
pushed, force-pushed or rebased during that preparation phase.

## Known limitations and remaining acceptance

- A clean Windows VM installation has not been exercised. The clean worktree
  still uses this host's installed prerequisites and authenticated providers.
- ZCode smoke used the already-built pinned adapter. A fresh Rust build plus
  fresh ZCode authentication remains a release check. Harness is a release
  candidate version; provider updates require rerunning the smoke.
- All five provider routes passed CLI creation/inference. Live browser delivery
  was exercised for Codex, not separately for every provider or reconnect case.
- The shell supervisor is not a Windows service or a scheduled boot task.
  Recovery covers service/runtime crashes while the supervisor is running.
- Browser checks covered desktop 1600 × 1100 and the corrected PC Control
  interaction at 800 × 600. They are not an exhaustive responsive/iOS audit.
- LAN authentication/TLS/firewall setup and Electron desktop packaging are outside
  this candidate. LAN remains an explicit opt-in.
- A trial merge of upstream `cf51227e1` produced conflicts in six app files and
  the migration 0119 snapshot/journal. It was aborted cleanly. Resolve model
  selection, timeline scrolling, thread-query/prompt changes, then regenerate
  migrations rather than editing snapshots. The documented merge workflow
  preserves ancestry; it does not promise conflict-free upstream updates.

Stable-release gate: finish the clean-machine and fresh-adapter checks, review any
remaining private material and the distribution scope. The user subsequently gave explicit
authorization to publish the sanitized candidate as a public preview at https://github.com/zr54211/bb-windows. This does not upgrade the unexecuted checks to passes.
