import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Persistent calendar memory store. Used by the character-reminder tooling so
// each per-event commentary can reference a real prior event rather than
// inventing one. Path lives outside the repo and outside Calendar.app's
// own storage so reverts and reseeds never touch user data we don't own.
export const DEFAULT_MEMORY_DIR = join(homedir(), ".apple-calendar-mcp");
export const DEFAULT_MEMORY_PATH = join(DEFAULT_MEMORY_DIR, "memory.json");

export interface MemoryEvent {
  uid: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  duration_hours: number;
  calendar: string;
  notes?: string;
  attended?: boolean;
  observations?: string[];
}

export interface MemoryFile {
  version: 1;
  last_updated: string; // ISO
  events: MemoryEvent[];
}

export function emptyMemory(): MemoryFile {
  return { version: 1, last_updated: new Date(0).toISOString(), events: [] };
}

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // chmod is best-effort: some filesystems (FAT, network mounts) ignore it,
  // and that's fine — we don't want a perm-set failure to block memory writes.
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
}

export function loadMemory(path: string = DEFAULT_MEMORY_PATH): MemoryFile {
  if (!existsSync(path)) {
    return emptyMemory();
  }
  try {
    const raw = readFileSync(path, "utf8");
    if (!raw.trim()) {
      return emptyMemory();
    }
    const parsed = JSON.parse(raw) as Partial<MemoryFile>;
    if (
      !parsed ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.events) ||
      typeof parsed.last_updated !== "string"
    ) {
      return emptyMemory();
    }
    return { version: 1, last_updated: parsed.last_updated, events: parsed.events };
  } catch {
    // Corrupt or unreadable memory file: treat as empty rather than crash. The
    // caller will rewrite it on the next save with a fresh atomic write.
    return emptyMemory();
  }
}

export function saveMemory(memory: MemoryFile, path: string = DEFAULT_MEMORY_PATH): void {
  ensureDir(path);
  const payload = JSON.stringify({ ...memory, version: 1 }, null, 2);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, payload, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* ignore */
  }
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

export function mergeEvents(memory: MemoryFile, newEvents: MemoryEvent[]): MemoryFile {
  const byUid = new Map<string, MemoryEvent>();
  for (const e of memory.events) {
    byUid.set(e.uid, e);
  }
  // Later writes win on UID collision. We preserve `observations` by merging
  // the union of arrays — observations are typically annotations the caller
  // does not want clobbered by a fresh seed.
  for (const incoming of newEvents) {
    const prev = byUid.get(incoming.uid);
    if (!prev) {
      byUid.set(incoming.uid, incoming);
      continue;
    }
    const observations =
      prev.observations || incoming.observations
        ? Array.from(new Set([...(prev.observations ?? []), ...(incoming.observations ?? [])]))
        : undefined;
    const merged: MemoryEvent = { ...prev, ...incoming };
    if (observations && observations.length > 0) {
      merged.observations = observations;
    }
    byUid.set(incoming.uid, merged);
  }
  return {
    version: 1,
    last_updated: new Date().toISOString(),
    events: Array.from(byUid.values()),
  };
}

function fold(s: string): string {
  return s.toLowerCase();
}

export function queryByPerson(memory: MemoryFile, personName: string): MemoryEvent[] {
  const needle = fold(personName);
  if (!needle) {
    return [];
  }
  return memory.events.filter(
    (e) => fold(e.title).includes(needle) || (e.notes ? fold(e.notes).includes(needle) : false),
  );
}

export function queryByTopic(memory: MemoryFile, keyword: string): MemoryEvent[] {
  const needle = fold(keyword);
  if (!needle) {
    return [];
  }
  return memory.events.filter((e) => fold(e.title).includes(needle));
}

export function queryByDateRange(memory: MemoryFile, start: string, end: string): MemoryEvent[] {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    return [];
  }
  return memory.events.filter((evt) => {
    const t = Date.parse(evt.start);
    return Number.isFinite(t) && t >= s && t <= e;
  });
}

export function queryByCalendar(memory: MemoryFile, calendarName: string): MemoryEvent[] {
  const needle = fold(calendarName);
  return memory.events.filter((e) => fold(e.calendar) === needle);
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "for",
  "and",
  "or",
  "with",
  "at",
  "on",
  "by",
  "is",
  "it",
  "this",
  "that",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface CurrentEventLike {
  title: string;
  calendar?: string;
  start?: string;
}

export function recentSimilarEvents(
  memory: MemoryFile,
  current: CurrentEventLike,
  limit = 5,
): MemoryEvent[] {
  const needleTokens = new Set(tokenize(current.title));
  if (needleTokens.size === 0) {
    return [];
  }
  type Scored = { evt: MemoryEvent; score: number; ts: number };
  const scored: Scored[] = [];
  const currentMs = current.start ? Date.parse(current.start) : Number.NaN;
  for (const evt of memory.events) {
    // Don't return the current event itself if memory happens to contain it.
    if (
      Number.isFinite(currentMs) &&
      Date.parse(evt.start) === currentMs &&
      evt.title === current.title
    ) {
      continue;
    }
    const evtTokens = new Set(tokenize(evt.title));
    if (evtTokens.size === 0) {
      continue;
    }
    let overlap = 0;
    for (const t of evtTokens) {
      if (needleTokens.has(t)) {
        overlap += 1;
      }
    }
    if (overlap === 0) {
      continue;
    }
    let score = overlap / Math.max(needleTokens.size, evtTokens.size);
    if (current.calendar && fold(current.calendar) === fold(evt.calendar)) {
      score += 0.25;
    }
    scored.push({ evt, score, ts: Date.parse(evt.start) || 0 });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return b.ts - a.ts;
  });
  return scored.slice(0, Math.max(limit, 0)).map((s) => s.evt);
}
