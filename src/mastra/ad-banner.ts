/**
 * The on-screen AD banner's state: which ad read is airing and until when. Pure and synchronous,
 * clock injected — same style as `PitchSlot` (pitch.ts) and `Ticker` (ticker.ts).
 */

export const AD_BANNER_MS = 10_000;

export interface AdBanner {
  line: string;
  endsAt: number;
}

export class AdBannerSlot {
  private banner: AdBanner | undefined;

  constructor(private readonly now: () => number = Date.now) {}

  /** A clip just started playing: show its line for AD_BANNER_MS, replacing any banner already up. */
  start(line: string): void {
    this.banner = { line, endsAt: this.now() + AD_BANNER_MS };
  }

  /** The banner while it's live; null once AD_BANNER_MS has passed since start(). */
  current(): AdBanner | null {
    if (!this.banner || this.now() >= this.banner.endsAt) return null;
    return this.banner;
  }
}

/** The one shared ad-banner instance for this process. index.ts reads and writes it. */
export const adBanner = new AdBannerSlot();
