# Workspace Explorer

Browse the current thread's workspace files in the thread's right panel.

Open the **Explorer** tab next to the thread panel actions. The root is the
working folder of the thread's own environment on its host — not a Tasks
project and not the attachment storage. Folders expand in place with a lazy
listing of their immediate children; clicking a file opens it in bb's standard
preview (monaco editor, PDF, images, depending on the installed file openers).

Threads without an environment workspace show an explanation instead of a
guess. The tree is read-only: no editing, creating, deleting, or uploading.
Switching threads resets the tree.

Agents read the same information through existing commands (verified against
`--help`):

```sh
bb thread show --self --json          # thread.environmentId of the current thread
bb environment show <env-id> --json   # workspace path and host of the environment
bb environment paths <env-id> --directories --files [--query <q>] [--json]
                                      # search the environment's files (recursive index)
bb file read <path>                   # file contents on the BB machine
```

The plugin adds no commands of its own. Plugin servers reach the same data via
`bb.sdk.threads.get`, `bb.sdk.environments.get`, and `bb.sdk.hosts.directory`.
