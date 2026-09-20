/**
 * Disk persistence for history.ts: stills as data/history/<ideaId>.jpg, the index as
 * data/history/index.json. Kept separate from History so that class stays pure and I/O-free.
 * Resolved from process.cwd() (production runs from the repo root); the directory is created on
 * first write, not at import time. No new dependency: node:fs/promises, node:crypto, node:path.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistoryEntry } from "./history";
import { log } from "./log";

function historyDir(): string {
  return join(process.cwd(), "data", "history");
}

function indexPath(): string {
  return join(historyDir(), "index.json");
}

function shotPath(ideaId: number): string {
  return join(historyDir(), `${ideaId}.jpg`);
}

/** Write temp + rename so a crash mid-write never leaves a half-written file behind. */
async function atomicWrite(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(historyDir(), { recursive: true });
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/**
 * Load the persisted index at boot. A missing file (first run) is silent; a corrupt one logs a
 * warning through log.ts. Either way this starts empty rather than crashing the server.
 */
export async function loadHistoryIndex(): Promise<HistoryEntry[]> {
  try {
    const raw = await readFile(indexPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("history index.json is not an array");
    return parsed as HistoryEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("history index missing or corrupt, starting empty:", error);
    }
    return [];
  }
}

export async function saveHistoryIndex(entries: HistoryEntry[]): Promise<void> {
  await atomicWrite(indexPath(), JSON.stringify(entries));
}

export async function saveShot(ideaId: number, jpeg: Uint8Array): Promise<void> {
  await atomicWrite(shotPath(ideaId), jpeg);
}

export async function readShot(ideaId: number): Promise<Buffer | undefined> {
  return await readFile(shotPath(ideaId)).catch(() => undefined);
}

/** Evicted entries delete their jpg. A missing file (never uploaded, or already gone) is fine. */
export async function deleteShot(ideaId: number): Promise<void> {
  await rm(shotPath(ideaId), { force: true });
}
