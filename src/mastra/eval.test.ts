import { describe, expect, it, vi } from "vitest";
import { handleEval } from "./eval";
import type { EvalDeps, EvalOutcome } from "./eval";

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };

function deps(overrides: Partial<EvalDeps> = {}): EvalDeps {
  return {
    moderate: vi.fn(async () => ({ verdict: { ok: true, reason: "" }, usage: ZERO_USAGE })),
    writeSteer: vi.fn(async () => ({ prompt: "a claymation cat", usage: ZERO_USAGE })),
    ...overrides,
  };
}

const input = { name: "Ana", text: "a cat runs a laundrette" };

describe("handleEval", () => {
  it("returns the steering prompt for an accepted idea", async () => {
    const d = deps();
    const outcome = await handleEval(d, input);
    expect(outcome).toEqual({
      status: 200,
      body: { ok: true, reason: "", prompt: "a claymation cat" },
    });
    expect(d.writeSteer).toHaveBeenCalledWith(undefined, input.text);
  });

  it("returns the refusal reason and never calls the writer when moderation rejects", async () => {
    const d = deps({
      moderate: vi.fn(async () => ({ verdict: { ok: false, reason: "no real people" }, usage: ZERO_USAGE })),
    });
    const outcome = await handleEval(d, input);
    expect(outcome).toEqual({ status: 200, body: { ok: false, reason: "no real people" } });
    expect(d.writeSteer).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the moderator throws", async () => {
    const d = deps({
      moderate: vi.fn(async () => {
        throw new Error("nebius down");
      }),
    });
    let outcome: EvalOutcome;
    try {
      // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
      outcome = await handleEval(d, input);
    } catch (error) {
      throw new Error("handleEval rejected; it must resolve to an outcome here", { cause: error });
    }
    expect(outcome.status).toBe(503);
    expect(outcome.body.ok).toBe(false);
    expect(d.writeSteer).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the scene writer throws after acceptance", async () => {
    const d = deps({
      writeSteer: vi.fn(async () => {
        throw new Error("empty prompt");
      }),
    });
    const outcome = await handleEval(d, input);
    expect(outcome.status).toBe(503);
    expect(outcome.body.ok).toBe(false);
  });
});
