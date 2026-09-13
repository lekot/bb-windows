// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { SystemConfigResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { useTypographySelection } from "./useTypographySelection";

const mocks = vi.hoisted(() => ({
  applyTypography: vi.fn(),
  config: undefined as SystemConfigResponse | undefined,
  mutate: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: mocks.config }),
}));

vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateAppearance: () => ({ isPending: false, mutate: mocks.mutate }),
}));

vi.mock("@/lib/typography", () => ({
  applyTypography: mocks.applyTypography,
}));

afterEach(() => {
  cleanup();
  mocks.config = undefined;
  vi.clearAllMocks();
});

describe("useTypographySelection", () => {
  it("applies text scale immediately and persists it when config finishes loading", async () => {
    const { result, rerender } = renderHook(() => useTypographySelection());
    const next = {
      typographyProfile: "readable" as const,
      fontScalePercent: 110 as const,
    };

    act(() => result.current.setTypography(next));

    expect(mocks.applyTypography).toHaveBeenCalledWith({
      profile: "readable",
      scalePercent: 110,
    });
    expect(mocks.mutate).not.toHaveBeenCalled();

    mocks.config = makeSystemConfig();
    rerender();

    await waitFor(() => {
      expect(mocks.mutate).toHaveBeenCalledWith({
        themeId: mocks.config?.appearance.themeId,
        faviconColor: mocks.config?.appearance.faviconColor,
        ...next,
      });
    });
  });

  it("keeps an unsaved selection across a route unmount", async () => {
    const firstScreen = renderHook(() => useTypographySelection());
    const next = {
      typographyProfile: "compact" as const,
      fontScalePercent: 90 as const,
    };

    act(() => firstScreen.result.current.setTypography(next));
    firstScreen.unmount();

    mocks.config = makeSystemConfig();
    renderHook(() => useTypographySelection());

    await waitFor(() => {
      expect(mocks.mutate).toHaveBeenCalledWith({
        themeId: mocks.config?.appearance.themeId,
        faviconColor: mocks.config?.appearance.faviconColor,
        ...next,
      });
    });
  });
});
