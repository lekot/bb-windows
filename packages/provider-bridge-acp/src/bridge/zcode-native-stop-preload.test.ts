import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const preload = readFileSync(new URL("../../../../scripts/zcode-native-stop-preload.cjs", import.meta.url), "utf8");
const needle = 'n.activeAbortController?.abort(new Error("ZCode Protocol session stopped")),i&&await Zh(e,n,"session_stop_goal_paused")';

function harness(args: string[], source: string) {
  const original = vi.fn();
  const read = vi.fn(() => source);
  const moduleApi = { _extensions: { ".js": original } };
  runInNewContext(preload, {
    process: { argv: args },
    require: (name: string) => {
      if (name === "node:fs") return { readFileSync: read };
      if (name === "node:path") return { resolve, basename: (file: string) => file.split(/[\\/]/).pop() };
      if (name === "node:module") return moduleApi;
      throw new Error(name);
    },
  });
  return { original, read, moduleApi };
}

describe("ZCode stop preload boundary", () => {
  it("leaves non-app-server processes unchanged", () => {
    for (const args of [["node", "zcode.cjs", "login"], ["node", "other.cjs", "app-server"]]) {
      const state = harness(args, "");
      expect(state.moduleApi._extensions[".js"]).toBe(state.original);
      expect(state.read).not.toHaveBeenCalled();
    }
  });

  it("patches only the known entry and restores the loader", () => {
    const state = harness(["node", "zcode.cjs", "app-server"], `t.stopActiveForegroundExecution=mUr;${needle}`);
    const compile = vi.fn();
    const loader = state.moduleApi._extensions[".js"];
    loader({ _compile: compile }, resolve("other.cjs"));
    expect(state.original).toHaveBeenCalledTimes(1);
    expect(state.read).not.toHaveBeenCalled();
    loader({ _compile: compile }, resolve("zcode.cjs"));
    expect(compile).toHaveBeenCalledWith(expect.stringContaining('n.app.runtime.stopActiveForegroundExecution({reason:"bb session stop",preserveQueueAutoDrainOnCancel:false}),'+needle), resolve("zcode.cjs"));
    expect(state.moduleApi._extensions[".js"]).toBe(state.original);
  });

  it("refuses unknown or ambiguous native versions", () => {
    for (const source of ["changed upstream", needle, `stopActiveForegroundExecution=mUr;${needle};${needle}`]) {
      const state = harness(["node", "zcode.cjs", "app-server"], source);
      const compile = vi.fn();
      expect(() => state.moduleApi._extensions[".js"]({ _compile: compile }, resolve("zcode.cjs"))).toThrow("compatibility patch refused");
      expect(compile).not.toHaveBeenCalled();
    }
  });
});
