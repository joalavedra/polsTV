/**
 * Hold-to-talk speech-to-text: turns a MediaRecorder blob from the viewer's mic into text, which
 * then goes through the exact same moderated /say path as typing.
 *
 * Model: `deepgram/nova:3` (provider-hosted through SLNG) — NOT the SLNG-hosted
 * `slng/deepgram/nova:3-en` docs/cards/slng.md started from. Verified live 2026-09-19:
 * `slng/deepgram/nova:3-en` on eu-west returns 503 "No deployments found" (it is only deployed in
 * asia-south1/australia-southeast1/us-central1). `deepgram/nova:3` IS deployed in eu-west, and
 * transcribes English, Spanish and Catalan (and 45 other languages) — the room here speaks all
 * three, so this is also the multilingual pick the card asked for, not just the EU-reachable one.
 *
 * Verified live: options are multipart form fields (not query params) — punctuate/detect_language
 * sent as form fields both work; Safari-style audio/mp4 (aac) is accepted with no extra encoding
 * hint; a corrupt file gets a clean 400 with a JSON error body; the real response carries
 * `metadata.duration` in seconds (undocumented — the docs' example response omits it).
 */
// Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
import { log } from "./log";

const STT_URL = "https://eu-west.api.slng.ai/v1/stt/deepgram/nova:3";

interface SttResponse {
  results: {
    channels: { alternatives: { transcript: string }[]; detected_language?: string }[];
  };
  metadata?: { duration?: number };
}

export interface Transcription {
  text: string;
  audioSeconds?: number;
}

/** Transcribe one clip. Throws on any SLNG failure or a missing key — the caller fails closed. */
export async function transcribe(audio: Uint8Array, mime: string): Promise<Transcription> {
  const apiKey = process.env["SLNG_API_KEY"];
  if (!apiKey) throw new Error("SLNG_API_KEY is missing. Add it to .env (see docs/cards/slng.md).");
  const form = new FormData();
  form.append("audio", new Blob([Buffer.from(audio)], { type: mime }), "say");
  form.append("punctuate", "true");
  form.append("detect_language", "true");
  const startedAt = performance.now();
  const response = await fetch(STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`SLNG STT failed with ${response.status}: ${body}`);
  }
  const result = (await response.json()) as SttResponse;
  const channel = result.results.channels[0];
  const text = channel?.alternatives[0]?.transcript ?? "";
  const audioSeconds = result.metadata?.duration;
  // Kept as a log line on purpose, exactly parallel to slng_tts: the numbers the SLNG submission
  // asks for. lang is logged, not returned — the caller only needs the text to feed into /say.
  // Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
  log.info(
    `slng_stt ms=${Math.round(performance.now() - startedAt)} bytes=${audio.length} ` +
      `audio_s=${audioSeconds ?? "?"} lang=${channel?.detected_language ?? "?"}`,
  );
  return audioSeconds === undefined ? { text } : { text, audioSeconds };
}
