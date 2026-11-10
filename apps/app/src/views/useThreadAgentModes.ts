import { useEffect, useState } from "react";
import type { ThreadTimelineSessionOption } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";

function selectedAgentMode(
  options: readonly ThreadTimelineSessionOption[] | null | undefined,
): string | null {
  const mode = options?.find((option) => option.id === "mode");
  if (mode === undefined || mode.type !== "select" || mode.value.length === 0) {
    return null;
  }
  return mode.value;
}

const cachedModes = new Map<string, string | null>();

async function loadThreadAgentMode(
  threadId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const cached = cachedModes.get(threadId);
  if (cached !== undefined) return cached;
  const timeline = await sdk.threads.timeline({
    threadId,
    signal,
    summaryOnly: "true",
    segmentLimit: "1",
  });
  const mode = selectedAgentMode(timeline.sessionOptions);
  cachedModes.set(threadId, mode);
  return mode;
}

export function useThreadAgentModes(
  threadIds: readonly string[],
  enabled: boolean,
): ReadonlyMap<string, string | null> {
  const key = threadIds.join("\n");
  const [modes, setModes] = useState<ReadonlyMap<string, string | null>>(
    () => new Map(),
  );

  useEffect(() => {
    if (!enabled || key.length === 0) return;
    const ids = key.split("\n");
    const controller = new AbortController();
    let cancelled = false;
    void Promise.all(
      ids.map(async (threadId) => {
        try {
          return [threadId, await loadThreadAgentMode(threadId, controller.signal)] as const;
        } catch {
          return [threadId, null] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setModes(new Map(entries));
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, key]);

  return modes;
}
