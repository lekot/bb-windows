---
name: acp-provider
description: "Configure or troubleshoot ACP agent discovery, custom models, skills, and compaction in BB."
---

# ACP providers

Windows DeepSeek Harness inherits `DEEPSEEK_API_KEY`; it does not read a
different User-scoped value over the running environment. It resolves `dsh.cmd`
on PATH or `BB_DEEPSEEK_HARNESS_EXECUTABLE`. OpenCode accepts
`BB_OPENCODE_EXECUTABLE`. Set executable paths, not shell command strings, and
restart BB after changing its environment. Configure ZCode separately with
custom-agent slug `zcode`; see the fork's `README.windows.md`.

Known agents can be discovered automatically when their CLI is installed on the
host: `opencode`, `omp`, `grok`, and `hermes` appear as `acp-opencode`, `acp-omp`,
`acp-grok`, and `acp-hermes-agent`. Inspect the target host's catalog with
`bb provider list` and `bb provider models <provider-id>` using its environment
or machine selector.

Cursor project skills come from `.cursor/skills`, which can link to
`.agents/skills`. BB lists these linked skills as read-only under `cursor-project`.

ACP agents may reject unlisted model IDs. OpenCode requires models in its own
configuration; BB discovers them there. OpenCode agents are session modes, not
models selectable through BB's model field.

OpenCode ACP supports the core `bb thread compact` command; Cursor ACP does not
expose compatible compaction. Check the actual agent's capabilities before
attempting provider-specific recovery.
