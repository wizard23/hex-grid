import { Problem } from "./problem.js";

/**
 * Optimistic concurrency guard shared by every versioned resource: the caller
 * must send the version it last saw. If the stored record has moved on, the
 * write was based on stale data — reject with 409 and change nothing.
 */
export function assertVersion<T extends { version: number }>(
  record: T,
  seen: number,
  noun: string,
): T {
  if (record.version !== seen) {
    throw new Problem(
      409,
      "Conflict",
      `${noun} changed since you loaded it (server version ${record.version}, yours ${seen}) — reload and retry`,
    );
  }
  return record;
}
