/**
 * The moderated path from a submitted idea to a queued one, shared by /say (typed) and /say-voice
 * (spoken) in index.ts. Pure and dependency-injected — no runtime import of channel.ts,
 * showrunner.ts or spend.ts, only their types, so this stays unit-testable without building the
 * rest of the app (Mastra, Vonage, the Telegram adapter) the way index.ts itself needs to.
 */
import type { AddResult, Source } from "./channel";
import type { ModerationOutcome } from "./showrunner";
import type { TokenUsage } from "./spend";

export interface SayInput {
  uid: string;
  name: string;
  text: string;
  source: Source;
}

export type SayOutcome =
  | { status: 503; body: { ok: false; reason: string } }
  | { status: 422; body: { ok: false; reason: string } }
  | { status: 409; body: { ok: false; reason: string } }
  | { status: 200; body: { ok: true; id: number } };

export interface SayDeps {
  moderate: (text: string, name: string) => Promise<ModerationOutcome>;
  addIdea: (input: SayInput) => AddResult;
  recordModeration: (
    target: number | "rejected",
    name: string,
    text: string,
    usage: TokenUsage,
  ) => void;
  recordStt: (
    target: number | "rejected",
    name: string,
    text: string,
    audioSeconds: number,
  ) => void;
}

/**
 * Judge one idea on Nebius, then try to queue it. `stt`, when given, attributes the SLNG
 * transcription cost to whichever bucket the idea's moderation cost lands in — a refused idea's
 * listening cost joins its judging cost in notAired, same as recordModeration's own rule.
 */
export async function handleSay(
  deps: SayDeps,
  input: SayInput,
  stt?: { audioSeconds: number },
): Promise<SayOutcome> {
  let outcome: ModerationOutcome;
  try {
    outcome = await deps.moderate(input.text, input.name);
  } catch (error) {
    console.error("moderation failed, idea not queued:", error);
    // SLNG was already paid for this transcription even though moderation never ran.
    if (stt) deps.recordStt("rejected", input.name, input.text, stt.audioSeconds);
    return { status: 503, body: { ok: false, reason: "Moderation is unavailable, try again." } };
  }
  const { verdict, usage } = outcome;
  if (!verdict.ok) {
    deps.recordModeration("rejected", input.name, input.text, usage);
    if (stt) deps.recordStt("rejected", input.name, input.text, stt.audioSeconds);
    return { status: 422, body: { ok: false, reason: verdict.reason } };
  }
  const added = deps.addIdea(input);
  if (!added.ok) {
    deps.recordModeration("rejected", input.name, input.text, usage);
    if (stt) deps.recordStt("rejected", input.name, input.text, stt.audioSeconds);
    return { status: 409, body: { ok: false, reason: added.reason } };
  }
  deps.recordModeration(added.idea.id, added.idea.name, added.idea.text, usage);
  if (stt) deps.recordStt(added.idea.id, added.idea.name, added.idea.text, stt.audioSeconds);
  return { status: 200, body: { ok: true, id: added.idea.id } };
}
