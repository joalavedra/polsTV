/**
 * Per-viewer scene history: which scenes each viewer has put on air. Pure and synchronous, clock
 * injected — same style as Channel (channel.ts) and Ticker (ticker.ts). No I/O here;
 * history-io.ts persists it to disk beside this so a restart survives.
 *
 * ponytail: stills only, one per scene (broadcaster.ts captures a JPEG, not video) — see the
 * `ponytail:` note at the capture site in public/broadcaster.html for the upgrade path.
 */

export interface HistoryEntry {
  ideaId: number;
  pid: string;
  name: string;
  text: string;
  airedAt: number;
}

/** Overall cap across every viewer. Past this, the oldest entry is evicted. */
export const HISTORY_MAX_ENTRIES = 300;
/** Per-viewer cap on what `byViewer` returns. */
export const HISTORY_PER_VIEWER = 24;

export class History {
  private entries: HistoryEntry[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Insert or replace by ideaId (an amend re-uses its scene's ideaId, so a later shot simply
   * replaces the earlier one), then keep the list newest-first and enforce the overall cap.
   * Returns the ideaIds evicted by the cap so the caller can delete their stills from disk.
   */
  record(entry: HistoryEntry): number[] {
    this.entries = this.entries.filter((existing) => existing.ideaId !== entry.ideaId);
    this.entries.push(entry);
    this.entries.sort((a, b) => b.airedAt - a.airedAt);
    const evicted: number[] = [];
    while (this.entries.length > HISTORY_MAX_ENTRIES) {
      const dropped = this.entries.pop();
      if (dropped) evicted.push(dropped.ideaId);
    }
    return evicted;
  }

  /** One viewer's scenes, newest first, capped at HISTORY_PER_VIEWER. Empty for an unknown pid. */
  byViewer(pid: string): HistoryEntry[] {
    return this.entries.filter((entry) => entry.pid === pid).slice(0, HISTORY_PER_VIEWER);
  }

  /** Every entry, newest first — for history-io.ts to persist the whole index. */
  all(): HistoryEntry[] {
    return [...this.entries];
  }

  /** Rebuild from a persisted index at boot. */
  load(entries: HistoryEntry[]): void {
    this.entries = [...entries].sort((a, b) => b.airedAt - a.airedAt);
  }
}

/** The one shared history instance for this process. index.ts loads and persists it. */
export const history = new History();
