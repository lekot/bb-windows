import { describe, expect, it } from "vitest";
import { createProviderRegistryService } from "../../../src/services/providers/provider-registry.js";
import {
  buildProviderThreadExecutionDefaults,
} from "../../../src/services/threads/thread-default-policy.js";

function zcodeRegistry(): ReturnType<typeof createProviderRegistryService> {
  const registry = createProviderRegistryService();
  registry.register({
    info: {
      id: "acp-zcode",
      pluginId: "test",
      displayName: "ZCode",
      available: true,
      maintenance: { health: false, usage: false, installation: false },
      logoUrl: null,
      capabilities: {
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsServiceTier: true,
        supportsNativeUserQuestion: false,
        supportsFork: false,
        supportsSessionRewind: false,
        permissionModes: ["accept-edits", "full"],
        modelCatalogScope: "host",
      },
      composerActions: [],
    },
    serverCapabilities: {
      reasoningLevels: ["low", "high", "max"],
      fork: "none",
      supportsManualCompaction: false,
    },
  } as unknown as Parameters<ReturnType<typeof createProviderRegistryService>["register"]>[0]);
  return registry;
}

function genericRegistry(): ReturnType<typeof createProviderRegistryService> {
  const registry = createProviderRegistryService();
  registry.register({
    info: {
      id: "acp-cursor",
      pluginId: "test",
      displayName: "Cursor",
      available: true,
      maintenance: { health: false, usage: false, installation: false },
      logoUrl: null,
      capabilities: {
        supportsThreadArchive: false,
        supportsThreadRename: false,
        supportsServiceTier: true,
        supportsNativeUserQuestion: false,
        supportsFork: false,
        supportsSessionRewind: false,
        permissionModes: ["accept-edits", "full"],
        modelCatalogScope: "host",
      },
      composerActions: [],
    },
    serverCapabilities: {
      reasoningLevels: ["low", "medium", "high", "xhigh", "max"],
      fork: "none",
      supportsManualCompaction: false,
    },
  } as unknown as Parameters<ReturnType<typeof createProviderRegistryService>["register"]>[0]);
  return registry;
}

describe("buildProviderThreadExecutionDefaults reasoning", () => {
  it("picks high (not medium) for a zcode provider that only declares low/high/max", () => {
    const registry = zcodeRegistry();
    const defaults = buildProviderThreadExecutionDefaults(registry, {
      model: "zai/glm-5.3",
      providerId: "acp-zcode",
    });
    expect(defaults.reasoningLevel).toBe("high");
  });

  it("keeps the bb default medium for a provider with the generic ladder", () => {
    const registry = genericRegistry();
    const defaults = buildProviderThreadExecutionDefaults(registry, {
      model: "cursor/claude",
      providerId: "acp-cursor",
    });
    expect(defaults.reasoningLevel).toBe("medium");
  });

  it("falls back to the first supported level for a provider with only ultracode", () => {
    const registry = createProviderRegistryService();
    registry.register({
      info: {
        id: "acp-exotic",
        pluginId: "test",
        displayName: "Exotic",
        available: true,
        maintenance: { health: false, usage: false, installation: false },
        logoUrl: null,
        capabilities: {
          supportsThreadArchive: false,
          supportsThreadRename: false,
          supportsServiceTier: true,
          supportsNativeUserQuestion: false,
          supportsFork: false,
          supportsSessionRewind: false,
          permissionModes: ["accept-edits", "full"],
          modelCatalogScope: "host",
        },
        composerActions: [],
      },
      serverCapabilities: {
        reasoningLevels: ["ultracode"],
        fork: "none",
        supportsManualCompaction: false,
      },
    } as unknown as Parameters<ReturnType<typeof createProviderRegistryService>["register"]>[0]);
    const defaults = buildProviderThreadExecutionDefaults(registry, {
      model: "exotic/model",
      providerId: "acp-exotic",
    });
    expect(defaults.reasoningLevel).toBe("ultracode");
  });

  it("returns medium for an unknown provider with no capabilities", () => {
    const registry = createProviderRegistryService();
    const defaults = buildProviderThreadExecutionDefaults(registry, {
      model: "unknown/model",
      providerId: "acp-unknown",
    });
    expect(defaults.reasoningLevel).toBe("medium");
  });
});
