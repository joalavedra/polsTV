import { describe, expect, it, vi } from "vitest";
import type { AddResult } from "./channel";
import { handleSay } from "./say";
import type { SayDeps } from "./say";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

function deps(overrides: Partial<SayDeps> = {}): SayDeps {
  return {
    moderate: vi.fn(async () => ({ verdict: { ok: true, reason: "" }, usage: ZERO_USAGE })),
    addIdea: vi.fn(
      (): AddResult => ({
        ok: true,
        idea: { id: 7, uid: "u1", name: "Ana", text: "a cat", source: "voice", at: 0 },
      }),
    ),
    recordModeration: vi.fn(),
    recordStt: vi.fn(),
    ...overrides,
  };
}

const input = { uid: "u1", name: "Ana", text: "a cat", source: "voice" as const };

describe("handleSay voice branch (stt attribution)", () => {
  it("attributes STT cost to the idea id when the idea is queued", async () => {
    const d = deps();
    const outcome = await handleSay(d, input, { audioSeconds: 4 });
    expect(outcome).toEqual({ status: 200, body: { ok: true, id: 7 } });
    expect(d.recordStt).toHaveBeenCalledWith(7, "Ana", "a cat", 4);
  });

  it("attributes STT cost to 'rejected' when moderation turns the idea down", async () => {
    const d = deps({
      moderate: vi.fn(async () => ({ verdict: { ok: false, reason: "no" }, usage: ZERO_USAGE })),
    });
    const outcome = await handleSay(d, input, { audioSeconds: 3 });
    expect(outcome).toEqual({ status: 422, body: { ok: false, reason: "no" } });
    expect(d.recordStt).toHaveBeenCalledWith("rejected", "Ana", "a cat", 3);
  });

  it("attributes STT cost to 'rejected' when the viewer already has an idea queued", async () => {
    const d = deps({
      addIdea: vi.fn((): AddResult => ({ ok: false, reason: "already queued" })),
    });
    const outcome = await handleSay(d, input, { audioSeconds: 2 });
    expect(outcome).toEqual({ status: 409, body: { ok: false, reason: "already queued" } });
    expect(d.recordStt).toHaveBeenCalledWith("rejected", "Ana", "a cat", 2);
  });

  it("attributes STT cost to 'rejected' when moderation itself fails", async () => {
    const d = deps({
      moderate: vi.fn(async () => {
        throw new Error("nebius down");
      }),
    });
    const outcome = await handleSay(d, input, { audioSeconds: 5 });
    expect(outcome.status).toBe(503);
    expect(d.recordStt).toHaveBeenCalledWith("rejected", "Ana", "a cat", 5);
  });

  it("never calls recordStt when no stt metadata is given (the typed /say path)", async () => {
    const d = deps();
    await handleSay(d, input);
    expect(d.recordStt).not.toHaveBeenCalled();
  });
});

describe("handleSay typed branch (parity with /say's original behaviour)", () => {
  it("queues an approved idea and returns its id", async () => {
    const d = deps();
    const outcome = await handleSay(d, input);
    expect(outcome).toEqual({ status: 200, body: { ok: true, id: 7 } });
  });

  it("returns 503 without touching the queue when moderation is unavailable", async () => {
    const d = deps({
      moderate: vi.fn(async () => {
        throw new Error("down");
      }),
    });
    const outcome = await handleSay(d, input);
    expect(outcome.status).toBe(503);
    expect(d.addIdea).not.toHaveBeenCalled();
  });
});
