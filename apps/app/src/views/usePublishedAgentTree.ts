import { useEffect, useState } from "react";
import {
  publishedTreeForAgent,
  type PublishedAgentTree,
} from "@/lib/agent-tree";

const AGENT_TREES_KEY = "boltrig.agentTrees";
const AGENT_TREES_EVENT = "boltrig-agent-trees";

function readPublishedAgentTrees(): PublishedAgentTree[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(AGENT_TREES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const head = "head" in entry ? entry.head : null;
      const seats = "seats" in entry ? entry.seats : null;
      if (typeof head !== "string" || !Array.isArray(seats)) return [];
      const seatIds = seats.filter((seat): seat is string => typeof seat === "string");
      return [{ head, seats: seatIds }];
    });
  } catch {
    return [];
  }
}

export function usePublishedAgentTree(
  agentId: string | null,
): ReadonlySet<string> | null {
  const [trees, setTrees] = useState(readPublishedAgentTrees);

  useEffect(() => {
    const refresh = () => setTrees(readPublishedAgentTrees());
    window.addEventListener(AGENT_TREES_EVENT, refresh);
    window.addEventListener("storage", refresh);
    refresh();
    return () => {
      window.removeEventListener(AGENT_TREES_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (agentId === null) return null;
  return publishedTreeForAgent(trees, agentId);
}
