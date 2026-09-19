/**
 * Scene -> "You might also like": when a NEW scene takes the air (never an amend — see
 * `sceneRecsJob`, the same rule `sceneChangeMessages` in telegram.ts follows for its own DM),
 * propose real titles with one LLM call (`writeRecsQuery` in showrunner.ts), verify them against
 * the catalog (catalog.ts), and keep the best 3. Stored per scene (last 10) so `GET recs` can
 * answer for whichever scene is on air right now.
 *
 * `buildSceneRecs` never throws — index.ts runs it after responding to steer-result, fire-and-
 * forget, so a slow or failed write/lookup here must never hold up or fail the steer.
 */
import type { CandidateTitle, CatalogItem } from "./catalog";
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

export interface AiredScene {
  ideaId: number;
  prompt: string;
}

/** A scene only gets fresh recs when it is a NEW scene taking the air, not an amend continuing the
 * same scene (which keeps whatever recs it already had) — the same rule notifySceneChange's
 * "you're on air" DM follows for the same reason (telegram.ts's sceneChangeMessages). */
export function sceneRecsJob(onAir: AiredScene | undefined, amended: boolean): AiredScene | undefined {
  return onAir && !amended ? onAir : undefined;
}

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
    console.error(`recs failed for scene ${sceneId}, showing none:`, error);
    return { sceneId, moodLine: "", picks: [] };
  }
}

/**
 * Keeps the last SCENES_KEPT scenes' recommendations in memory. ponytail: in-memory only, like the
 * rest of the channel's state (channel.ts, spend.ts) — resets on restart.
 */
export class RecsStore {
  private byScene = new Map<number, SceneRecs>();

  set(recs: SceneRecs): void {
    this.byScene.delete(recs.sceneId);
    this.byScene.set(recs.sceneId, recs);
    for (const oldest of [...this.byScene.keys()].slice(0, -SCENES_KEPT)) this.byScene.delete(oldest);
  }

  get(sceneId: number): SceneRecs | undefined {
    return this.byScene.get(sceneId);
  }
}

/** The one shared store for this process. index.ts writes to it once a scene airs and reads it for
 * GET recs. */
export const recsStore = new RecsStore();
