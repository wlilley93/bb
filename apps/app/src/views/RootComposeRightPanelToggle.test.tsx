// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyThreadSecondaryPanel } from "@/components/secondary-panel/lazySecondaryPanelComponents";
import { WorkspaceWindowButtons } from "@/components/secondary-panel/WorkspaceWindowButtons";

const { preloadThreadSecondaryPanel } = vi.hoisted(() => ({
  preloadThreadSecondaryPanel: vi.fn(),
}));

vi.mock(
  "@/components/secondary-panel/lazySecondaryPanelComponents",
  async (importOriginal) => ({
    ...(await importOriginal()),
    preloadThreadSecondaryPanel,
  }),
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WorkspaceWindowButtons", () => {
  it("warms the panel from a window button but not from mounting the row", async () => {
    vi.useFakeTimers();
    const preload = vi
      .spyOn(LazyThreadSecondaryPanel, "preload")
      .mockResolvedValue(undefined);
    render(
      <WorkspaceWindowButtons
        onBrowser={vi.fn()}
        onFiles={vi.fn()}
        onTerminal={vi.fn()}
      />,
    );

    await act(async () => vi.runAllTimersAsync());
    expect(preload).not.toHaveBeenCalled();
    expect(preloadThreadSecondaryPanel).not.toHaveBeenCalled();

    const button = screen.getByRole("button", { name: "Terminal" });
    fireEvent.pointerEnter(button);
    fireEvent.pointerDown(button);
    fireEvent.focus(button);

    expect(preloadThreadSecondaryPanel).toHaveBeenCalledTimes(3);
  });
});
