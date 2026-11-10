import { useCallback, useRef } from "react";
import { atom, useSetAtom } from "jotai";
import { buildFixedPanelTabId } from "@/lib/fixed-panel-tabs-state";

export interface WorkspaceWindowRequest {
  nonce: number;
  tabId: string;
}

export const workspaceWindowRequestAtom = atom<WorkspaceWindowRequest | null>(
  null,
);

export function terminalWorkspaceTabId(terminalId: string): string {
  return buildFixedPanelTabId({
    environmentId: null,
    kind: "terminal",
    path: terminalId,
  });
}

interface WorkspaceWindowTab {
  id: string;
  kind: string;
}

interface WorkspaceWindowOpenTab {
  (
    request: { kind: "new-tab" } | { kind: "browser"; url: string },
    options?: { keepNewTab?: boolean },
  ): { id: string } | null;
}

interface UseWorkspaceWindowActionsArgs {
  activateTab: (tabId: string) => void;
  onFilesOpened?: () => void;
  openTab: WorkspaceWindowOpenTab;
  reveal: () => void;
  startTerminal: (options?: { keepNewTab?: boolean }) => string | null;
  tabs: readonly WorkspaceWindowTab[];
}

export function useWorkspaceWindowActions({
  activateTab,
  onFilesOpened,
  openTab,
  reveal,
  startTerminal,
  tabs,
}: UseWorkspaceWindowActionsArgs): {
  openBrowser: () => void;
  openFiles: () => void;
  openTerminal: () => void;
} {
  const setRequest = useSetAtom(workspaceWindowRequestAtom);
  const nonce = useRef(0);
  const requestWindow = useCallback(
    (tabId: string) => {
      nonce.current += 1;
      setRequest({ nonce: nonce.current, tabId });
    },
    [setRequest],
  );
  const openFiles = useCallback(() => {
    const existing = tabs.find((tab) => tab.kind === "new-tab");
    if (existing !== undefined) {
      activateTab(existing.id);
      reveal();
      requestWindow(existing.id);
      return;
    }
    const tab = openTab({ kind: "new-tab" });
    reveal();
    onFilesOpened?.();
    if (tab !== null) requestWindow(tab.id);
  }, [activateTab, onFilesOpened, openTab, requestWindow, reveal, tabs]);
  const openBrowser = useCallback(() => {
    const tab = openTab({ kind: "browser", url: "" }, { keepNewTab: true });
    reveal();
    if (tab !== null) requestWindow(tab.id);
  }, [openTab, requestWindow, reveal]);
  const openTerminal = useCallback(() => {
    const terminalId = startTerminal({ keepNewTab: true });
    if (terminalId === null) return;
    reveal();
    requestWindow(terminalWorkspaceTabId(terminalId));
  }, [requestWindow, reveal, startTerminal]);
  return { openBrowser, openFiles, openTerminal };
}
