import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPluginApp, resolvePluginBuildToolchain } from "../../../packages/plugin-build/src/index.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const version = JSON.parse(await readFile(new URL("../../../packages/bb-app/package.json", import.meta.url), "utf8")).version;
const toolchain = await resolvePluginBuildToolchain(fileURLToPath(new URL("../../../.runtime/data/plugins", import.meta.url)));
await buildPluginApp(root, version, toolchain);
