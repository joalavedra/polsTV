import { describe, expect, it } from "vitest";
import { AdBannerSlot } from "./ad-banner";

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

  it("carries the line for the clip's own duration, plus 500ms grace", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana. Try it.", 4_000);
    tick(4_000 + 500 - 1);
    expect(banner.current()).toEqual({
      line: "A word from Ana. Try it.",
      endsAt: 1_000_000 + 4_000 + 500,
    });
  });

  it("honours a longer clip's duration", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana.", 30_000);
    tick(20_000);
    expect(banner.current()).not.toBeNull();
  });

  it("is gone exactly at the boundary", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana.", 4_000);
    tick(4_000 + 500);
    expect(banner.current()).toBeNull();
  });

  it("is gone after the boundary", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana.", 4_000);
    tick(4_000 + 500 + 5_000);
    expect(banner.current()).toBeNull();
  });

  it("a second start() replaces the first", () => {
    const { banner, tick } = setup();
    banner.start("A word from Ana.", 4_000);
    tick(2_000);
    banner.start("A word from Bo.", 6_000);
    expect(banner.current()).toEqual({
      line: "A word from Bo.",
      endsAt: 1_002_000 + 6_000 + 500,
    });
  });
});
