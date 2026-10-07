/**
 * Storage for the guestbook.
 *
 * An in-memory array, on purpose. Swapping in SQLite or Postgres is an exercise
 * for the reader and would only obscure the parts of this example that are
 * actually about Keslr.
 *
 * One detail worth copying into a real application: entries are keyed by
 * `keslrId`, not by username or email. Usernames can change; the Keslr
 * identifier cannot. If you key rows on something mutable, you inherit a
 * migration the first time a member renames themselves.
 */

export interface GuestbookEntry {
  id: number;
  keslrId: string;
  username: string;
  fullName?: string;
  message: string;
  signedAt: Date;
}

export interface CreateEntryInput {
  keslrId: string;
  username: string;
  fullName?: string;
  message: string;
}

let nextId = 1;
const entries: GuestbookEntry[] = [];

/** Prepare storage. A no-op here; the seam exists so a real store can slot in. */
export function initSchema(): void {
  entries.length = 0;
  nextId = 1;
}

/** Append an entry and return it. */
export function createEntry(input: CreateEntryInput): GuestbookEntry {
  const entry: GuestbookEntry = {
    id: nextId++,
    keslrId: input.keslrId,
    username: input.username,
    fullName: input.fullName,
    message: input.message,
    signedAt: new Date(),
  };

  entries.push(entry);
  return entry;
}

/** Most recent entries first. */
export function listEntries(limit = 50): GuestbookEntry[] {
  return [...entries].reverse().slice(0, limit);
}

/** Every entry signed by one member. */
export function listEntriesByMember(keslrId: string): GuestbookEntry[] {
  return entries.filter((entry) => entry.keslrId === keslrId);
}

/** Total entries. */
export function countEntries(): number {
  return entries.length;
}

/** Distinct members who have signed. */
export function countSigners(): number {
  return new Set(entries.map((entry) => entry.keslrId)).size;
}
