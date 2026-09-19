/**
 * Vonage Video fan-out: one routed session, the broadcaster publishes, every viewer subscribes.
 *
 * The session id must outlive the process: the broadcaster keeps publishing into the session it
 * joined, so a restarted server that minted a fresh one left every viewer subscribed to an empty
 * room (live pill on, OFF AIR card up). Set VONAGE_SESSION_ID once and restarts become invisible.
 */
import { Vonage } from "@vonage/server-sdk";
import { MediaMode } from "@vonage/video";

export interface VideoAccess {
  applicationId: string;
  sessionId: string;
  token: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing. Add it to .env (see docs/cards/vonage.md).`);
  return value;
}

const applicationId = requireEnv("VONAGE_APPLICATION_ID");
const vonage = new Vonage({
  applicationId,
  privateKey: Buffer.from(requireEnv("VONAGE_PRIVATE_KEY64"), "base64").toString("utf8"),
});

let sessionId: Promise<string> | undefined;

function session(): Promise<string> {
  const pinned = process.env["VONAGE_SESSION_ID"];
  if (pinned) return Promise.resolve(pinned);
  sessionId ??= vonage.video
    .createSession({ mediaMode: MediaMode.ROUTED })
    .then((created) => {
      console.warn(
        `VONAGE_SESSION_ID is not set, so this session dies with the process. ` +
          `Add to .env: VONAGE_SESSION_ID="${created.sessionId}"`,
      );
      return created.sessionId;
    })
    .catch((error: unknown) => {
      sessionId = undefined;
      throw new Error("Vonage createSession failed; check VONAGE_APPLICATION_ID and the private key", {
        cause: error,
      });
    });
  return sessionId;
}

/** Mint a token for the shared session. Viewers can only subscribe; the broadcaster publishes. */
export async function videoAccess(role: "publisher" | "subscriber"): Promise<VideoAccess> {
  const id = await session();
  return { applicationId, sessionId: id, token: vonage.video.generateClientToken(id, { role }) };
}
