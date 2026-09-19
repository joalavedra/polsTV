import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capWords,
  MAX_AD_READ_WORDS,
  MAX_VOICE_OVER_WORDS,
  narrator,
  pitchWriter,
  spokenText,
  stripUrlLike,
  writeAdRead,
  writeVoiceOver,
} from "./showrunner";

/** A Mastra `generate()` result, trimmed to the two fields these writers read. */
function reply(text: string) {
  return { text, usage: { inputTokens: 40, outputTokens: 20 } };
}

function wordCount(line: string): number {
  return line.split(" ").filter(Boolean).length;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("spokenText", () => {
  it("strips the quotes, markdown and stage directions a model wraps a line in", () => {
    expect(spokenText('  "In a kitchen\n that time *forgot*, (warmly) one capybara stirs."  ')).toBe(
      "In a kitchen that time forgot, one capybara stirs.",
    );
  });

  it("returns an empty string for a blank answer", () => {
    expect(spokenText("   \n  ")).toBe("");
  });
});

describe("stripUrlLike", () => {
  it("removes anything a listener could type into a browser", () => {
    expect(stripUrlLike("Visit https://example.com/now or www.shop.io today")).toBe(
      "Visit or today",
    );
    expect(stripUrlLike("Ask for lemonade.shop when you get there")).toBe(
      "Ask for when you get there",
    );
  });

  it("leaves an ordinary sentence alone", () => {
    expect(stripUrlLike("One capybara stirs toward greatness.")).toBe(
      "One capybara stirs toward greatness.",
    );
  });
});

describe("capWords", () => {
  it("leaves a line inside the limit untouched", () => {
    expect(capWords("one two three", 5)).toBe("one two three");
    expect(capWords("one two three four five", 5)).toBe("one two three four five");
  });

  it("cuts at the last sentence end inside the limit", () => {
    expect(capWords("The soup is ready. Nobody came to eat it at all", 8)).toBe(
      "The soup is ready.",
    );
  });

  it("cuts at a word boundary and closes the sentence when there is no sentence end", () => {
    expect(capWords("a very long line about clowns and their many hats", 5)).toBe(
      "a very long line about.",
    );
  });

  it("does not leave dangling punctuation at the cut", () => {
    expect(capWords("one two three, four five", 3)).toBe("one two three.");
  });
});

describe("writeVoiceOver", () => {
  it("credits the viewer and caps the narrator's line at the spoken word limit", async () => {
    const long = "the capybara stirs the soup with an ancient and unhurried patience ".repeat(4);
    vi.spyOn(narrator, "generate").mockResolvedValue(reply(long) as never);
    const { line, usage } = await writeVoiceOver("Timba", "a clay capybara stirs soup");
    expect(line.startsWith("From Timba. ")).toBe(true);
    expect(wordCount(line.slice("From Timba. ".length))).toBeLessThanOrEqual(MAX_VOICE_OVER_WORDS);
    expect(usage).toEqual({ inputTokens: 40, outputTokens: 20 });
  });

  it("falls back to the plain read when the narrator fails, and charges nothing for it", async () => {
    vi.spyOn(narrator, "generate").mockRejectedValue(new Error("nebius down"));
    const { line, usage } = await writeVoiceOver("Ana", "a cat on a boat");
    expect(line).toBe("Up next, from Ana: a cat on a boat");
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("falls back to the plain read when the narrator answers with nothing", async () => {
    vi.spyOn(narrator, "generate").mockResolvedValue(reply('  ""  ') as never);
    expect((await writeVoiceOver("Ana", "a cat on a boat")).line).toBe(
      "Up next, from Ana: a cat on a boat",
    );
  });

  it("falls back to the plain read rather than hold the steer for a hung narrator", async () => {
    vi.useFakeTimers();
    vi.spyOn(narrator, "generate").mockReturnValue(new Promise(() => {}) as never);
    const pending = writeVoiceOver("Ana", "a cat on a boat");
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await pending).line).toBe("Up next, from Ana: a cat on a boat");
  });
});

describe("writeAdRead", () => {
  it("credits the viewer, caps the read and strips anything URL-like", async () => {
    const long = "buy the lemonade it is extremely cold and honestly quite good at visit shop.com "
      .repeat(3);
    vi.spyOn(pitchWriter, "generate").mockResolvedValue(reply(long) as never);
    const { line } = await writeAdRead("Timba", "sell my lemonade stand");
    expect(line.startsWith("A word from Timba. ")).toBe(true);
    expect(line).not.toMatch(/shop\.com/);
    expect(wordCount(line.slice("A word from Timba. ".length))).toBeLessThanOrEqual(
      MAX_AD_READ_WORDS,
    );
  });

  it("throws rather than send an empty ad read to the voice", async () => {
    vi.spyOn(pitchWriter, "generate").mockResolvedValue(reply("") as never);
    await expect(writeAdRead("Ana", "sell my band")).rejects.toThrow(/empty ad read/);
  });
});
