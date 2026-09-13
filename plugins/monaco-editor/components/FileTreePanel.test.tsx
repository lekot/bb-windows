// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTreePanel } from "./FileTreePanel.js";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScroll) Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("FileTreePanel active path reveal", () => {
  it("adds, expands, and scrolls to an active Windows path missing from a truncated listing", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const view = render(
      <FileTreePanel
        activePath="src\\deep\\.v8-testedapp.json"
        background={null}
        entries={[{ path: "visible.txt", kind: "file" }]}
        error={null}
        isLoading={false}
        onClose={vi.fn()}
        onOpenFile={vi.fn()}
        root="C:\\workspace"
        truncated
      />,
    );

    await waitFor(() => {
      expect(
        view.container.querySelector('button[aria-current="true"]'),
      ).not.toBeNull();
    });

    const activeRow = view.container.querySelector(
      'button[aria-current="true"]',
    );
    expect(activeRow?.textContent).toContain(".v8-testedapp.json");
    expect(screen.getByRole("button", { name: "src" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "deep" }).getAttribute("aria-expanded")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
