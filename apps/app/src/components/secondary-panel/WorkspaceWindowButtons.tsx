import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import { preloadThreadSecondaryPanel } from "./lazySecondaryPanelComponents";

const WORKSPACE_WINDOW_BUTTONS = [
  { label: "Terminal", icon: "Terminal", action: "terminal" },
  { label: "Browser", icon: "Globe", action: "browser" },
  { label: "Files", icon: "Folder", action: "files" },
] as const;

export interface WorkspaceWindowButtonsProps {
  browserDisabled?: boolean;
  onBrowser: () => void;
  onFiles: () => void;
  onTerminal: () => void;
  terminalDisabled?: boolean;
}

export function WorkspaceWindowButtons({
  browserDisabled = false,
  onBrowser,
  onFiles,
  onTerminal,
  terminalDisabled = false,
}: WorkspaceWindowButtonsProps) {
  const handlers = {
    terminal: onTerminal,
    browser: onBrowser,
    files: onFiles,
  };
  const disabled = {
    terminal: terminalDisabled,
    browser: browserDisabled,
    files: false,
  };
  return (
    <div className="flex items-center gap-0.5" data-workspace-windows="">
      {WORKSPACE_WINDOW_BUTTONS.map((button) => (
        <Button
          key={button.action}
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
            CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
          )}
          aria-label={button.label}
          disabled={disabled[button.action]}
          onPointerEnter={preloadThreadSecondaryPanel}
          onFocus={preloadThreadSecondaryPanel}
          onPointerDown={preloadThreadSecondaryPanel}
          onClick={handlers[button.action]}
        >
          <Icon name={button.icon} />
        </Button>
      ))}
    </div>
  );
}
