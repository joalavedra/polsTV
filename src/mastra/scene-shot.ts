/**
 * POST /b/:secret/scene-shot: validate and record one scene's still. Pure and dependency-injected,
 * same shape as say.ts/eval.ts, so the boundary checks are unit-testable without a filesystem or a
 * running channel. Wired in index.ts.
 */
import type { HistoryEntry } from "./history";

export interface SceneOnAir {
  ideaId: number;
  uid: string;
  name: string;
  text: string;
  airedAt: number;
}

export interface SceneShotInput {
  ideaId: number;
  contentType: string | undefined;
  body: Uint8Array;
}

export type SceneShotOutcome =
  | { status: 200; body: { ok: true } }
  | { status: 400 | 409; body: { ok: false; reason: string } };

export interface SceneShotDeps {
  /** The scene currently on air, or undefined if nothing is. */
  nowScene: () => SceneOnAir | undefined;
  pidOf: (uid: string) => string;
  /** Upserts into the in-memory store; returns ideaIds evicted by the overall cap. */
  record: (entry: HistoryEntry) => number[];
  persistIndex: () => Promise<void>;
  saveShot: (ideaId: number, bytes: Uint8Array) => Promise<void>;
  deleteShot: (ideaId: number) => Promise<void>;
}

const MIN_BYTES = 1_000; // 1 KB
const MAX_BYTES = 250_000; // 250 KB
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function looksLikeJpeg(bytes: Uint8Array): boolean {
  return JPEG_MAGIC.every((byte, index) => bytes[index] === byte);
}

/**
 * Validate the boundary, then accept only for the scene currently on air. `record` runs before the
 * disk write so an interrupted upload never loses the in-memory entry the viewer will see next.
 */
export async function handleSceneShot(
  deps: SceneShotDeps,
  input: SceneShotInput,
): Promise<SceneShotOutcome> {
  if (input.contentType !== "image/jpeg") {
    return { status: 400, body: { ok: false, reason: "Expected content-type: image/jpeg." } };
  }
  if (input.body.length < MIN_BYTES || input.body.length > MAX_BYTES) {
    return { status: 400, body: { ok: false, reason: "Image must be 1 KB - 250 KB." } };
  }
  if (!looksLikeJpeg(input.body)) {
    return { status: 400, body: { ok: false, reason: "Not a JPEG." } };
  }
  const scene = deps.nowScene();
  if (!scene || scene.ideaId !== input.ideaId) {
    return { status: 409, body: { ok: false, reason: "That scene is no longer on air." } };
  }
  const evicted = deps.record({
    ideaId: scene.ideaId,
    pid: deps.pidOf(scene.uid),
    name: scene.name,
    text: scene.text,
    airedAt: scene.airedAt,
  });
  await deps.saveShot(scene.ideaId, input.body);
  await deps.persistIndex();
  await Promise.all(evicted.map((ideaId) => deps.deleteShot(ideaId)));
  return { status: 200, body: { ok: true } };
}
