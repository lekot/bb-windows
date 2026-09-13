# Windows fork audit — 2026-09-13

Release status: **not accepted for distribution**. This document records code and
Git inspection, not acceptance claims inherited from earlier handoffs.

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

## Remaining acceptance evidence

Clean Windows installation; reproducible provider setup; singleton start under
concurrency; recovery after server and daemon crashes; orderly stop and restart;
five new-thread checks (Codex, Claude, ZCode, DeepSeek/OpenCode, DeepSeek/Harness);
visible response without refresh; selected plugins/fonts; complete build and
relevant tests; sanitized release payload and Git history review.
