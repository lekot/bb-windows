import { describe, expect, it } from "vitest";
import { pluginSdkAliasFor } from "../../../src/services/plugins/plugin-runtime.js";

describe("pluginSdkAliasFor", () => {
  it("resolves the pre-rename specifier to the same SDK runtime bundle", () => {
    const alias = pluginSdkAliasFor("/srv/plugin-sdk-runtime.js");

    expect(alias["@get-bb/plugin-sdk"]).toBe("/srv/plugin-sdk-runtime.js");
    expect(alias["@bb/plugin-sdk"]).toBe("/srv/plugin-sdk-runtime.js");
    expect(alias["@get-bb/plugin-sdk/host"]).toBe(
      "/srv/plugin-sdk-runtime.host.js",
    );
    expect(alias["@get-bb/plugin-sdk/ai-services"]).toBe(
      "/srv/plugin-sdk-runtime.ai-services.js",
    );
    expect(alias["@get-bb/plugin-sdk/provider-bridge"]).toBe(
      "/srv/plugin-sdk-runtime.provider-bridge.js",
    );
    expect(alias["@get-bb/plugin-sdk/provider-bridge/acp"]).toBe(
      "/srv/plugin-sdk-runtime.provider-bridge-acp.js",
    );
  });
});
