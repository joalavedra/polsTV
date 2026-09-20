/**
 * The Galtea evaluation hook: run one input through the real moderation + steering-prompt pipeline
 * with no side effects — nothing is queued, nothing airs, nothing is spent on TTS. Mirrors say.ts's
 * shape (pure, dependency-injected) so it is unit-testable without Mastra, Vonage or a running
 * channel. Wired in behind the broadcaster secret in index.ts: `POST /b/:secret/eval`.
 */
import type { ModerationOutcome, SteerWriteOutcome } from "./showrunner";
// Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
import { log } from "./log";

export interface EvalInput {
  name: string;
  text: string;
}

export type EvalOutcome =
  | { status: 503; body: { ok: false; reason: string } }
  | { status: 200; body: { ok: false; reason: string } }
  | { status: 200; body: { ok: true; reason: ""; prompt: string } };

export interface EvalDeps {
  moderate: (text: string, name: string) => Promise<ModerationOutcome>;
  writeSteer: (currentScene: string | undefined, idea: string) => Promise<SteerWriteOutcome>;
}

/**
 * Judge one idea exactly as `/say` would, then, if accepted, write the steering prompt it would
 * have gone to air with. Both stages fail closed: a moderator or writer error is a 503, never a
 * silent accept.
 */
export async function handleEval(deps: EvalDeps, input: EvalInput): Promise<EvalOutcome> {
  let outcome: ModerationOutcome;
  try {
    outcome = await deps.moderate(input.text, input.name);
  } catch (error) {
    // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
    log.error("eval moderation failed:", error);
    return { status: 503, body: { ok: false, reason: "Moderation is unavailable, try again." } };
  }
  if (!outcome.verdict.ok) {
    return { status: 200, body: { ok: false, reason: outcome.verdict.reason } };
  }
  try {
    const steer = await deps.writeSteer(undefined, input.text);
    return { status: 200, body: { ok: true, reason: "", prompt: steer.prompt } };
  } catch (error) {
    // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
    log.error("eval steer write failed:", error);
    return { status: 503, body: { ok: false, reason: "Steering is unavailable, try again." } };
  }
}
