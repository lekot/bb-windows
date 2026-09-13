// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  makeHost,
  makeProviderInfo,
} from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { SidebarUsageLimitsBadge } from "./SidebarUsageLimitsBadge";

const useSystemConfigMock = vi.hoisted(() => vi.fn());
const useSystemProvidersMock = vi.hoisted(() => vi.fn());
const useSystemProviderUsageLimitsMock = vi.hoisted(() => vi.fn());
const useHostsMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: useSystemConfigMock,
  useSystemProviders: useSystemProvidersMock,
  useSystemProviderUsageLimits: useSystemProviderUsageLimitsMock,
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: useHostsMock,
  selectPrimaryHost: (
    hosts: Array<{ id: string }> | undefined,
    primaryHostId: string | null,
  ) =>
    hosts?.find((host) => host.id === primaryHostId) ??
    hosts?.[0] ??
    null,
}));

function okUsage(usedPercent: number): ProviderUsageResponse {
  const resetsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  return {
    "claude-code": {
      status: "ok",
      accountEmail: "user@example.com",
      planLabel: "Pro",
      windows: [
        { label: "Current session", usedPercent, resetsAt },
        { label: "Weekly limit", usedPercent: 10, resetsAt },
      ],
    },
  };
}

function setup(args?: {
  providers?: Array<ReturnType<typeof makeProviderInfo>>;
  usage?: ProviderUsageResponse;
  providersLoading?: boolean;
  limits?: {
    usage: ProviderUsageResponse;
    providerStates: Record<
      string,
      { isError: boolean; isLoading: boolean }
    >;
    isFetching?: boolean;
    isError?: boolean;
  };
}) {
  const refetch = vi.fn(async () => {});
  useSystemConfigMock.mockReturnValue({ data: { primaryHostId: "host_1" } });
  useHostsMock.mockReturnValue({
    data: [makeHost({ id: "host_1", name: "Office PC" })],
  });
  useSystemProvidersMock.mockReturnValue({
    data: args?.providers ?? [
      makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
    ],
    isLoading: args?.providersLoading ?? false,
    isSuccess: !(args?.providersLoading ?? false),
  });
  useSystemProviderUsageLimitsMock.mockReturnValue(
    args?.limits ?? {
      usage: args?.usage ?? okUsage(30),
      providerStates: {
        "claude-code": { isError: false, isLoading: false },
      },
      isFetching: false,
      isLoading: false,
      isError: false,
      refetch,
    },
  );
  const harness = createQueryClientTestHarness();
  const rendered = render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarUsageLimitsBadge />
      </TooltipProvider>
    </MemoryRouter>,
    { wrapper: harness.wrapper },
  );
  return { rendered, refetch };
}

beforeEach(() => {
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SidebarUsageLimitsBadge", () => {
  it("renders persistently and shows the remaining percent of the key window", async () => {
    const { rendered } = setup({ usage: okUsage(30) });
    const badge = rendered.getByTestId("sidebar-usage-limits");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("70%");
    expect(badge.textContent).not.toContain("30%");
  });

  it("keeps critical percentages optically as dense as the other readings", () => {
    const providers = [
      makeProviderInfo({ id: "acp-zcode", displayName: "ZCode" }),
    ];
    const usage: ProviderUsageResponse = {
      "acp-zcode": {
        status: "ok",
        accountEmail: null,
        planLabel: null,
        windows: [
          { label: "Current session", usedPercent: 100, resetsAt: null },
        ],
      },
    };
    const { rendered } = setup({ providers, usage });
    const critical = rendered.getByText("0%");
    expect(critical.classList.contains("font-medium")).toBe(true);
    expect(critical.classList.contains("font-semibold")).toBe(false);
    expect(critical.classList.contains("text-destructive")).toBe(true);
  });

  it("gives warning percentages enough optical weight against their color", async () => {
    const providers = [
      makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
    ];
    const usage: ProviderUsageResponse = {
      "claude-code": {
        status: "ok",
        accountEmail: null,
        planLabel: null,
        windows: [
          { label: "Current session", usedPercent: 83, resetsAt: null },
        ],
      },
    };
    setup({ providers, usage });
    fireEvent.click(screen.getByTestId("sidebar-usage-limits-trigger"));
    const warnings = await screen.findAllByText("17%");
    expect(warnings).toHaveLength(2);
    for (const warning of warnings) {
      expect(warning.classList.contains("font-medium")).toBe(true);
      expect(warning.classList.contains("font-semibold")).toBe(false);
      expect(warning.classList.contains("text-warning")).toBe(true);
    }
  });

  it("prefers the current-session window over other windows", () => {
    const usage: ProviderUsageResponse = {
      "claude-code": {
        status: "ok",
        accountEmail: null,
        planLabel: null,
        windows: [
          { label: "Weekly limit", usedPercent: 90, resetsAt: null },
          { label: "Current session", usedPercent: 25, resetsAt: null },
        ],
      },
    };
    const { rendered } = setup({ usage });
    expect(rendered.getByTestId("sidebar-usage-limits").textContent).toContain(
      "75%",
    );
  });

  it("shows the Claude Fable remainder in the compact badge", () => {
    const usage = okUsage(2);
    const claude = usage["claude-code"];
    if (claude?.status !== "ok") throw new Error("expected Claude usage");
    claude.windows.push({
      label: "Fable",
      usedPercent: 5,
      resetsAt: null,
    });
    const { rendered } = setup({ usage });
    const compact = rendered.getByTitle(
      "5 hours: 98% · Weekly: 90% · Fable: 95%",
    );
    expect(compact.textContent).toBe("98% · 90% · 95%");
  });

  it("marks each low Claude remainder red in the compact badge", () => {
    const { rendered } = setup({ usage: okUsage(92) });
    const low = rendered.getByText("8%");
    expect(low.classList.contains("font-medium")).toBe(true);
    expect(low.classList.contains("font-semibold")).toBe(false);
    expect(low.classList.contains("text-destructive")).toBe(true);
  });

  it("shows a dash instead of 0% for unavailable providers", () => {
    const usage: ProviderUsageResponse = {
      "claude-code": { status: "unauthenticated" },
    };
    const { rendered } = setup({ usage });
    const badge = rendered.getByTestId("sidebar-usage-limits");
    expect(badge.textContent).toContain("—");
    expect(badge.textContent).not.toContain("0%");
  });

  it("shows GLM and omits providers that are not installed", () => {
    const providers = [
      makeProviderInfo({ id: "acp-zcode", displayName: "ZCode" }),
      makeProviderInfo({ id: "acp-cursor", displayName: "Cursor" }),
    ];
    const usage: ProviderUsageResponse = {
      "acp-zcode": {
        status: "ok",
        accountEmail: null,
        planLabel: null,
        windows: [
          { label: "Current session", usedPercent: 35, resetsAt: null },
        ],
      },
      "acp-cursor": { status: "not_installed" },
    };
    const { rendered } = setup({ providers, usage });
    expect(rendered.getByTitle("GLM")).toBeTruthy();
    expect(rendered.getByText("65%")).toBeTruthy();
    expect(rendered.queryByTitle("Cursor")).toBeNull();
  });

  it("shows an error hint for failed providers without inventing usage", async () => {
    setup({
      usage: {},
      limits: {
        usage: {},
        providerStates: {
          "claude-code": { isError: true, isLoading: false },
        },
        isError: true,
      },
    });
    fireEvent.click(screen.getByTestId("sidebar-usage-limits-trigger"));
    expect(
      await screen.findByText(/Couldn't load Claude Code usage/u),
    ).toBeTruthy();
    expect(screen.getByTestId("sidebar-usage-limits").textContent).not.toContain(
      "0%",
    );
  });

  it("opens a popover with every window, reset times, and a refresh action", async () => {
    const { refetch } = setup({ usage: okUsage(30) });
    fireEvent.click(screen.getByTestId("sidebar-usage-limits-trigger"));
    const popover = await screen.findByTestId("sidebar-usage-limits-popover");
    expect(popover.textContent).toContain("Usage limits");
    expect(popover.textContent).toContain("Current session");
    expect(popover.textContent).toContain("Weekly limit");
    expect(popover.textContent).toContain("30% used");
    expect(popover.textContent).toMatch(/Resets in 1 hr/u);
    expect(popover.textContent).toContain("Office PC");
    fireEvent.click(screen.getByTestId("sidebar-usage-limits-refresh"));
    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
  });

  it("renders a placeholder while providers load and hides without usage providers", () => {
    setup({ providers: [], providersLoading: true });
    expect(screen.getByTestId("sidebar-usage-limits")).toBeTruthy();
    cleanup();
    setup({ providers: [], providersLoading: false });
    expect(screen.queryByTestId("sidebar-usage-limits")).toBeNull();
  });
});
