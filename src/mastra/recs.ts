/**
 * Scene -> "You might also like": propose real titles with one LLM call (`writeRecsQuery` in
 * showrunner.ts), verify them against the catalog (catalog.ts), and keep the best 3. Stored per
 * scene (last 10) so `GET recs` can answer for whichever scene is on air right now.
 *
 * `GET recs` is the ONLY trigger (`RecsStore.ensure`). A scene lasts 10 s (STEER_GAP_MS), so
 * building for every scene would be one Nebius call plus up to eight catalog lookups every 10 s
 * whether or not a single tv.html is open. Nothing here ever runs on the steer path, so a slow or
 * failed write/lookup cannot hold up or fail a steer.
 */
import type { CandidateTitle, CatalogItem } from "./catalog";
// Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
import { log } from "./log";
import type { RecsQueryOutcome } from "./showrunner";
import type { TokenUsage } from "./spend";

export interface SceneRecs {
  sceneId: number;
  moodLine: string;
  picks: CatalogItem[];
}

const SCENES_KEPT = 10;
const PICKS_KEPT = 3;
// Fewer than this many candidates verified against the real catalog and there isn't enough of a
// "you might also like" rail to be worth showing — better empty than a lone, weak pick.
const MIN_RESOLVED_TO_SHOW = 2;

export interface RecsDeps {
  writeQuery: (scenePrompt: string) => Promise<RecsQueryOutcome>;
  lookupCandidates: (candidates: CandidateTitle[]) => Promise<CatalogItem[]>;
  recordTokens: (sceneId: number, usage: TokenUsage) => void;
}

/**
 * Prefer well-rated titles, but interleave movies and series so a mix survives even though a
 * film's rating is usually absent (catalog.ts has no rating source for Wikipedia) and would
 * otherwise always sort behind a rated show.
 */
export function pickBest(items: CatalogItem[], limit = PICKS_KEPT): CatalogItem[] {
  const byRating = [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const movies = byRating.filter((item) => item.mediaType === "movie");
  const tv = byRating.filter((item) => item.mediaType === "tv");
  if (movies.length === 0 || tv.length === 0) return byRating.slice(0, limit);
  const mixed: CatalogItem[] = [];
  for (let i = 0; mixed.length < limit && (i < movies.length || i < tv.length); i += 1) {
    const movie = movies[i];
    if (movie) mixed.push(movie);
    const show = tv[i];
    if (mixed.length < limit && show) mixed.push(show);
  }
  return mixed.slice(0, limit);
}

/** Build one scene's recommendations. Never throws: a failed write or catalog lookup yields empty
 * picks, logged, rather than blocking the scene that triggered it. */
export async function buildSceneRecs(
  deps: RecsDeps,
  sceneId: number,
  scenePrompt: string,
): Promise<SceneRecs> {
  try {
    const { query, usage } = await deps.writeQuery(scenePrompt);
    deps.recordTokens(sceneId, usage);
    // zod's `.optional()` infers `year?: number | undefined`; CandidateTitle (like the rest of this
    // codebase under exactOptionalPropertyTypes) omits the key entirely instead.
    const candidates: CandidateTitle[] = query.candidates.map((c) => ({
      title: c.title,
      mediaType: c.mediaType,
      ...(c.year !== undefined ? { year: c.year } : {}),
    }));
    const resolved = await deps.lookupCandidates(candidates);
    if (resolved.length < MIN_RESOLVED_TO_SHOW) return { sceneId, moodLine: query.moodLine, picks: [] };
    return { sceneId, moodLine: query.moodLine, picks: pickBest(resolved) };
  } catch (error) {
    // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
    log.error(`recs failed for scene ${sceneId}, showing none:`, error);
    return { sceneId, moodLine: "", picks: [] };
  }
}

/**
 * Keeps the last SCENES_KEPT scenes' recommendations in memory. ponytail: in-memory only, like the
 * rest of the channel's state (channel.ts, spend.ts) — resets on restart.
 */
export class RecsStore {
  private byScene = new Map<number, SceneRecs>();
  private building = new Set<number>();

  set(recs: SceneRecs): void {
    this.byScene.delete(recs.sceneId);
    this.byScene.set(recs.sceneId, recs);
    for (const oldest of [...this.byScene.keys()].slice(0, -SCENES_KEPT)) this.byScene.delete(oldest);
  }

  get(sceneId: number): SceneRecs | undefined {
    return this.byScene.get(sceneId);
  }

  /**
   * This scene's picks, starting the one build for it if nobody has asked yet. Returns `undefined`
   * until that build lands; tv.html polls, so the next poll a second later gets them. An amend
   * keeps the scene's `ideaId`, so it reuses the same entry rather than paying for a new one.
   *
   * `buildSceneRecs` never rejects and stores empty picks on failure, so a scene costs at most one
   * attempt however many viewers are polling and however badly it goes.
   */
  ensure(deps: RecsDeps, sceneId: number, scenePrompt: string): SceneRecs | undefined {
    const known = this.byScene.get(sceneId);
    if (known || this.building.has(sceneId)) return known;
    this.building.add(sceneId);
    void buildSceneRecs(deps, sceneId, scenePrompt)
      .then((recs) => this.set(recs))
      .finally(() => this.building.delete(sceneId));
    return undefined;
  }
}

/** The one shared store for this process, read and filled by GET recs (index.ts). */
export const recsStore = new RecsStore();
