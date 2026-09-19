/**
 * Catalog: two keyless public sources, no API key or configuration gate.
 *
 * - TVmaze (series + live TV): https://api.tvmaze.com — CC BY-SA, attribute "TV data from TVmaze".
 * - Wikipedia's REST API (films): a descriptive User-Agent is required or Wikimedia 403s. Attribute
 *   "Film summaries from Wikipedia".
 *
 * Both are title-lookup APIs, not discover-by-mood APIs, so the shape here is: the LLM (recs.ts,
 * concierge.ts) PROPOSES candidate titles, and `lookupCandidates` VERIFIES each one against the
 * real source before it ever reaches a viewer — that verification step is what stops an invented
 * title from being recommended.
 */

export const CATALOG_ATTRIBUTION = {
  tv: "TV data from TVmaze",
  film: "Film summaries from Wikipedia",
};

const TIMEOUT_MS = 5_000;
const MAX_OVERVIEW_CHARS = 200;
const WIKI_USER_AGENT = "polsTV/1.0 (https://github.com/joalavedra/polsTV)";

export type MediaType = "movie" | "tv";

export interface CatalogItem {
  id: string;
  mediaType: MediaType;
  title: string;
  year?: number;
  overview: string;
  /** TVmaze only — Wikipedia has no rating source, so a film's rating is always absent. */
  rating?: number;
  posterUrl: string;
  backdropUrl?: string;
  url: string;
}

export interface CandidateTitle {
  title: string;
  year?: number;
  mediaType: MediaType;
}

// --- shared -----------------------------------------------------------------------------------

async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`${url} failed with ${response.status}: ${body}`);
  }
  return response.json();
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clipOverview(text: string): string {
  return text.slice(0, MAX_OVERVIEW_CHARS);
}

function dedupe(items: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

// --- TVmaze: series + live TV -------------------------------------------------------------------

interface TvmazeShow {
  id: number;
  url: string;
  name: string;
  genres: string[];
  premiered: string | null;
  rating: { average: number | null };
  image: { medium: string; original: string } | null;
  summary: string | null;
}
interface TvmazeSearchResult {
  score: number;
  show: TvmazeShow;
}
interface TvmazeScheduleEntry {
  airtime: string;
  show: TvmazeShow;
}

/** Poster required, adult genre excluded — same two rules the original brief asked TMDB for. */
function normaliseShow(show: TvmazeShow): CatalogItem | undefined {
  if (!show.image?.original) return undefined;
  if (show.genres.some((g) => g.toLowerCase() === "adult")) return undefined;
  const year = show.premiered ? Number(show.premiered.slice(0, 4)) : undefined;
  return {
    id: `tv:${show.id}`,
    mediaType: "tv",
    title: show.name,
    ...(year !== undefined && !Number.isNaN(year) ? { year } : {}),
    overview: clipOverview(show.summary ? stripHtml(show.summary) : ""),
    ...(show.rating.average !== null ? { rating: show.rating.average } : {}),
    posterUrl: show.image.original,
    backdropUrl: show.image.original,
    url: show.url,
  };
}

async function searchShows(query: string): Promise<TvmazeSearchResult[]> {
  const url = `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`;
  return (await getJson(url)) as TvmazeSearchResult[];
}

/** Exact name match wins; else the same premiere year as the LLM guessed; else TVmaze's top hit. */
function bestShowMatch(
  results: TvmazeSearchResult[],
  title: string,
  year: number | undefined,
): TvmazeShow | undefined {
  const exact = results.find((r) => r.show.name.toLowerCase() === title.toLowerCase());
  if (exact) return exact.show;
  if (year !== undefined) {
    const sameYear = results.find((r) => r.show.premiered?.startsWith(String(year)));
    if (sameYear) return sameYear.show;
  }
  return results[0]?.show;
}

async function resolveShowCandidate(title: string, year: number | undefined): Promise<CatalogItem | undefined> {
  const results = await searchShows(title);
  const safe = results.filter((r) => !r.show.genres.some((g) => g.toLowerCase() === "adult"));
  const show = bestShowMatch(safe, title, year);
  return show ? normaliseShow(show) : undefined;
}

const DEFAULT_SCHEDULE_COUNTRY = "GB";
// ponytail: a fixed +/- window around wall-clock time, not real per-viewer timezone/EPG smarts.
const NOW_WINDOW_MINUTES = 90;
const NOW_RESULTS_LIMIT = 12;

function minutesSinceMidnight(hhmm: string): number | undefined {
  const match = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!match?.[1] || !match[2]) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Pure filter, `nowMinutes` injected so it is testable without a real clock. */
export function filterNowish(
  entries: TvmazeScheduleEntry[],
  nowMinutes: number,
  windowMinutes = NOW_WINDOW_MINUTES,
): TvmazeScheduleEntry[] {
  return entries.filter((entry) => {
    const at = minutesSinceMidnight(entry.airtime);
    return at !== undefined && Math.abs(at - nowMinutes) <= windowMinutes;
  });
}

/**
 * Real broadcast listings around the current time — the "or live TV" half of the brief. `country`
 * is a TVmaze schedule country code; GB and US are populated, ES returned nothing on a live check.
 */
export async function whatsOnNow(country: string = DEFAULT_SCHEDULE_COUNTRY): Promise<CatalogItem[]> {
  const url = `https://api.tvmaze.com/schedule?country=${encodeURIComponent(country)}`;
  const schedule = (await getJson(url)) as TvmazeScheduleEntry[];
  const now = new Date();
  const soon = filterNowish(schedule, now.getHours() * 60 + now.getMinutes());
  const items = soon.map((entry) => normaliseShow(entry.show)).filter((i): i is CatalogItem => i !== undefined);
  return dedupe(items).slice(0, NOW_RESULTS_LIMIT);
}

// --- Wikipedia: films ---------------------------------------------------------------------------

interface WikiSummary {
  title: string;
  description?: string;
  extract: string;
  thumbnail?: { source: string };
  content_urls?: { desktop?: { page?: string } };
}

async function opensearchTitles(query: string): Promise<string[]> {
  const url =
    "https://en.wikipedia.org/w/api.php?action=opensearch&search=" +
    `${encodeURIComponent(query)}&limit=3&format=json`;
  const [, titles] = (await getJson(url, { "User-Agent": WIKI_USER_AGENT })) as [string, string[]];
  return titles;
}

async function pageSummary(title: string): Promise<WikiSummary | undefined> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    return (await getJson(url, { "User-Agent": WIKI_USER_AGENT })) as WikiSummary;
  } catch {
    return undefined; // a redirect/disambiguation/missing page is a miss, not a fatal error
  }
}

/** "Alien (film)" -> "Alien". Only strips a disambiguator that actually says "film". */
function cleanFilmTitle(raw: string): string {
  const match = raw.match(/^(.+?)\s*\([^)]*film[^)]*\)$/i);
  return match?.[1] ?? raw;
}

function yearFromDescription(description: string): number | undefined {
  const match = description.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}

// Wikipedia's short-description convention for an actual film page is "<year> <adjectives> film",
// e.g. "1979 film by Ridley Scott" or "2018 science-fiction cosmic horror film directed by...".
// A bare /\bfilm\b/i test also matches non-film pages that happen to mention one: "Human rights
// film festival in Russia" (verified live: "Stalker (film festival)" outranked the real film in
// opensearch) and "2021 film score by Arcade Fire..." (a soundtrack album page, "Her (score)").
// ponytail: a heuristic on the word right after "film", not a real classifier — extend the
// blocklist if another non-film category turns up outranking a real film in opensearch.
const NOT_A_FILM_AFTER = "score|soundtrack|festival|critic|award|series|studio|database|magazine";
const FILM_DESCRIPTION_RE = new RegExp(`^(19|20)\\d{2}\\b.*\\bfilms?\\b(?!\\s+(${NOT_A_FILM_AFTER}))`, "i");

/** Accepted only when Wikipedia's own description says this page is a film, and it has a poster. */
function normaliseFilmSummary(summary: WikiSummary): CatalogItem | undefined {
  if (!summary.description || !FILM_DESCRIPTION_RE.test(summary.description)) return undefined;
  if (!summary.thumbnail?.source) return undefined;
  const year = yearFromDescription(summary.description);
  return {
    id: `wiki:${summary.title}`,
    mediaType: "movie",
    title: cleanFilmTitle(summary.title),
    ...(year !== undefined ? { year } : {}),
    overview: clipOverview(summary.extract),
    posterUrl: summary.thumbnail.source,
    url: summary.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(summary.title)}`,
  };
}

async function resolveFilmCandidate(title: string): Promise<CatalogItem | undefined> {
  const titles = await opensearchTitles(`${title} film`);
  for (const candidate of titles) {
    const summary = await pageSummary(candidate);
    const item = summary && normaliseFilmSummary(summary);
    if (item) return item;
  }
  return undefined;
}

// --- verification: candidates in, real catalog items out ---------------------------------------

async function lookupOne(candidate: CandidateTitle): Promise<CatalogItem | undefined> {
  try {
    return candidate.mediaType === "movie"
      ? await resolveFilmCandidate(candidate.title)
      : await resolveShowCandidate(candidate.title, candidate.year);
  } catch (error) {
    console.error(`catalog lookup failed for "${candidate.title}":`, error);
    return undefined; // network/timeout/source-down drops this one candidate, never throws
  }
}

/**
 * Verifies a batch of LLM-proposed candidates against the real source, in parallel (each lookup
 * has its own timeout). Anything that fails to resolve — a miss, a timeout, a source outage — is
 * silently dropped rather than thrown: an empty result is a normal outcome here.
 */
export async function lookupCandidates(candidates: CandidateTitle[]): Promise<CatalogItem[]> {
  const resolved = await Promise.all(candidates.map(lookupOne));
  return dedupe(resolved.filter((item): item is CatalogItem => item !== undefined));
}

/**
 * Resolves one of this module's own ids back into a full item — for a route that only has an id +
 * mediaType (a client's "about" reference to a card it already saw) and needs the title/overview
 * again. Fails soft: an unresolvable id is a missing detail, not a fatal error.
 */
export async function detailsById(id: string, mediaType: MediaType): Promise<CatalogItem | undefined> {
  try {
    if (mediaType === "tv" && id.startsWith("tv:")) {
      const show = (await getJson(`https://api.tvmaze.com/shows/${id.slice(3)}`)) as TvmazeShow;
      return normaliseShow(show);
    }
    if (mediaType === "movie" && id.startsWith("wiki:")) {
      const summary = await pageSummary(id.slice("wiki:".length));
      return summary ? normaliseFilmSummary(summary) : undefined;
    }
    return undefined;
  } catch (error) {
    console.error(`catalog detailsById failed for ${mediaType}:${id}:`, error);
    return undefined;
  }
}
