import { afterEach, describe, expect, it, vi } from "vitest";
import { detailsById, filterNowish, lookupCandidates, whatsOnNow } from "./catalog";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function tvmazeShow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 44933,
    url: "https://www.tvmaze.com/shows/44933/severance",
    name: "Severance",
    genres: ["Drama"],
    premiered: "2022-02-18",
    rating: { average: 7.6 },
    image: { medium: "https://static.tvmaze.com/medium.jpg", original: "https://static.tvmaze.com/original.jpg" },
    summary: "<p>Mark Scout leads a <b>team</b> at Lumon.</p>",
    ...overrides,
  };
}

function opensearchResponse(titles: string[]): Response {
  return jsonResponse(["query", titles, titles.map(() => ""), titles.map((t) => `https://en.wikipedia.org/wiki/${t}`)]);
}

function wikiSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Alien (film)",
    description: "1979 film by Ridley Scott",
    extract: "Alien is a 1979 science fiction horror film directed by Ridley Scott.",
    thumbnail: { source: "https://upload.wikimedia.org/poster.jpg" },
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Alien_(film)" } },
    ...overrides,
  };
}

type Handler = { match: RegExp; respond: () => Response | Promise<Response> };

function routeFetch(handlers: Handler[]): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    const handler = handlers.find((h) => h.match.test(url));
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler.respond();
  });
}

describe("lookupCandidates: TVmaze (series)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a real show and strips HTML from its summary", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch([
        { match: /search\/shows/, respond: () => jsonResponse([{ score: 1, show: tvmazeShow() }]) },
      ]),
    );
    const items = await lookupCandidates([{ title: "Severance", mediaType: "tv" }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "tv:44933",
      mediaType: "tv",
      title: "Severance",
      year: 2022,
      rating: 7.6,
      posterUrl: "https://static.tvmaze.com/original.jpg",
    });
    expect(items[0]?.overview).toBe("Mark Scout leads a team at Lumon.");
    expect(items[0]?.overview).not.toMatch(/[<>]/);
  });

  it("drops a candidate TVmaze has no match for", async () => {
    vi.stubGlobal("fetch", routeFetch([{ match: /search\/shows/, respond: () => jsonResponse([]) }]));
    const items = await lookupCandidates([{ title: "Not A Real Show Xyz", mediaType: "tv" }]);
    expect(items).toEqual([]);
  });

  it("requires a poster: a matched show with no image is dropped", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: /search\/shows/,
          respond: () => jsonResponse([{ score: 1, show: tvmazeShow({ image: null }) }]),
        },
      ]),
    );
    const items = await lookupCandidates([{ title: "Severance", mediaType: "tv" }]);
    expect(items).toEqual([]);
  });

  it("drops a show whose poster is not on an expected image host", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: /search\/shows/,
          respond: () =>
            jsonResponse([
              {
                score: 1,
                show: tvmazeShow({
                  image: { medium: "https://evil.example/m.jpg", original: "https://evil.example/o.jpg" },
                }),
              },
            ]),
        },
      ]),
    );
    const items = await lookupCandidates([{ title: "Severance", mediaType: "tv" }]);
    expect(items).toEqual([]);
  });

  it("excludes a show whose genres include Adult", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: /search\/shows/,
          respond: () => jsonResponse([{ score: 1, show: tvmazeShow({ genres: ["Adult"] }) }]),
        },
      ]),
    );
    const items = await lookupCandidates([{ title: "Severance", mediaType: "tv" }]);
    expect(items).toEqual([]);
  });
});

describe("lookupCandidates: Wikipedia (films)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a real film and takes the year from the description", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch([
        { match: /opensearch/, respond: () => opensearchTitlesResponse(["Alien (film)"]) },
        { match: /page\/summary/, respond: () => jsonResponse(wikiSummary()) },
      ]),
    );
    const items = await lookupCandidates([{ title: "Alien", mediaType: "movie" }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "wiki:Alien (film)",
      mediaType: "movie",
      title: "Alien",
      year: 1979,
      posterUrl: "https://upload.wikimedia.org/poster.jpg",
      url: "https://en.wikipedia.org/wiki/Alien_(film)",
    });
    expect(items[0]?.rating).toBeUndefined();
  });

  it("rejects a non-film Wikipedia page and falls through to the next candidate title", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch([
        { match: /opensearch/, respond: () => opensearchTitlesResponse(["Ridley Scott", "Alien (film)"]) },
        {
          match: /page\/summary\/Ridley/,
          respond: () => jsonResponse(wikiSummary({ title: "Ridley Scott", description: "British filmmaker" })),
        },
        { match: /page\/summary\/Alien/, respond: () => jsonResponse(wikiSummary()) },
      ]),
    );
    const items = await lookupCandidates([{ title: "Ridley Scott alien", mediaType: "movie" }]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Alien");
  });

  it('rejects a page whose description contains "film" but isn\'t a film (found live: a festival)', async () => {
    // Regression: opensearch("Stalker film") ranked "Stalker (film festival)" ahead of the real
    // 1979 film "Stalker (film)" — its description "Human rights film festival in Russia" passed
    // a bare /film/i test. The real film page's description is tried next and accepted.
    vi.stubGlobal(
      "fetch",
      routeFetch([
        { match: /opensearch/, respond: () => opensearchTitlesResponse(["Stalker (film festival)", "Stalker (film)"]) },
        {
          match: /page\/summary\/Stalker%20\(film%20festival\)/,
          respond: () =>
            jsonResponse(wikiSummary({ title: "Stalker (film festival)", description: "Human rights film festival in Russia" })),
        },
        {
          match: /page\/summary\/Stalker%20\(film\)/,
          respond: () =>
            jsonResponse(
              wikiSummary({ title: "Stalker (film)", description: "1979 Soviet science fiction film" }),
            ),
        },
      ]),
    );
    const items = await lookupCandidates([{ title: "Stalker", mediaType: "movie" }]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Stalker");
    expect(items[0]?.year).toBe(1979);
  });

  it('rejects a film SCORE page (found live: "Her (score)" for a candidate "Her")', async () => {
    // Regression: Wikipedia's own description convention ("<year> film score by...") also starts
    // with a year and contains "film" — the leading-year fix alone isn't enough for this one.
    vi.stubGlobal(
      "fetch",
      routeFetch([
        { match: /opensearch/, respond: () => opensearchTitlesResponse(["Her (score)", "Her (film)"]) },
        {
          match: /page\/summary\/Her%20\(score\)/,
          respond: () =>
            jsonResponse(wikiSummary({ title: "Her (score)", description: "2021 film score by Arcade Fire" })),
        },
        {
          match: /page\/summary\/Her%20\(film\)/,
          respond: () =>
            jsonResponse(wikiSummary({ title: "Her (film)", description: "2013 film directed by Spike Jonze" })),
        },
      ]),
    );
    const items = await lookupCandidates([{ title: "Her", mediaType: "movie" }]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Her");
    expect(items[0]?.year).toBe(2013);
  });

  it("requires a poster: a film page with no thumbnail is dropped", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch([
        { match: /opensearch/, respond: () => opensearchTitlesResponse(["Alien (film)"]) },
        {
          match: /page\/summary/,
          respond: () => jsonResponse({ ...wikiSummary(), thumbnail: undefined }),
        },
      ]),
    );
    const items = await lookupCandidates([{ title: "Alien", mediaType: "movie" }]);
    expect(items).toEqual([]);
  });
});

function opensearchTitlesResponse(titles: string[]): Response {
  return opensearchResponse(titles);
}

describe("lookupCandidates: robustness", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops a candidate whose lookup times out, without throwing or losing the others", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("Times Out")) {
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        }
        if (/search\/shows/.test(url)) return jsonResponse([{ score: 1, show: tvmazeShow() }]);
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const items = await lookupCandidates([
      { title: "Times Out Show", mediaType: "tv" },
      { title: "Severance", mediaType: "tv" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe("Severance");
  });

  it("dedupes two candidates that resolve to the same title", async () => {
    vi.stubGlobal(
      "fetch",
      routeFetch([{ match: /search\/shows/, respond: () => jsonResponse([{ score: 1, show: tvmazeShow() }]) }]),
    );
    const items = await lookupCandidates([
      { title: "Severance", mediaType: "tv" },
      { title: "severance", mediaType: "tv" },
    ]);
    expect(items).toHaveLength(1);
  });
});

describe("filterNowish", () => {
  const entries = [
    { airtime: "20:00", show: {} as never },
    { airtime: "09:00", show: {} as never },
    { airtime: "21:15", show: {} as never },
    { airtime: "bogus", show: {} as never },
  ];

  it("keeps entries within the window and drops the rest, including unparsable airtimes", () => {
    const nowMinutes = 20 * 60; // 20:00
    const kept = filterNowish(entries, nowMinutes, 90);
    expect(kept.map((e) => e.airtime)).toEqual(["20:00", "21:15"]);
  });
});

describe("whatsOnNow", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalises today's schedule filtered to entries near now", async () => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    // 300 minutes away is always well outside the 90-minute window, in either direction, with no
    // midnight-wraparound risk (filterNowish compares plain minute-of-day, not circular distance).
    const farMinutes = nowMinutes >= 300 ? nowMinutes - 300 : nowMinutes + 300;
    const toHhMm = (mins: number) =>
      `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: /schedule/,
          respond: () =>
            jsonResponse([
              { airtime: toHhMm(nowMinutes), show: tvmazeShow() },
              { airtime: toHhMm(farMinutes), show: tvmazeShow({ id: 1, name: "Overnight Filler" }) },
            ]),
        },
      ]),
    );
    const items = await whatsOnNow("GB");
    expect(items.map((i) => i.title)).toEqual(["Severance"]);
  });
});

describe("detailsById", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves a tv: id directly by TVmaze show id", async () => {
    vi.stubGlobal("fetch", routeFetch([{ match: /shows\/44933$/, respond: () => jsonResponse(tvmazeShow()) }]));
    const item = await detailsById("tv:44933", "tv");
    expect(item?.title).toBe("Severance");
  });

  it("resolves a wiki: id directly by page title", async () => {
    vi.stubGlobal("fetch", routeFetch([{ match: /page\/summary/, respond: () => jsonResponse(wikiSummary()) }]));
    const item = await detailsById("wiki:Alien (film)", "movie");
    expect(item?.title).toBe("Alien");
  });

  it("returns undefined rather than throwing when the source is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 500 })),
    );
    await expect(detailsById("tv:1", "tv")).resolves.toBeUndefined();
  });

  it("returns undefined for a mismatched id/mediaType pair", async () => {
    await expect(detailsById("tv:1", "movie")).resolves.toBeUndefined();
  });
});
