import { and, eq, inArray } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { seatPrimaries, threads } from "../schema.js";
import { LOCAL_SEAT_PERSON_KEY } from "@bb/domain";

export class SeatPrimaryError extends Error {
  readonly reason: "missing" | "other-seat" | "subagent";

  constructor(reason: "missing" | "other-seat" | "subagent") {
    super(reason);
    this.name = "SeatPrimaryError";
    this.reason = reason;
  }
}

export interface SeatPrimaryRow {
  threadId: string | null;
  previousThreadId: string | null;
}

export function listSeatPrimaries(
  db: DbConnection,
  projectIds: readonly string[],
): Map<string, SeatPrimaryRow> {
  const primaries = new Map<string, SeatPrimaryRow>();
  if (projectIds.length === 0) return primaries;
  const rows = db
    .select()
    .from(seatPrimaries)
    .where(and(
      eq(seatPrimaries.personKey, LOCAL_SEAT_PERSON_KEY),
      inArray(seatPrimaries.projectId, [...projectIds]),
    ))
    .all();
  for (const row of rows) {
    primaries.set(row.projectId, {
      threadId: row.threadId,
      previousThreadId: row.previousThreadId,
    });
  }
  return primaries;
}

export function setSeatPrimary(
  db: DbConnection,
  projectId: string,
  threadId: string | null,
): void {
  if (threadId !== null) {
    const thread = db
      .select({
        projectId: threads.projectId,
        parentThreadId: threads.parentThreadId,
        deletedAt: threads.deletedAt,
      })
      .from(threads)
      .where(eq(threads.id, threadId))
      .get();
    if (!thread || thread.deletedAt !== null) throw new SeatPrimaryError("missing");
    if (thread.projectId !== projectId) throw new SeatPrimaryError("other-seat");
    if (thread.parentThreadId !== null) throw new SeatPrimaryError("subagent");
  }
  const current = db
    .select()
    .from(seatPrimaries)
    .where(and(
      eq(seatPrimaries.projectId, projectId),
      eq(seatPrimaries.personKey, LOCAL_SEAT_PERSON_KEY),
    ))
    .get();
  if ((current?.threadId ?? null) === threadId) return;
  db
    .insert(seatPrimaries)
    .values({
      projectId,
      personKey: LOCAL_SEAT_PERSON_KEY,
      threadId,
      previousThreadId: current?.threadId ?? null,
    })
    .onConflictDoUpdate({
      target: [seatPrimaries.projectId, seatPrimaries.personKey],
      set: {
        threadId,
        previousThreadId: current?.threadId ?? null,
      },
    })
    .run();
}
