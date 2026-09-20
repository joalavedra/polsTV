/**
 * The on-screen AD banner's state: which ad read is airing and until when. Pure and synchronous,
 * clock injected — same style as `PitchSlot` (pitch.ts) and `Ticker` (ticker.ts).
 */

export interface AdBanner {
  line: string;
  endsAt: number;
}

export class AdBannerSlot {
  private banner: AdBanner | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * A clip just started playing: show its line until the clip ends, replacing any banner already
   * up. `ms` is the clip's real duration; half a second of grace is added so the slate never
   * vanishes before the last word.
   */
  start(line: string, ms: number): void {
    this.banner = { line, endsAt: this.now() + ms + 500 };
  }

  /** The banner while it's live; null once its clip (plus grace) has finished. */
  current(): AdBanner | null {
    if (!this.banner || this.now() >= this.banner.endsAt) return null;
    return this.banner;
  }
}

/** The one shared ad-banner instance for this process. index.ts reads and writes it. */
export const adBanner = new AdBannerSlot();
