// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime, renderSlot } from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();

type ContentListener = () => void;

const contentListeners: ContentListener[] = [];

const fakeEditor = {
  getValue: vi.fn(() => "# Title\n\n- one\n- two"),
  setValue: vi.fn(),
  onDidChangeModelContent: vi.fn((listener: ContentListener) => {
    contentListeners.push(listener);
  }),
  onDidFocusEditorWidget: vi.fn(),
  addCommand: vi.fn(),
  updateOptions: vi.fn(),
  getModel: vi.fn(() => ({ dispose: vi.fn() })),
  dispose: vi.fn(),
};

vi.mock("./lib/monaco-loader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/monaco-loader.js")>();
  return {
    ...actual,
    loadMonaco: vi.fn(async () => ({
      editor: {
        create: vi.fn(() => fakeEditor),
      },
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { KeyS: 49 },
    })),
  };
});

vi.mock("./lib/monaco-theme.js", () => ({
  applyCodeTheme: () => ({ name: "test-theme", base: "test-base" }),
  editorBackground: () => "#101010",
}));

const { MonacoFileOpener } = await import("./app.js");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  contentListeners.length = 0;
});

const SOURCE = {
  kind: "workspace" as const,
  threadId: null,
  environmentId: "env_1000000000000000000000001",
  projectId: null,
};

function typeIntoEditor(text: string) {
  fakeEditor.getValue.mockReturnValue(text);
  for (const listener of contentListeners) listener();
}

function renderOpener(path: string) {
  const rpc = {
    assets: async () => ({ baseUrl: "https://assets.test", expiresAtMs: 0 }),
    read: async (input: { path: string }) => ({
      kind: "text",
      content: input.path.endsWith("b.md")
        ? "# Second File\n\nbody b"
        : "# Title\n\n- one\n- two",
      sha256: "sha-1",
      absolutePath: `C:\\repo\\${input.path}`,
      relativePath: input.path,
    }),
    tree: async () => ({ root: "C:\\repo", entries: [], truncated: false }),
    write: async () => ({ outcome: "written", sha256: "sha-2" }),
  };
  return renderSlot(
    { component: MonacoFileOpener },
    {
      path,
      source: SOURCE,
      threadId: null,
      Original: () => null,
    },
    { rpc },
  );
}

const previewButton = () => screen.getByRole("button", { name: "preview" });
const sourceButton = () => screen.getByRole("button", { name: "source" });

describe("MonacoFileOpener markdown toggle", () => {
  it("defaults to preview for markdown files", async () => {
    renderOpener("README.md");

    const markdown = await screen.findByTestId("bb-markdown");
    expect(markdown.textContent).toContain("# Title");
    expect(previewButton().getAttribute("aria-pressed")).toBe("true");
    expect(sourceButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles source and back without reading or writing the file", async () => {
    const slot = renderOpener("README.md");
    await screen.findByTestId("bb-markdown");
    const readsBefore = slot.inspection.rpcCalls.filter(
      ({ method }) => method === "read",
    ).length;

    await act(async () => {
      fireEvent.click(sourceButton());
    });
    expect(sourceButton().getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("bb-markdown")).toBeNull();

    await act(async () => {
      fireEvent.click(previewButton());
    });
    expect(screen.getByTestId("bb-markdown").textContent).toContain("# Title");

    expect(
      slot.inspection.rpcCalls.filter(({ method }) => method === "read"),
    ).toHaveLength(readsBefore);
    expect(
      slot.inspection.rpcCalls.some(({ method }) => method === "write"),
    ).toBe(false);
  });

  it("keeps unsaved draft text alive across source and preview", async () => {
    renderOpener("README.md");
    await screen.findByTestId("bb-markdown");

    await act(async () => {
      fireEvent.click(sourceButton());
    });
    await act(async () => {
      typeIntoEditor("# Draft heading\n\nedited body");
    });
    expect(screen.getByTitle("Unsaved changes")).toBeDefined();

    await act(async () => {
      fireEvent.click(previewButton());
    });
    expect(screen.getByTestId("bb-markdown").textContent).toContain(
      "# Draft heading",
    );

    await act(async () => {
      fireEvent.click(sourceButton());
    });
    await act(async () => {
      fireEvent.click(previewButton());
    });
    expect(screen.getByTestId("bb-markdown").textContent).toContain(
      "# Draft heading",
    );
  });

  it("shows no toggle and no preview for non-markdown files", async () => {
    const slot = renderOpener("src/index.ts");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("button", { name: "preview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "source" })).toBeNull();
    expect(screen.queryByTestId("bb-markdown")).toBeNull();
    expect(slot.inspection.rpcCalls.length).toBeGreaterThan(0);
  });

  it("leaves mdx files in the plain editor", async () => {
    renderOpener("doc.mdx");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("button", { name: "preview" })).toBeNull();
    expect(screen.queryByTestId("bb-markdown")).toBeNull();
  });

  it("opens a new markdown file directly in preview even after source mode with a draft", async () => {
    const slot = renderOpener("a.md");
    await screen.findByTestId("bb-markdown");

    await act(async () => {
      fireEvent.click(sourceButton());
    });
    await act(async () => {
      typeIntoEditor("# Draft in a\n\nunsaved");
    });
    expect(screen.getByTitle("Unsaved changes")).toBeDefined();

    slot.lifecycle.rerender(
      <MonacoFileOpener
        path="b.md"
        source={SOURCE}
        threadId={null}
        Original={() => null}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("bb-markdown").textContent).toContain(
        "# Second File",
      ),
    );
    expect(screen.getByTestId("bb-markdown").textContent).not.toContain(
      "Draft in a",
    );
    expect(previewButton().getAttribute("aria-pressed")).toBe("true");
    expect(sourceButton().getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTitle("Unsaved changes")).toBeNull();
  });
});
