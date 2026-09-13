import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rewriteAcpLaunchSpec } from "./first-party-replay.js";

const RECORDING_DIR = fileURLToPath(
  new URL("../../recordings/acp-cursor/steer", import.meta.url),
);
const REPLAY_CHILD_PATH = fileURLToPath(
  new URL("./replay-provider-child.mjs", import.meta.url),
);
const REPLAY_COMMAND = [
  process.execPath,
  REPLAY_CHILD_PATH,
  "--recording",
  RECORDING_DIR,
  "--dialect",
  "json-rpc",
  "--state",
  "/tmp/replay-state",
];

function rewrittenSpec(modelCli: unknown): Record<string, unknown> {
  const line = JSON.stringify({
    jsonrpc: "2.0",
    method: "thread/start",
    params: {
      threadId: "thr_ewk7j7h9nm",
      options: {
        model: "auto",
        providerOptions: {
          acpLaunchSpec: {
            displayName: "Cursor",
            command: "cursor-agent",
            args: ["acp"],
            env: { CURSOR_TOKEN: "secret" },
            ...(modelCli === undefined ? {} : { modelCli }),
          },
        },
      },
    },
  });
  const rewritten: unknown = JSON.parse(
    rewriteAcpLaunchSpec(line, REPLAY_COMMAND),
  );
  return (
    rewritten as {
      params: {
        options: {
          providerOptions: { acpLaunchSpec: Record<string, unknown> };
        };
      };
    }
  ).params.options.providerOptions.acpLaunchSpec;
}

describe("rewriteAcpLaunchSpec", () => {
  it("keeps the recorded CLI model channel while pointing it at the replay child", () => {
    const spec = rewrittenSpec({
      listArgs: ["--list-models"],
      selectFlag: "--model",
      primaryModels: ["auto", "composer-2.5"],
    });

    expect(spec.command).toBe(process.execPath);
    expect(spec.args).toEqual(REPLAY_COMMAND.slice(1));
    expect(spec.env).toEqual({});
    expect(spec.modelCli).toEqual({
      listArgs: [...REPLAY_COMMAND.slice(1), "--replay-list-models"],
      selectFlag: REPLAY_CHILD_PATH,
      primaryModels: ["auto", "composer-2.5"],
    });
  });

  it("leaves a spec without a usable CLI model channel on the native path", () => {
    expect(rewrittenSpec(undefined).modelCli).toBeUndefined();
    expect(
      rewrittenSpec({ listArgs: [], selectFlag: "--model" }).modelCli,
    ).toEqual({ listArgs: [], selectFlag: "--model" });
  });

  it("launches node with the child script when the bridge prepends the model flag", () => {
    const spec = rewrittenSpec({
      listArgs: ["--list-models"],
      selectFlag: "--model",
      primaryModels: ["auto"],
    });
    const launchArgs = [
      spec.modelCli as { selectFlag: string },
      "auto",
    ] as const;

    const argv = [
      (launchArgs[0] as { selectFlag: string }).selectFlag,
      launchArgs[1],
      ...(spec.args as string[]),
      "--version",
    ];
    const stdout = execFileSync(spec.command as string, argv, {
      encoding: "utf8",
    });

    expect(stdout.trim()).toBe("0.0.0-replay");
  });

  it("answers the model list probe from the recording without a real provider", () => {
    const spec = rewrittenSpec({
      listArgs: ["--list-models"],
      selectFlag: "--model",
      primaryModels: ["auto"],
    });
    const stdout = execFileSync(
      spec.command as string,
      (spec.modelCli as { listArgs: string[] }).listArgs,
      { encoding: "utf8" },
    );

    const listed = stdout
      .split(String.fromCharCode(10))
      .map((line) => /^(\S+) - (.+)$/.exec(line.trim())?.[1])
      .filter((id): id is string => id !== undefined);

    expect(listed).toEqual([
      "auto",
      "cursor-grok-4.6-medium",
      "gpt-5.6-sol-medium",
      "claude-opus-5-thinking-medium",
      "claude-fable-5-thinking-medium",
      "composer-2.5",
    ]);
  });
});
