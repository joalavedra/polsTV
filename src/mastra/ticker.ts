/**
 * The ticker's in-memory item store: images shared via Telegram that sit in slots along the
 * bottom of the viewer page, outside the broadcast picture. Pure and synchronous, clock injected
 * — same style as Channel (channel.ts).
 *
 * ponytail: in-memory only, capped at 12 items; state dies with the process, like channel.ts.
 */

export type TickerMime = "image/jpeg" | "image/png" | "image/webp";

export interface TickerItem {
  id: number;
  uid: string;
  name: string;
  caption: string | undefined;
  mime: TickerMime;
  bytes: Uint8Array;
  addedAt: number;
}

export const TICKER_MAX_ITEMS = 12;
/** 5 s on screen plus one TICKER_POLL_MS poll interval (see index.html), so every viewer sees
 * roughly the same 5 s life for a photo regardless of where their poll lands. */
export const TICKER_ITEM_TTL_MS = 6_000;
/**
 * Decoupled from TICKER_ITEM_TTL_MS: each accepted photo costs a moderation call, so the
 * cooldown can't drop to the same 5 s as the on-screen life. Still enforces "a user has one live
 * item at a time" (see add()).
 */
export const TICKER_COOLDOWN_MS = 15_000;

export interface AddTickerItemInput {
  uid: string;
  name: string;
  caption?: string | undefined;
  mime: TickerMime;
  bytes: Uint8Array;
}

export class Ticker {
  private nextId = 1;
  private items: TickerItem[] = [];
  private lastAcceptedAt = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Whole seconds until this uid may add another item; 0 when they may add now. */
  cooldownSeconds(uid: string): number {
    const last = this.lastAcceptedAt.get(uid);
    if (last === undefined) return 0;
    const left = TICKER_COOLDOWN_MS - (this.now() - last);
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /**
   * Adds a new item. A user has at most one active item at a time: a newer accepted image from
   * the same uid replaces their previous one instead of queueing alongside it. Once there are
   * more than TICKER_MAX_ITEMS the oldest drops. Callers are expected to have checked
   * cooldownSeconds() first — this method doesn't enforce it, same division as PitchSlot.
   */
  add(input: AddTickerItemInput): TickerItem {
    this.expire();
    this.items = this.items.filter((item) => item.uid !== input.uid);
    const item: TickerItem = {
      id: this.nextId++,
      addedAt: this.now(),
      uid: input.uid,
      name: input.name,
      caption: input.caption,
      mime: input.mime,
      bytes: input.bytes,
    };
    this.items.push(item);
    this.lastAcceptedAt.set(input.uid, this.now());
    if (this.items.length > TICKER_MAX_ITEMS) this.items.shift();
    return item;
  }

  list(): TickerItem[] {
    this.expire();
    return [...this.items];
  }

  get(id: number): TickerItem | undefined {
    this.expire();
    return this.items.find((item) => item.id === id);
  }

  private expire(): void {
    const cutoff = this.now() - TICKER_ITEM_TTL_MS;
    this.items = this.items.filter((item) => item.addedAt > cutoff);
  }
}

/** The one shared ticker instance for this process. index.ts and ticker-intake.ts both import it */
export const ticker = new Ticker();
