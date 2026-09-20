import { describe, expect, it, vi } from "vitest";
import { handleSceneShot, type SceneShotDeps, type SceneOnAir } from "./scene-shot";

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);

function jpegBody(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(JPEG_MAGIC);
  return bytes;
}

function setup(scene: SceneOnAir | undefined) {
  const deleted: number[] = [];
  const saved: { ideaId: number; bytes: Uint8Array }[] = [];
  const deps: SceneShotDeps = {
    nowScene: () => scene,
    pidOf: (uid) => `pid-${uid}`,
    record: vi.fn(() => []),
    persistIndex: vi.fn(async () => {}),
    saveShot: vi.fn(async (ideaId, bytes) => {
      saved.push({ ideaId, bytes });
    }),
    deleteShot: vi.fn(async (ideaId) => {
      deleted.push(ideaId);
    }),
  };
  return { deps, deleted, saved };
}

const onAir: SceneOnAir = { ideaId: 5, uid: "ana", name: "ANA", text: "a cat", airedAt: 1000 };

describe("handleSceneShot", () => {
  it("rejects the wrong content-type", async () => {
    const { deps } = setup(onAir);
    const outcome = await handleSceneShot(deps, {
      ideaId: 5,
      contentType: "image/png",
      body: jpegBody(2000),
    });
    expect(outcome.status).toBe(400);
    expect(deps.record).not.toHaveBeenCalled();
  });

  it("rejects a body smaller than 1 KB", async () => {
    const { deps } = setup(onAir);
    const outcome = await handleSceneShot(deps, {
      ideaId: 5,
      contentType: "image/jpeg",
      body: jpegBody(500),
    });
    expect(outcome.status).toBe(400);
  });

  it("rejects a body larger than 250 KB", async () => {
    const { deps } = setup(onAir);
    const outcome = await handleSceneShot(deps, {
      ideaId: 5,
      contentType: "image/jpeg",
      body: jpegBody(250_001),
    });
    expect(outcome.status).toBe(400);
  });

  it("rejects bad magic bytes even with the right type and size", async () => {
    const { deps } = setup(onAir);
    const body = new Uint8Array(2000); // all zeros, not a JPEG
    const outcome = await handleSceneShot(deps, { ideaId: 5, contentType: "image/jpeg", body });
    expect(outcome.status).toBe(400);
  });

  it("refuses a shot for a scene that is not the one on air", async () => {
    const { deps } = setup(onAir);
    const outcome = await handleSceneShot(deps, {
      ideaId: 999,
      contentType: "image/jpeg",
      body: jpegBody(2000),
    });
    expect(outcome.status).toBe(409);
  });

  it("refuses when nothing is on air", async () => {
    const { deps } = setup(undefined);
    const outcome = await handleSceneShot(deps, {
      ideaId: 5,
      contentType: "image/jpeg",
      body: jpegBody(2000),
    });
    expect(outcome.status).toBe(409);
  });

  it("records, saves and persists on the happy path, using channel data", async () => {
    const { deps, saved } = setup(onAir);
    const body = jpegBody(2000);
    const outcome = await handleSceneShot(deps, { ideaId: 5, contentType: "image/jpeg", body });
    expect(outcome).toEqual({ status: 200, body: { ok: true } });
    expect(deps.record).toHaveBeenCalledWith({
      ideaId: 5,
      pid: "pid-ana",
      name: "ANA",
      text: "a cat",
      airedAt: 1000,
    });
    expect(saved).toEqual([{ ideaId: 5, bytes: body }]);
    expect(deps.persistIndex).toHaveBeenCalled();
  });

  it("deletes the stills of entries evicted by the overall cap", async () => {
    const { deps, deleted } = setup(onAir);
    deps.record = vi.fn(() => [1, 2, 3]);
    await handleSceneShot(deps, { ideaId: 5, contentType: "image/jpeg", body: jpegBody(2000) });
    expect(deleted.sort()).toEqual([1, 2, 3]);
  });
});
