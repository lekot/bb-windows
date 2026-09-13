// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadContextWindowUsage } from "@bb/server-contract";
import {
  ThreadContextWindowCard,
  ThreadContextWindowIndicator,
} from "./ThreadContextWindowIndicator";

afterEach(cleanup);

const idleCompactState = {
  inFlight: false,
  error: null as string | null,
  disabledReason: null as string | null,
};

function renderWithCompact(
  onRequestCompact: () => void,
  compactState = idleCompactState,
) {
  return render(
    <ThreadContextWindowIndicator
      usage={{
        usedTokens: 40000,
        modelContextWindow: 100000,
        estimated: false,
      }}
      onRequestCompact={onRequestCompact}
      compactState={compactState}
    />,
  );
}

describe("context window compact action", () => {
  it("runs compact on click when the thread is idle", async () => {
    const onRequestCompact = vi.fn();
    renderWithCompact(onRequestCompact);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Сжать контекст/ }));
    });
    expect(onRequestCompact).toHaveBeenCalledTimes(1);
  });

  it("blocks clicks while a compact request is in flight", async () => {
    const onRequestCompact = vi.fn();
    renderWithCompact(onRequestCompact, {
      inFlight: true,
      error: null,
      disabledReason: null,
    });

    const button = screen.getByRole("button", { name: /Сжимаю контекст/ });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(onRequestCompact).not.toHaveBeenCalled();
  });

  it("disables the click with a reason while the thread is busy", async () => {
    const onRequestCompact = vi.fn();
    renderWithCompact(onRequestCompact, {
      inFlight: false,
      error: null,
      disabledReason: "доступно, когда поток свободен",
    });

    const button = screen.getByRole("button", {
      name: /доступно, когда поток свободен/,
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      fireEvent.click(button);
    });
    expect(onRequestCompact).not.toHaveBeenCalled();
  });

  it("renders a single ring button without a separate details button", () => {
    renderWithCompact(vi.fn());
    expect(
      screen.queryByRole("button", { name: "Подробности контекста" }),
    ).toBeNull();
    const ring = screen.getByRole("button", { name: /Сжать контекст/ });
    expect(ring).toBeDefined();
  });

  it("opens usage details on keyboard focus without compact", async () => {
    const onRequestCompact = vi.fn();
    renderWithCompact(onRequestCompact);
    const ring = screen.getByRole("button", { name: /Сжать контекст/ });
    const matches = ring.matches.bind(ring);
    vi.spyOn(ring, "matches").mockImplementation((selector) =>
      selector === ":focus-visible" ? true : matches(selector),
    );

    await act(async () => {
      fireEvent.focus(ring);
    });
    expect(await screen.findByText("Context window")).toBeTruthy();
    expect(onRequestCompact).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(ring, { key: "Escape" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRequestCompact).not.toHaveBeenCalled();
  });

  it("opens usage details via long press and suppresses the compact click", async () => {
    vi.useFakeTimers();
    try {
      const onRequestCompact = vi.fn();
      renderWithCompact(onRequestCompact);
      const ring = screen.getByRole("button", { name: /Сжать контекст/ });

      act(() => {
        fireEvent.pointerDown(ring, { button: 0, clientX: 10, clientY: 10 });
      });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.getByText("Context window")).toBeTruthy();

      await act(async () => {
        fireEvent.click(ring);
      });
      expect(onRequestCompact).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels long press on movement and keeps the tap as compact", async () => {
    vi.useFakeTimers();
    try {
      const onRequestCompact = vi.fn();
      renderWithCompact(onRequestCompact);
      const ring = screen.getByRole("button", { name: /Сжать контекст/ });

      act(() => {
        fireEvent.pointerDown(ring, { button: 0, clientX: 10, clientY: 10 });
      });
      act(() => {
        fireEvent.pointerMove(ring, { clientX: 40, clientY: 12 });
        vi.advanceTimersByTime(600);
      });
      expect(screen.queryByText("Context window")).toBeNull();

      await act(async () => {
        fireEvent.pointerUp(ring);
        fireEvent.click(ring);
      });
      expect(onRequestCompact).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the server error message next to the ring", () => {
    renderWithCompact(vi.fn(), {
      inFlight: false,
      error: 'Provider "acp-zcode" does not support manual context compaction',
      disabledReason: null,
    });

    expect(screen.getByRole("alert").textContent).toContain(
      "does not support manual context compaction",
    );
  });
});

describe("context window labels", () => {
  it.each([true, false])(
    "marks only estimated usage as approximate (%s)",
    (estimated) => {
      render(
        <ThreadContextWindowIndicator
          usage={{ usedTokens: 510000, modelContextWindow: 1000000, estimated }}
        />,
      );
      const label = `Занято ${estimated ? "~" : ""}51% окна`;
      expect(
        screen.getByRole("button", { name: label }).getAttribute("title"),
      ).toBe(label);
    },
  );

  it.each([
    ["bb", "замер bb"],
    ["14:24", "замер 14:24"],
  ])(
    "shows the measurement source next to the ring without hovering (%s)",
    (sourceLabel, expected) => {
      render(
        <ThreadContextWindowIndicator
          usage={{
            usedTokens: 510000,
            modelContextWindow: 1000000,
            estimated: true,
          }}
          sourceLabel={sourceLabel}
        />,
      );
      expect(screen.getByText(expected)).toBeTruthy();
    },
  );

  it("hides the measurement source when it is unknown", () => {
    render(
      <ThreadContextWindowIndicator
        usage={{
          usedTokens: 510000,
          modelContextWindow: 1000000,
          estimated: true,
        }}
      />,
    );
    expect(screen.queryByText(/замер/)).toBeNull();
  });

  it("keeps a neutral context ring when the window size is unknown", () => {
    render(
      <ThreadContextWindowIndicator
        usage={null}
        note="Размер окна не подтверждён; процент не рассчитан."
        tokenLabel="Контекст: 62 497 ток."
        sourceLabel="13:18"
      />,
    );

    const indicator = screen.getByRole("button", {
      name: "Размер окна контекста не подтверждён",
    });
    expect(indicator.getAttribute("title")).toBe(
      "Размер окна контекста не подтверждён",
    );
    expect(screen.getByText("замер 13:18")).toBeTruthy();
  });
});

it("shows details when a snapshot arrives and removes them when only aggregate usage remains", () => {
  const usage: ThreadContextWindowUsage = {
    usedTokens: 1000,
    modelContextWindow: 10000,
    estimated: true,
    snapshot: {
      capturedAt: "2026-09-11T00:00:00.000Z",
      providerSessionId: "session",
      providerTurnId: null,
      model: "model",
      usedTokens: 1000,
      contextWindowTokens: 10000,
      autoCompactAtTokens: null,
      estimated: true,
      categories: [
        {
          id: "messages",
          label: "Messages",
          kind: "used",
          tokens: 1000,
          entries: [],
        },
      ],
    },
  };
  const aggregateUsage = {
    usedTokens: usage.usedTokens,
    modelContextWindow: usage.modelContextWindow,
    estimated: usage.estimated,
  };
  const { rerender } = render(
    <ThreadContextWindowCard usage={aggregateUsage} />,
  );
  expect(screen.getByText("10% used")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show details" })).toBeNull();
  rerender(<ThreadContextWindowCard usage={usage} />);
  fireEvent.click(screen.getByRole("button", { name: "Show details" }));
  expect(screen.getByText("Messages")).toBeTruthy();
  rerender(<ThreadContextWindowCard usage={aggregateUsage} />);
  expect(screen.queryByText("Messages")).toBeNull();
  expect(screen.queryByRole("button", { name: "Hide details" })).toBeNull();
  expect(screen.getByText("10% used")).toBeTruthy();
});
