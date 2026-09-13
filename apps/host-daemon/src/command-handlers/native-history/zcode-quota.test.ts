import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readZcodeQuota,
  resetZcodeQuotaCacheForTests,
} from "./zcode-quota.js";

const API_KEY = "test-quota-key-0123456789abcdef";

let configPath: string;
let previousConfigPath: string | undefined;
const fetchMock = vi.fn();

function quotaBody(): unknown {
  return {
    code: 200,
    success: true,
    data: {
      limits: [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          number: 5,
          percentage: 28,
          nextResetTime: 1788817443428,
        },
        {
          type: "TIME_LIMIT",
          unit: 5,
          number: 1,
          usage: 1000,
          currentValue: 18,
          remaining: 982,
          percentage: 1,
          nextResetTime: 1790756226997,
        },
        {
          type: "TOKENS_LIMIT",
          unit: 6,
          number: 1,
          percentage: 51,
          nextResetTime: 1788817443428,
        },
      ],
    },
  };
}

async function writeConfig(config: unknown): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(config));
}

function zaiConfig(): unknown {
  return {
    model: "zai/glm-5.3",
    provider: {
      other: {
        api: "https://example.com/api",
        options: { apiKey: "same-length-key-abcdefghijklmnop" },
      },
      zai: {
        api: "https://api.z.ai/api/anthropic",
        options: { apiKey: API_KEY },
      },
    },
  };
}

beforeEach(async () => {
  resetZcodeQuotaCacheForTests();
  const cliDir = await fs.mkdtemp(path.join(os.tmpdir(), "zcode-quota-"));
  configPath = path.join(cliDir, "config.json");
  previousConfigPath = process.env.ZCODE_ACP_CONFIG_PATH;
  process.env.ZCODE_ACP_CONFIG_PATH = configPath;
  delete process.env.ZCODE_BIGMODEL_USAGE_QUOTA_URL;
  delete process.env.BIGMODEL_USAGE_QUOTA_URL;
  delete process.env.ZCODE_BIGMODEL_USAGE_API_KEY;
  delete process.env.BIGMODEL_USAGE_API_KEY;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  await writeConfig(zaiConfig());
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (previousConfigPath === undefined) {
    delete process.env.ZCODE_ACP_CONFIG_PATH;
  } else {
    process.env.ZCODE_ACP_CONFIG_PATH = previousConfigPath;
  }
  await fs.rm(path.dirname(configPath), { force: true, recursive: true });
});

describe("readZcodeQuota", () => {
  it("isolates concurrent requests when equal-length account keys differ", async () => {
    const completions: Array<(response: Response) => void> = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
      completions.push(resolve);
    }));
    vi.stubEnv("ZCODE_BIGMODEL_USAGE_API_KEY", "account-A");
    const first = readZcodeQuota({ type: "host.read_zcode_quota" });
    vi.stubEnv("ZCODE_BIGMODEL_USAGE_API_KEY", "account-B");
    const second = readZcodeQuota({ type: "host.read_zcode_quota" });
    completions.forEach((resolve, index) => resolve(new Response(JSON.stringify({
      code: 200,
      success: true,
      data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 10 + index * 10 }] },
    }), { status: 200 })));
    const [a, b] = await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a).toMatchObject({ status: "ok", fiveHour: { usedPercentage: 10 } });
    expect(b).toMatchObject({ status: "ok", fiveHour: { usedPercentage: 20 } });
  });

  it("reads the verified five-hour and tool-call limits with the selected Z.ai key only", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(quotaBody()), { status: 200 }),
    );

    const result = await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.fiveHour).toEqual({
      usedPercentage: 28,
      remainingPercentage: 72,
      nextResetTime: new Date(1788817443428).toISOString(),
    });
    expect(result.toolCalls).toMatchObject({
      used: 18,
      total: 1000,
      remaining: 982,
      percentage: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe(
      "https://api.z.ai/api/monitor/usage/quota/limit",
    );
    expect(request?.[1]?.headers).toEqual({ Authorization: API_KEY });
  });

  it("caches a fresh response for repeated reads", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(quotaBody()), { status: 200 }),
    );

    await readZcodeQuota({ type: "host.read_zcode_quota" });
    await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the configured key changes even at the same length", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(quotaBody()), { status: 200 }),
    );

    await readZcodeQuota({ type: "host.read_zcode_quota" });
    await writeConfig({
      model: "zai/glm-5.3",
      provider: {
        zai: {
          api: "https://api.z.ai/api/anthropic",
          options: { apiKey: "same-length-key-abcdefghijklmnop" },
        },
      },
    });
    await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      Authorization: "same-length-key-abcdefghijklmnop",
    });
  });

  it("shares one in-flight request between concurrent reads", async () => {
    let resolveFetch!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = readZcodeQuota({ type: "host.read_zcode_quota" });
    const second = readZcodeQuota({ type: "host.read_zcode_quota" });
    resolveFetch(new Response(JSON.stringify(quotaBody()), { status: 200 }));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });

  it("refuses to send another provider's key when the selection is not Z.ai", async () => {
    await writeConfig({
      model: "other/some-model",
      provider: {
        other: {
          api: "https://example.com/api",
          options: { apiKey: API_KEY },
        },
      },
    });

    const result = await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "The selected native provider is not a Z.ai endpoint; its quota is not readable here",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unavailable state when the selected provider has no model selection", async () => {
    await writeConfig({
      provider: {
        zai: {
          api: "https://api.z.ai/api/anthropic",
          options: { apiKey: API_KEY },
        },
      },
    });

    const result = await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "Native ZCode CLI configuration has no selected provider",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors the env quota URL override and env usage key", async () => {
    process.env.ZCODE_BIGMODEL_USAGE_QUOTA_URL =
      "https://example.internal/api/monitor/usage/quota/limit";
    process.env.ZCODE_BIGMODEL_USAGE_API_KEY = "env-usage-key";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(quotaBody()), { status: 200 }),
    );

    await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.internal/api/monitor/usage/quota/limit",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: "env-usage-key",
    });
  });

  it("reports rejected credentials without leaking the key", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 401 }));

    const result = await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(result.status).toBe("missing");
    if (result.status !== "missing") return;
    expect(result.reason).not.toContain(API_KEY);
  });

  it("reports a transport failure as unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "Native quota endpoint could not be reached",
    });
  });

  it("reports missing credentials when the config file is absent", async () => {
    await fs.rm(configPath);

    const result = await readZcodeQuota({ type: "host.read_zcode_quota" });

    expect(result).toMatchObject({
      status: "missing",
      reason: "Native ZCode quota credentials were not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
