/**
 * Vonage Video fan-out: one routed session, the broadcaster publishes, every viewer subscribes.
 *
 * ponytail: the session is created at boot and lives in memory. A server restart makes a new
 * session, so open viewer pages must re-fetch /viewer-token. Persist the id if that ever matters.
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
  sessionId ??= vonage.video
    .createSession({ mediaMode: MediaMode.ROUTED })
    .then((created) => created.sessionId)
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
