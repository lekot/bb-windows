# bb-plugin-git-graph

Read-only Git graph panel for BB: colored commit lanes, nested repository discovery, refs, dirty state, and per-file diffs — executed on the host that owns each checkout.

## Prototype gallery

Three live D3 prototypes of the commit graph (VS Code Git Graph-style compact
lanes, smooth `curveBumpY` lanes with ancestry hover, and a top-down DAG with
explicit forks and merges) render the same demo history on a dark gallery
page with a tab switcher and pros/cons notes. The gallery is a local
development aid — it is not part of the production panel and does not touch
real repositories.

```sh
corepack pnpm --filter bb-plugin-git-graph run gallery
```

Then open <http://127.0.0.1:4183/> (`GALLERY_PORT=…` overrides the port). The
command serves `gallery/` with a zero-dependency Node static server and
resolves D3 from the plugin's local dev dependency (`d3@7`, UMD build served
from `node_modules` — no CDN). `node gallery/selftest.mjs` validates the demo
dataset and the pure layout functions of all three variants;
`node gallery/render-smoke.mjs` renders every variant with the real D3
bundle into jsdom and checks the resulting DOM, hover highlighting, and
cleanup. `node fa-render-smoke.mjs` runs the production layout and lane
geometry against a real repository (`GIT_GRAPH_ACCEPTANCE_REPO`, defaulting
to the FA_develop checkout, and `GIT_GRAPH_ACCEPTANCE_LIMIT` commits, 300 by
default; it falls back to the demo fixture), writes a standalone SVG to the
temp dir, prints the widest lane and the graph column width, and asserts the
geometry invariants: one closed edge per loaded parent link, every edge
starts and ends on its commit dots, and no lane run crosses another commit's
dot.

## What it does

- **Sidebar panel** (GitBranch icon): the accepted D3 `curveBumpY` lane look
  (gallery variant 2) at VS Code Git Graph density — 22px rows, 15px lane
  spacing, 3.5px commit dots, 1.5px lines. Every parent link runs along its
  own lane: a lane change is a single-row `curveBumpY` bend right below the
  child or right above the parent, and the rest of the edge is straight, so
  lines enter dots dead-center, never pass through another commit, and never
  leave dangling stubs. Merge commits carry a soft halo, HEAD is a hollow
  ring, and `Uncommitted changes` is a muted ring with a dashed connector to
  the HEAD commit. Hovering a row lights its full ancestry chain and dims the
  rest; while a commit is selected, its ancestry stays lit and hovering other
  rows leaves the graph untouched.
- **Stable columns**: the graph column width comes from the widest lane of
  the whole loaded history, so it never changes while scrolling (only when a
  newly loaded page is wider), and `Description` always starts right after
  the graph with a constant gap. The `Graph | Description | Author | Date`
  header shares the row column layout; `Author` hides when the list is
  narrower than 36rem and `Date` below 24rem. Rows and graph elements are
  virtualized: the SVG only draws the edges and dots near the viewport.
- **Ref chips**: a filled green chip for the checked-out branch (a neutral
  `HEAD` chip when detached), outlined green local branches, blue remote-only
  branches, amber tags, and fuchsia stashes, each with a small glyph. A
  remote-tracking ref on the same commit as the local branch of the same name
  folds into that chip (`main │ origin`). Labels truncate with a tooltip, the
  number of chips adapts to the Description width (one to three), and the
  rest collapse into a `+N` chip whose tooltip lists them. Chips never wrap
  or grow a row.
- **Host-routed execution**: the plugin ships a `bb.host` entry. The server
  resolves the project's `local_path` source (folder + `hostId`) and sends
  every scan/status/history/detail/patch call to that host through typed host
  RPC. The server entry spawns no processes and touches no filesystem — a
  test guards this.
- **Chat-aware preselection**: a content script remembers the last
  project-scoped route (`/projects/…/threads/…`) while you work in chats.
  Opening Git Graph from a thread preselects that thread's project, its
  default folder source, and the root repository; manual switches inside the
  panel behave normally, and the next visit again follows the chat you came
  from.
- **Multi-host projects**: when a project has several folder sources, a
  source picker shows `path · default · host name`; every Git operation runs
  on the selected source's host, and the active `path @ host` is always
  visible in the toolbar. Nothing ever falls back to running on the server.
- **Repository discovery** under the source folder: the root
  repository, nested repositories, worktrees and submodules (`.git` file
  pointer), and the enclosing repository when the project folder is a
  subfolder of a repository. Service directories (`node_modules`, `.runtime`,
  `dist`, `build`, `.git` internals, …) are skipped, symlinked folders are not
  followed, and the scan is bounded by depth, directory count, and time.
- **Repository picker** with clear relative paths (`(project root)`,
  `tools/cli`, `../.. (above root)`, `· submodule`, `· worktree`), HEAD branch,
  and empty-repository markers.
- **Branches selector** (VS Code Git Graph style): `Show All` builds the
  unified history of `HEAD` plus every local branch; checking one or more
  branches in the multi-select menu shows only the history reachable from
  them. The current branch is marked
  `· current`. A `Show remote branches` checkbox adds locally-known
  remote-tracking refs to `Show All` and to the selector, and shows remote
  chips; when it is off, remote-only commits and remote chips are hidden.
  `refs/remotes/*/HEAD` aliases are never listed or duplicated. Selecting a
  branch resets when the repository changes.
- **Commit list**: subject (with a tooltip when truncated), author, and
  relative date. History uses VS Code Git Graph's default ordering
  (`git log --date-order`: children before parents, otherwise by commit
  date), which keeps concurrent lanes low on merge-heavy repositories, and the
  first-parent line stays on the leftmost lane. Lane colors stay stable across
  pagination and refresh because the layout is recomputed deterministically
  from the accumulated commit list. Search by commit message (debounced,
  case-insensitive) lays the results out without lanes to parents that are
  not in the result, so the graph stays narrow. Refresh; `Load more`
  pagination plus automatic loading while scrolling; the toolbar wraps to more
  rows in narrow side panels.
- **Commit card**: full metadata (hash with copy, author, committer, dates,
  tree), clickable parents, refs, full message, changed files with status
  letters and rename arrows, and a bb-native diff (`experimental_Diff`) per
  file. Patches above 1 MB are marked truncated.
- **Working copy state**: dirty badge (staged/unstaged/untracked/conflicted
  counts in the tooltip) or a Clean badge, plus an `Uncommitted changes` row
  pinned above the history and connected to the HEAD commit wherever it is
  listed (hidden while a search is active); clicking it opens a read-only
  breakdown card.
- **States**: skeletons while loading, empty states (no projects, no
  repositories, empty repository, no matches), and error states with Retry.
- **`bb git-graph` CLI**: `repos [--source <id>]`, `log [n] [--repo <path>] [--grep <text>]`,
  `show <hash> [--repo <path>]` — the same read-only data for agents, routed
  to the default source's host.

## Safety

- Only read-only Git commands are invoked; nothing mutates the repository.
- Read-only also means no implicit side effects: the Git environment sets
  `GIT_OPTIONAL_LOCKS=0` (so `status` never refreshes the index), every
  command passes `-c core.fsmonitor=false`, and patches are generated with
  `--no-ext-diff --no-textconv` so configured diff drivers and textconv
  filters cannot execute. `windowsHide`, per-command timeouts, and output
  buffers are always set. Tests assert these flags reach argv/env.
- Git runs via `execFile` with an argv array (no shell), `-C` for the working
  directory, and `--` before file paths. Windows paths with spaces, Unicode,
  and backslashes are passed as single arguments.
- The browser never sends absolute paths: the server only forwards the
  project/source ids it resolved itself, repository keys are re-validated on
  the host against the source root (climbing paths must match
  `git rev-parse --show-toplevel`), commit hashes must match `^[0-9a-f]{4,40}$`,
  and file paths are rejected when absolute, traversal-shaped, or
  option-shaped.
- Output is bounded (page size ≤ 300 commits, status entries capped at 2,000,
  patches capped at 1 MB, per-command timeouts and output buffers).

## Architecture

```
contract.ts            browser-facing zod schemas + RPC contract + types
host-contract.ts       typed host RPC contract (scan/status/history/detail/patch)
host.ts                host entry (experimental_defineHostEntry): repo-path
                       re-validation + GitGraphService on the source's machine
server.ts              plugin factory: source resolution by hostId, host client,
                       overview cache, CLI — no local fs/exec
git/schemas.ts         shared zod schemas and inferred types
git/paths.ts           pure path-form validators (repo rel paths, file paths)
git/run.ts             hardened execFile runner (GIT_OPTIONAL_LOCKS=0) + probing
git/discovery.ts       bounded repository scan (injectable FsReader)
git/parse.ts           parsers: log, for-each-ref, status -z, name-status -z
git/service.ts         GitGraphService composing runner + parsers
git/node-fs.ts         real FsReader over node:fs
graph/layout.ts        lane assignment (first-parent line stays left), per-edge
                       run lanes, edges, ancestry, search-result parents
graph/geometry.ts      row/lane metrics, graph column width, routed d3
                       curveBumpY edge paths
graph/palette.ts       categorical lane colors
components/            virtualized SVG lanes, ref chips, commit card, formatting
app.tsx                nav panel UI (pickers, column layout, rows, host display)
```

## Tests

```sh
pnpm exec turbo run typecheck test --filter=bb-plugin-git-graph
```

Unit tests cover discovery (nested/worktree/submodule, skip lists, budgets),
output parsing (Unicode, renames, conflicts, caps, branch listing with
remote-HEAD exclusion), branch-ref listing (current-first ordering, HEAD
marking), graph layout (the first-parent line stays on the left lane in both
merge listing orders, octopus merges, lane reuse, prefix stability, and
generated histories where no lane run crosses another commit or is shared by
two targets), lane geometry (column width, single-row lane changes, straight
runs, late joins, the color split at branch-offs, edges starting and ending on
dot centers), ref chip folding, the host entry on the SDK host harness
(scan/history/detail/status happy paths, scoped `git log` argv for a single
ref versus `--branches --remotes`, empty repositories, repo-path and
file-path rejection, hardening argv), the hardened runner's env/argv via a
mocked `child_process`, the server's hostId routing, source selection,
branch-scope and remote-toggle forwarding, overview caching, and the
no-local-fs/exec architecture guard on a fake plugin host, plus the panel UI
(column header, one graph column width that stays put while scrolling,
virtualized rows, the uncommitted row on the HEAD lane even when newer branch
tips are listed first, the chip limit in wide and narrow description columns,
flat search layout, hover dimming, remote toggle). An integration suite runs
the real `git` binary against temporary repositories (merge, tag, remote refs,
remote-only commits behind the toggle, remote-HEAD alias exclusion, branch
scoping, pagination, nested Unicode folder, empty repository, dirty state)
and skips itself when Git is not installed.

## Manual QA

1. Enable the plugin (`bb plugin list` should show `git-graph` healthy) and
   open the Git Graph panel from the sidebar.
2. Open a thread of one project, then click Git Graph in the sidebar: the
   panel should start on that project's default source. Open a thread of
   another project and return — the selection should follow.
3. Verify the toolbar shows the active `path @ host`; with a multi-source
   project, switch folder sources and confirm the host name follows the
   selection.
4. Verify the repository picker lists the project root repository and any
   nested repositories with readable relative paths; check a project with a
   worktree or submodule inside it.
5. Use the Branches selector: `Show All` shows every local branch's history;
   pick one branch and confirm only its history remains; toggle `Show remote
branches` and confirm remote branches appear in the selector, remote-only
   commits join `Show All`, and remote chips show on commits. Switch
   repositories and confirm the branch selection resets to `Show All`.
6. Scroll a long, merge-heavy history from top to bottom and back: the
   `Description` column must not move, header labels stay over their
   columns, and loading the next page may widen the graph column once.
7. Look closely at merges and branch-offs: lines enter dots without gaps or
   stubs, each lane change bends within one row, merge commits show a halo,
   and HEAD a hollow ring.
8. With a dirty working copy, confirm the `Uncommitted changes` row sits
   above the history, its dashed connector reaches the HEAD commit (also
   when other branches have newer commits), and its card shows the staged/
   unstaged/untracked/conflicted breakdown.
9. Check ref chips: the checked-out branch is filled, `main │ origin` folds
   the matching remote, tags are amber, long names truncate with a tooltip,
   and a commit with many refs shows a `+N` chip.
10. Narrow the panel to about 380px: `Author` and then `Date` hide, a single
    chip plus `+N` remains, and rows stay one line high.
11. Search for a word from a commit message: results render without lanes to
    missing parents; clear the search and press Refresh.
12. Click a merge commit: metadata, both parents (clickable), changed files
    vs the first parent, and a per-file diff should render; copy the hash.
13. Modify and stage files in the repository: the badge should show counts
    matching `git status --porcelain`, and the index mtime should not change
    (`GIT_OPTIONAL_LOCKS=0`).
14. Scroll to the bottom of a long history: more commits should load
    automatically; `Load more` must also work.
15. In an empty repository (`git init` with no commits) the panel should show
    the empty state, not an error.
16. Run `bb git-graph repos`, `bb git-graph log 5`, and
    `bb git-graph show <hash>` and compare with `git log --date-order`.
