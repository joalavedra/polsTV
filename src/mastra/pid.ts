/**
 * Public viewer id: a stable, one-way stand-in for a uid that is safe to show to other viewers.
 * uids authorise likes and pitches and must never leave the server (docs/CONTRACT.md); `pidOf`
 * is what `/status` and the history routes hand out instead. Deterministic and pure — no I/O —
 * so it needs no clock or injection, unlike Channel/Ticker/History.
 */
import { createHash } from "node:crypto";

const PID_LENGTH = 12;

/** First 12 hex chars of sha256(uid + ":" + secret). Same uid+secret always yields the same pid;
 * a different uid (or secret) yields a different one; the uid never appears in the output. */
export function pidOf(uid: string, secret: string): string {
  return createHash("sha256").update(`${uid}:${secret}`).digest("hex").slice(0, PID_LENGTH);
}
