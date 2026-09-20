import { describe, expect, it } from "vitest";
import { AD_BANNER_MS, AdBannerSlot } from "./ad-banner";

function setup() {
  let clock = 1_000_000;
  const banner = new AdBannerSlot(() => clock);
  const tick = (ms: number) => {
    clock += ms;
  };
  return { banner, tick };
}

describe("AdBannerSlot", () => {
  it("has nothing before start()", () => {
    const { banner } = setup();
    expect(banner.current()).toBeNull();
  });

  it("carries the line while it's live", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana. Try it.");
    tick(AD_BANNER_MS - 1);
    expect(banner.current()).toEqual({
      line: "A word from Ana. Try it.",
      endsAt: 1_000_000 + AD_BANNER_MS,
    });
  });

  it("is gone exactly at the boundary", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana.");
    tick(AD_BANNER_MS);
    expect(banner.current()).toBeNull();
  });

  it("is gone after the boundary", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana.");
    tick(AD_BANNER_MS + 5_000);
    expect(banner.current()).toBeNull();
  });

  it("a second start() replaces the first", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana.");
    tick(2_000);
    banner.start("A word from Bo.");
    expect(banner.current()).toEqual({ line: "A word from Bo.", endsAt: 1_002_000 + AD_BANNER_MS });
  });
});
