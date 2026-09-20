import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capChars,
  capWords,
  isAdIdea,
  MAX_AD_READ_CHARS,
  MAX_AD_READ_WORDS,
  normalizeForModeration,
  pitchWriter,
  spokenText,
  stripUrlLike,
  writeAdRead,
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
    const raw = '  "In a kitchen\n that time *forgot*, (warmly) one capybara stirs."  ';
    expect(spokenText(raw)).toBe("In a kitchen that time forgot, one capybara stirs.");
  });

  it("returns an empty string for a blank answer", () => {
    expect(spokenText("   \n  ")).toBe("");
  });
});

describe("normalizeForModeration", () => {
  it("folds a fullwidth homoglyph name to its plain ASCII form", () => {
    expect(normalizeForModeration("Ｅlon Musk")).toBe("Elon Musk");
  });

  it("leaves ordinary ASCII text unchanged", () => {
    const text = "a rubber duck runs a midnight laundrette";
    expect(normalizeForModeration(text)).toBe(text);
  });

  it("leaves legitimate numbers and units alone (no leetspeak folding)", () => {
    const text = "a 1980s VHS broadcast in 4K";
    expect(normalizeForModeration(text)).toBe(text);
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

  it("keeps the tagline sentence for a realistic ad, dropping trailing fluff after it", () => {
    const ad =
      "Bored yet? Croak Crunch rolls snacks by frog at midnight. " +
      "One bite stuns the pond. " +
      "Croak Crunch: snacking, ribbited. " +
      "Tell every lily pad tonight";
    expect(capWords(ad, MAX_AD_READ_WORDS)).toBe(
      "Bored yet? Croak Crunch rolls snacks by frog at midnight. " +
        "One bite stuns the pond. " +
        "Croak Crunch: snacking, ribbited.",
    );
  });
});

describe("capChars", () => {
  it("leaves a line inside the limit untouched", () => {
    expect(capChars("one two three", 20)).toBe("one two three");
  });

  it("drops trailing sentences while the body is over budget, without cutting mid-sentence", () => {
    const body = "Overwhelmed drawers everywhere. Cabinet Wrangler organizes closets by moonlight.";
    expect(capChars(body, 40)).toBe("Overwhelmed drawers everywhere.");
  });

  it("falls back to capWords's word-boundary cut when only one sentence remains", () => {
    const oneSentence = "Overwhelmed drawers vanish instantly forever guaranteed absolutely completely";
    expect(capChars(oneSentence, 30)).toBe(capWords(oneSentence, 3));
  });

  it("a 24-word, 170-character four-sentence read comes back within both limits and still ends on a complete sentence", () => {
    const read =
      "Overwhelmed yet? Cabinet Wrangler tames every messy drawers while you sleep soundly. " +
      "One use and clutter vanishes from your kitchens. " +
      "Cabinet Wrangler: drawers, wrangled.";
    expect(read.split(" ").filter(Boolean).length).toBe(24);
    expect(read.length).toBe(170);
    const capped = capChars(capWords(read, MAX_AD_READ_WORDS), MAX_AD_READ_CHARS);
    expect(capped.split(" ").filter(Boolean).length).toBeLessThanOrEqual(MAX_AD_READ_WORDS);
    expect(capped.length).toBeLessThanOrEqual(MAX_AD_READ_CHARS);
    expect(capped).toMatch(/[.!?]$/);
  });
});

describe("isAdIdea", () => {
  const positive: Array<[string, string]> = [
    ["bare 'ad'", "make an ad for my invented shoe brand"],
    ["'ads' plural", "cut together some ads for the frog shop"],
    ["'advert'", "write an advert for a lemonade stand"],
    ["'advertisement'", "an advertisement for a haunted vacuum"],
    ["'advertising'", "some advertising for a snail delivery service"],
    ["'commercial'", "a commercial for glow-in-the-dark socks"],
    ["'sponsored'", "a sponsored segment for a duck detective agency"],
    ["'promo'", "a promo for the world's slowest gym"],
    ["'tv spot'", "a tv spot for a cloud rental company"],
    ["'jingle'", "a jingle for a mattress made of moss"],
    ["mixed case", "make an AD for my shoe"],
    ["punctuation-adjacent: 'AD!'", "AD! for a robot butler"],
    ["punctuation-adjacent: comma", "an ad, please, for a mime school"],
    ["ca: anunci", "un anunci de sabates voladores"],
    ["ca: publicitat", "publicitat d'un paraigua invisible"],
    ["ca: patrocinat, accented neighbour", "un vídeo patrocinat, però és fals, adéu"],
    ["es: anuncio", "un anuncio de zapatos que ladran"],
    ["es: publicidad", "publicidad de un paraguas invisible"],
    ["es: patrocinado, accented neighbour", "un anuncio patrocinado, según él, adiós"],
  ];
  it.each(positive)("fires on %s", (_label, text) => {
    expect(isAdIdea(text)).toBe(true);
  });

  const negative: Array<[string, string]> = [
    ["empty string", ""],
    ["'add'", "please add a hat to the cat"],
    ["'bad'", "a bad idea about clowns in the rain"],
    ["'adventure'", "an adventure through a jungle of jelly"],
    ["'shadow'", "a shadow puppet show behind a curtain"],
    ["'radio'", "an old radio plays jazz in the attic"],
    ["'madrid'", "a train quietly arrives in madrid at dawn"],
    ["'adiós'", "the cat waves a paw and says adiós"],
  ];
  it.each(negative)("does not fire on %s", (_label, text) => {
    expect(isAdIdea(text)).toBe(false);
  });
});

describe("writeAdRead", () => {
  it("credits the viewer, caps the read and strips anything URL-like", async () => {
    const long = "buy the lemonade it is extremely cold and honestly quite good at visit shop.com "
      .repeat(3);
    vi.spyOn(pitchWriter, "generate").mockResolvedValue(reply(long) as never);
    const { line } = await writeAdRead("Timba", "sell my lemonade stand");
    const credit = "A word from Timba. ";
    expect(line.startsWith(credit)).toBe(true);
    expect(line).not.toMatch(/shop\.com/);
    expect(wordCount(line.slice(credit.length))).toBeLessThanOrEqual(MAX_AD_READ_WORDS);
  });

  it("throws rather than send an empty ad read to the voice", async () => {
    vi.spyOn(pitchWriter, "generate").mockResolvedValue(reply("") as never);
    await expect(writeAdRead("Ana", "sell my band")).rejects.toThrow(/empty ad read/);
  });
});
