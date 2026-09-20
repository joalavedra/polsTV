import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteShot,
  loadHistoryIndex,
  readShot,
  saveHistoryIndex,
  saveShot,
} from "./history-io";

// ponytail: process.cwd() is the real resolution rule (production runs from the repo root), so
// tests point it at a scratch dir for the duration of each test. node:os tmpdir, test-only.
let originalCwd: string;
let scratch: string;

beforeEach(() => {
  originalCwd = process.cwd();
  scratch = mkdtempSync(join(tmpdir(), "polstv-history-"));
  process.chdir(scratch);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(scratch, { recursive: true, force: true });
});

describe("loadHistoryIndex", () => {
  it("starts empty when no index file exists yet", async () => {
    expect(await loadHistoryIndex()).toEqual([]);
  });

  it("starts empty and warns on a corrupt index instead of crashing", async () => {
    mkdirSync(join(scratch, "data", "history"), { recursive: true });
    writeFileSync(join(scratch, "data", "history", "index.json"), "{not json");
    await expect(loadHistoryIndex()).resolves.toEqual([]);
  });
});

describe("saveHistoryIndex", () => {
  it("writes atomically and round-trips through loadHistoryIndex", async () => {
    const entries = [{ ideaId: 1, pid: "aaa", name: "ANA", text: "a cat", airedAt: 100 }];
    await saveHistoryIndex(entries);
    expect(await loadHistoryIndex()).toEqual(entries);
    // no leftover temp file after a clean write
    const files = readdirSync(join(scratch, "data", "history"));
    expect(files.every((f) => !f.includes(".tmp-"))).toBe(true);
  });
});

describe("shots", () => {
  it("saves, reads back, then deletes a still", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    await saveShot(7, jpeg);
    const read = await readShot(7);
    expect(read).toEqual(Buffer.from(jpeg));
    await deleteShot(7);
    expect(await readShot(7)).toBeUndefined();
  });

  it("deleting an unknown shot is not an error", async () => {
    await expect(deleteShot(999)).resolves.toBeUndefined();
  });

  it("reading an unknown shot returns undefined", async () => {
    expect(await readShot(999)).toBeUndefined();
  });
});
