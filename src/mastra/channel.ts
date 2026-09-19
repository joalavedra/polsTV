/**
 * The channel's state machine: idea queue, steer lifecycle, likes and karma.
 * Pure and synchronous. No I/O, clock injected, so every rule here is unit-testable.
 *
 * ponytail: in-memory only, state dies with the process. Move karma to the LibSQL store if a
 * restart during the demo ever costs someone their score.
 */

export type Source = "web" | "telegram" | "voice";

export interface Idea {
  id: number;
  uid: string;
  name: string;
  text: string;
  source: Source;
  at: number;
}

export interface Scene {
  ideaId: number;
  uid: string;
  name: string;
  text: string;
  /** The steering prompt actually sent to Director. */
  prompt: string;
  airedAt: number;
  likes: number;
}

export interface Steer {
  /** Server-side id. Not Director's prompt_version, which the broadcaster owns per session. */
  steerId: number;
  ideaId: number;
  prompt: string;
  /** Spoken "up next" line for the broadcaster to mix in. Absent when synthesis failed. */
  announcerUrl?: string;
}

export interface ChatLine {
  id: number;
  name: string;
  text: string;
  at: number;
  karma: number;
}

export interface Status {
  live: boolean;
  viewers: number;
  now: Scene | null;
  steering: { name: string; text: string } | null;
  queue: { id: number; name: string; text: string; karma: number }[];
  chat: ChatLine[];
  rank: { name: string; karma: number }[];
  ts: number;
}

export type AddResult = { ok: true; idea: Idea } | { ok: false; reason: string };

/** What `resolveSteer` changed: the scene that went on air (if applied) and the one it replaced. */
export interface SteerOutcome {
  onAir: Scene | undefined;
  ended: Scene | undefined;
}

/** Measured steer-to-screen latency is 17-20 s; steering faster than this just stacks prompts. */
export const STEER_GAP_MS = 25_000;
const VIEWER_TTL_MS = 10_000;
const BROADCASTER_TTL_MS = 15_000;
const CHAT_KEEP = 50;
const RANK_KEEP = 10;

export class Channel {
  private nextId = 1;
  private queue: Idea[] = [];
  private pending: Steer | undefined;
  private lastSteerAt = 0;
  private scene: Scene | undefined;
  private likedBy = new Set<string>();
  private chat: (Omit<ChatLine, "karma"> & { uid: string })[] = [];
  private players = new Map<string, { name: string; karma: number }>();
  private viewers = new Map<string, number>();
  private broadcasterSeenAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Queue an already-moderated idea. One queued idea per user keeps the queue fair and spam-proof. */
  addIdea(input: { uid: string; name: string; text: string; source: Source }): AddResult {
    if (this.queue.some((idea) => idea.uid === input.uid)) {
      return { ok: false, reason: "You already have an idea in the queue. Wait until it airs." };
    }
    const idea: Idea = { id: this.nextId++, at: this.now(), ...input };
    this.queue.push(idea);
    this.player(input.uid, input.name);
    this.chat.push({
      id: idea.id,
      name: idea.name,
      text: idea.text,
      at: idea.at,
      uid: idea.uid,
    });
    this.chat = this.chat.slice(-CHAT_KEEP);
    return { ok: true, idea };
  }

  /** Highest-karma submitter first, then oldest. Does not remove the idea. */
  nextIdea(): Idea | undefined {
    return this.orderedQueue()[0];
  }

  /** 1-based serving-order position of a user's queued idea, or undefined if they have none. */
  queuePosition(uid: string): number | undefined {
    const index = this.orderedQueue().findIndex((idea) => idea.uid === uid);
    return index === -1 ? undefined : index + 1;
  }

  /** A user's own queued idea, if they have one (at most one per user). */
  myIdea(uid: string): Idea | undefined {
    return this.queue.find((idea) => idea.uid === uid);
  }

  /** Serving order: highest karma first, then oldest. */
  private orderedQueue(): Idea[] {
    return [...this.queue].sort(
      (a, b) => this.karmaOf(b.uid) - this.karmaOf(a.uid) || a.at - b.at,
    );
  }

  /** True when no steer is in flight and the previous one has had time to reach the screen. */
  canSteer(): boolean {
    return this.pending === undefined && this.now() - this.lastSteerAt >= STEER_GAP_MS;
  }

  pendingSteer(): Steer | undefined {
    return this.pending;
  }

  beginSteer(ideaId: number, prompt: string, announcerUrl?: string): Steer {
    if (!this.canSteer()) throw new Error("beginSteer called while a steer is in flight or too soon");
    if (!this.queue.some((idea) => idea.id === ideaId)) throw new Error(`idea ${ideaId} is not queued`);
    this.pending = {
      steerId: this.nextId++,
      ideaId,
      prompt,
      ...(announcerUrl ? { announcerUrl } : {}),
    };
    this.lastSteerAt = this.now();
    return this.pending;
  }

  /**
   * Close the in-flight steer. Applied: the idea becomes the scene on air. Rejected: the idea is
   * dropped and the scene on air is unchanged. Returns the scene that went on air (`onAir`) and the
   * one it replaced (`ended`), each undefined when nothing changed.
   */
  resolveSteer(steerId: number, applied: boolean): SteerOutcome {
    const steer = this.pending;
    if (!steer || steer.steerId !== steerId) return { onAir: undefined, ended: undefined };
    this.pending = undefined;
    const idea = this.queue.find((queued) => queued.id === steer.ideaId);
    this.queue = this.queue.filter((queued) => queued.id !== steer.ideaId);
    if (!applied || !idea) return { onAir: undefined, ended: undefined };
    const ended = this.scene;
    this.scene = {
      ideaId: idea.id,
      uid: idea.uid,
      name: idea.name,
      text: idea.text,
      prompt: steer.prompt,
      airedAt: this.now(),
      likes: 0,
    };
    this.likedBy.clear();
    return { onAir: this.scene, ended };
  }

  /** One like per viewer per scene, never your own. Karma goes to whoever prompted the scene. */
  like(uid: string): boolean {
    const scene = this.scene;
    if (!scene || scene.uid === uid || this.likedBy.has(uid)) return false;
    this.likedBy.add(uid);
    scene.likes += 1;
    this.player(scene.uid, scene.name).karma += 1;
    return true;
  }

  karmaOf(uid: string): number {
    return this.players.get(uid)?.karma ?? 0;
  }

  sawViewer(uid: string): void {
    this.viewers.set(uid, this.now());
  }

  sawBroadcaster(): void {
    this.broadcasterSeenAt = this.now();
  }

  status(): Status {
    const now = this.now();
    for (const [uid, seenAt] of this.viewers) {
      if (now - seenAt > VIEWER_TTL_MS) this.viewers.delete(uid);
    }
    const steeringIdea = this.pending && this.queue.find((idea) => idea.id === this.pending?.ideaId);
    return {
      live: now - this.broadcasterSeenAt < BROADCASTER_TTL_MS,
      viewers: this.viewers.size,
      now: this.scene ?? null,
      steering: steeringIdea ? { name: steeringIdea.name, text: steeringIdea.text } : null,
      queue: this.queue
        .filter((idea) => idea.id !== this.pending?.ideaId)
        .map((idea) => ({
          id: idea.id,
          name: idea.name,
          text: idea.text,
          karma: this.karmaOf(idea.uid),
        })),
      // Karma is read at status time so the stars in chat move as likes come in.
      chat: this.chat.map(({ uid, ...line }) => ({ ...line, karma: this.karmaOf(uid) })),
      rank: [...this.players.values()]
        .filter((player) => player.karma > 0)
        .sort((a, b) => b.karma - a.karma)
        .slice(0, RANK_KEEP),
      ts: now,
    };
  }

  private player(uid: string, name: string): { name: string; karma: number } {
    const existing = this.players.get(uid);
    if (existing) {
      existing.name = name;
      return existing;
    }
    const created = { name, karma: 0 };
    this.players.set(uid, created);
    return created;
  }
}

/** The one shared channel instance for this process. index.ts and telegram.ts both import it. */
export const channel = new Channel();
