// @vitest-environment jsdom

import type { ExperimentalComposerEditor } from "@get-bb/plugin-sdk";
import { act, cleanup, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ComposerRoot,
  ComposerRootHostContext,
  type ComposerRootHost,
} from "./composer-root";

const state: ExperimentalComposerEditor["state"] = {
  layout: "expanded",
  isRunning: false,
  isSubmitting: false,
  isSubmittingBlocked: true,
  submittingBlockedReason: "Type a message first.",
  isAttaching: false,
  attachmentError: null,
};

function editorFor(next: ExperimentalComposerEditor["state"]) {
  return {
    state: next,
    focus: () => {},
    focusEnd: () => {},
    acceptsThreadDrop: () => false,
    insertDroppedThreads: () => {},
    insertAtCursor: () => true,
    openPopup: () => false,
    closePopup: () => false,
    isPopupOpen: () => false,
    voice: null,
  } as unknown as ExperimentalComposerEditor;
}

function HostWithRerenderOnRegister({
  onRegister,
}: {
  onRegister: () => void;
}) {
  const [, setTick] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const host: ComposerRootHost = {
    key: "composer-a",
    registerEditor: () => {
      onRegister();
      queueMicrotask(() => setTick((tick) => tick + 1));
      return () => {};
    },
    attachEditor: () => () => {},
    onFocusCommand: undefined,
    reportMenuLayout: null,
    runsPluginCommands: false,
    isFocusedPane: true,
  };
  return (
    <ComposerRootHostContext.Provider value={host}>
      <div ref={rootRef}>
        <ComposerRoot rootRef={rootRef} editor={editorFor(state)} />
      </div>
    </ComposerRootHostContext.Provider>
  );
}

afterEach(cleanup);

describe("ComposerRoot editor registration", () => {
  it("does not republish the editor when only the host re-renders", async () => {
    let calls = 0;
    render(<HostWithRerenderOnRegister onRegister={() => (calls += 1)} />);
    for (let index = 0; index < 10; index += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(calls).toBe(1);
  });
});
