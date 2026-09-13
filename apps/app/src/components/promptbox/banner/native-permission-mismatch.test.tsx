// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativePermissionMismatchCard } from "./NativePermissionMismatchCard";
import {
  resolveNativePermissionMismatch,
  type NativePermissionObservation,
} from "@/hooks/queries/native-permission-mismatch";

afterEach(cleanup);

describe("resolveNativePermissionMismatch", () => {
  it.each([
    ["bypassPermissions", "full"],
    ["acceptEdits", "accept-edits"],
  ] as const)("translates %s to %s", (observedMode, nativeMode) => {
    expect(
      resolveNativePermissionMismatch({
        currentMode: "auto",
        observedMode,
        supported: true,
      }),
    ).toMatchObject({ kind: "mismatch", nativeMode });
  });

  it("does not report a matching auto mode", () => {
    expect(
      resolveNativePermissionMismatch({
        currentMode: "auto",
        observedMode: "auto",
        supported: true,
      }),
    ).toBeNull();
  });

  it("returns a mismatch for a known native mode", () => {
    expect(
      resolveNativePermissionMismatch({
        currentMode: "auto",
        observedMode: "bypassPermissions",
        supported: true,
      }),
    ).toEqual({
      kind: "mismatch",
      currentMode: "auto",
      nativeMode: "full",
      observedMode: "bypassPermissions",
    });
  });

  it("keeps unknown modes informational instead of mapping them", () => {
    expect(
      resolveNativePermissionMismatch({
        currentMode: "auto",
        observedMode: "futureMode<script>",
        supported: true,
      }),
    ).toEqual({
      kind: "unknown",
      currentMode: "auto",
      observedMode: "futureMode<script>",
    });
  });

  it("does not report missing, unsupported, or matching observations", () => {
    expect(
      resolveNativePermissionMismatch({
        currentMode: "auto",
        observedMode: null,
        supported: true,
      }),
    ).toBeNull();
    expect(
      resolveNativePermissionMismatch({
        currentMode: "auto",
        observedMode: "bypassPermissions",
        supported: false,
      }),
    ).toBeNull();
    expect(
      resolveNativePermissionMismatch({
        currentMode: "auto",
        observedMode: "auto",
        supported: true,
      }),
    ).toBeNull();
  });
});

describe("NativePermissionMismatchCard", () => {
  it.each(["dontAsk", "default", "plan"])(
    "does not broaden native %s permissions",
    (observedMode) => {
      const observation = resolveNativePermissionMismatch({
        currentMode: "full",
        observedMode,
        supported: true,
      });
      expect(observation).toEqual({
        kind: "unknown",
        currentMode: "full",
        observedMode,
      });
      if (observation === null)
        throw new Error("Expected native permission observation");
      const onApply = vi.fn();
      render(
        <NativePermissionMismatchCard
          observation={observation}
          onApply={onApply}
        />,
      );
      expect(screen.getByRole("status").textContent).toContain(observedMode);
      expect(
        screen.queryByRole("button", { name: /^Выбрать в bb:/ }),
      ).toBeNull();
      expect(onApply).not.toHaveBeenCalled();
    },
  );

  const mismatch: NativePermissionObservation = {
    kind: "mismatch",
    currentMode: "auto",
    nativeMode: "full",
    observedMode: "bypassPermissions",
  };

  it("separates the last native measurement from the bb selection and selects in bb only on click", () => {
    const onApply = vi.fn();
    render(
      <NativePermissionMismatchCard observation={mismatch} onApply={onApply} />,
    );

    const status = screen.getByRole("status").textContent;
    expect(onApply).not.toHaveBeenCalled();
    expect(status).toContain("Разрешения исходной сессии");
    expect(status).toContain("Последний замер исходной сессии: Полный доступ");
    expect(status).toContain("выбрано в bb: Авто");
    expect(status).toContain(
      "Выбор в bb действует на следующее сообщение и не изменяет исходную сессию",
    );
    expect(status).toContain(
      "Полный доступ — без обычных запросов подтверждения",
    );
    expect(status).not.toContain("Claude");
    expect(
      screen.queryByRole("button", {
        name: "Применить к следующему сообщению",
      }),
    ).toBeNull();
    const button = screen.getByRole("button", {
      name: "Выбрать в bb: Полный доступ",
    });
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith("full");
  });

  it("does not offer an action for an unknown mode and renders it as text", () => {
    render(
      <NativePermissionMismatchCard
        observation={{
          kind: "unknown",
          currentMode: "auto",
          observedMode: "futureMode<script>",
        }}
        onApply={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "futureMode<script>",
    );
    expect(
      screen.queryByRole("button", {
        name: /^Выбрать в bb:/,
      }),
    ).toBeNull();
  });

  it("keeps dismissal available and only disables the bb selection when requested", () => {
    render(
      <NativePermissionMismatchCard
        disabled
        observation={mismatch}
        onApply={vi.fn()}
      />,
    );

    expect(
      screen
        .getByRole("button", {
          name: "Выбрать в bb: Полный доступ",
        })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", {
          name: "Скрыть уведомление о разрешениях",
        })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("does not compare permissions for a session created by bb", () => {
    expect(
      resolveNativePermissionMismatch({
        currentMode: "full",
        observedMode: "acceptEdits",
        resumesNativeSession: false,
        supported: true,
      }),
    ).toBeNull();
  });

  it("dismisses the current mismatch until that thread's observation changes", () => {
    const first = render(
      <NativePermissionMismatchCard
        threadId="thread-1"
        observation={mismatch}
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Скрыть уведомление о разрешениях",
      }),
    );
    expect(screen.queryByRole("status")).toBeNull();

    first.unmount();
    const second = render(
      <NativePermissionMismatchCard
        threadId="thread-1"
        observation={mismatch}
        onApply={vi.fn()}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();

    second.rerender(
      <NativePermissionMismatchCard
        threadId="thread-1"
        observation={{ ...mismatch, currentMode: "accept-edits" }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it.each([
    ["accept-edits", "Правки без подтверждения"],
    ["full", "Полный доступ"],
  ] as const)(
    "labels the button with the measured native mode %s",
    (nativeMode, label) => {
      const observation = resolveNativePermissionMismatch({
        currentMode: "auto",
        observedMode:
          nativeMode === "full" ? "bypassPermissions" : "acceptEdits",
        supported: true,
      });
      if (observation === null || observation.kind === "unknown") {
        throw new Error("Expected native permission mismatch");
      }
      render(
        <NativePermissionMismatchCard
          observation={observation}
          onApply={vi.fn()}
        />,
      );
      expect(
        screen.getByRole("button", { name: `Выбрать в bb: ${label}` }),
      ).toBeTruthy();
    },
  );
});
