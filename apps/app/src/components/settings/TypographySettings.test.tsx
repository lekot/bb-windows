// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TypographySettingsControl } from "./TypographySettings";

afterEach(cleanup);

function setup(props?: {
  disabled?: boolean;
  typographyProfile?: "standard" | "compact" | "readable" | "editorial" | "techno";
  fontScalePercent?: number;
}) {
  const onTypographyChange = vi.fn();
  render(
    <TypographySettingsControl
      disabled={props?.disabled ?? false}
      typographyProfile={props?.typographyProfile ?? "standard"}
      fontScalePercent={props?.fontScalePercent ?? 100}
      onTypographyChange={onTypographyChange}
    />,
  );
  return { onTypographyChange };
}

function openProfileMenu(): void {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Typography" }), {
    button: 0,
  });
}

describe("TypographySettingsControl", () => {
  it("lists every profile with its localized label and hint", () => {
    setup();

    openProfileMenu();

    for (const label of [
      "Стандарт",
      "Компакт",
      "Читаемый",
      "Редакционный",
      "Техно",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Inter · system mono")).not.toBeNull();
  });

  it("reports the current selection on the trigger", () => {
    setup({ typographyProfile: "editorial", fontScalePercent: 105 });

    expect(
      screen.getByRole("button", { name: "Typography" }).textContent,
    ).toContain("Редакционный");
    expect(screen.getByText("105%")).not.toBeNull();
  });

  it("commits a profile choice with the current scale", () => {
    const { onTypographyChange } = setup({ fontScalePercent: 95 });

    openProfileMenu();
    fireEvent.click(screen.getByText("Компакт"));

    expect(onTypographyChange).toHaveBeenCalledWith({
      typographyProfile: "compact",
      fontScalePercent: 95,
    });
  });

  it("steps the scale in 5% increments", () => {
    const { onTypographyChange } = setup({ fontScalePercent: 100 });

    fireEvent.click(screen.getByRole("button", { name: "Increase text size" }));
    expect(onTypographyChange).toHaveBeenLastCalledWith({
      typographyProfile: "standard",
      fontScalePercent: 105,
    });
    fireEvent.click(screen.getByRole("button", { name: "Decrease text size" }));
    expect(onTypographyChange).toHaveBeenLastCalledWith({
      typographyProfile: "standard",
      fontScalePercent: 95,
    });
  });

  it("disables the scale stepper at the documented bounds", () => {
    setup({ fontScalePercent: 110 });
    expect(
      (screen.getByRole("button", { name: "Increase text size" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Decrease text size" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("disables every control while an appearance update is pending", () => {
    setup({ disabled: true });

    expect(
      (screen.getByRole("button", { name: "Typography" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Decrease text size" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Increase text size" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
