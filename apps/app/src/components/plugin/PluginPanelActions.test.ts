import { describe, expect, it, vi } from "vitest";
import {
  createNewThreadPanelOpener,
  type PluginPanelActionEntry,
} from "./PluginPanelActions";

function entry(
  pluginId: string,
  actionId: string,
  onSelect: () => void,
): PluginPanelActionEntry {
  return {
    id: `plugin-new-thread-action:${pluginId}:${actionId}`,
    pluginId,
    icon: null,
    title: actionId,
    onSelect,
  };
}

describe("createNewThreadPanelOpener", () => {
  it("opens the matching plugin action and reports success", () => {
    const onSelect = vi.fn();
    const opener = createNewThreadPanelOpener([
      entry("other-plugin", "notes", vi.fn()),
      entry("pc-control", "pc-control", onSelect),
    ]);
    const accepted = opener({
      actionId: "pc-control",
      pluginId: "pc-control",
    });
    expect(accepted).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("declines unknown actions or plugins without side effects", () => {
    const onSelect = vi.fn();
    const opener = createNewThreadPanelOpener([
      entry("pc-control", "pc-control", onSelect),
    ]);
    expect(
      opener({ actionId: "missing", pluginId: "pc-control" }),
    ).toBe(false);
    expect(opener({ actionId: "pc-control", pluginId: "other" })).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
