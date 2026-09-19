/**
 * The channel's state machine: idea queue, steer lifecycle, likes and karma.
 * Pure and synchronous. No I/O, clock injected, so every rule here is unit-testable.
 *
 * ponytail: in-memory only, state dies with the process. Move karma to the LibSQL store if a
 * restart during the demo ever costs someone their score.
 */

export type Source = "web" | "telegram" | "voice";

/** "new" replaces the scene on air; "amend" changes one thing about it while it keeps running. */
export type IdeaKind = "new" | "amend";

export interface Idea {
  id: number;
  uid: string;
  name: string;
  text: string;
  source: Source;
  at: number;
  kind: IdeaKind;
  /** kind "amend" only: the ideaId of the scene this amend was written for. Dropped, never applied
   * to a different scene, if that scene is no longer on air by the time this amend's turn comes. */
  forIdeaId?: number;
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
  /** Viewer amendments applied to this scene while it stayed on air, oldest first. */
  amends: { name: string; text: string }[];
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
  /** The scene on air, with its prompter's current karma so viewers can watch it move. */
  now: (Scene & { karma: number }) | null;
  steering: { name: string; text: string; kind: IdeaKind } | null;
  queue: { id: number; name: string; text: string; karma: number; kind: IdeaKind }[];
  chat: ChatLine[];
  rank: { name: string; karma: number }[];
  ts: number;
}

export type AddResult = { ok: true; idea: Idea } | { ok: false; reason: string };

/** What `resolveSteer` changed: the scene that went on air (if applied) and the one it replaced. */
export interface SteerOutcome {
  onAir: Scene | undefined;
  ended: Scene | undefined;
  /** True when `onAir` is the same scene continuing after an applied amend, not a new one taking
   * over. Callers use this to skip the "you're on air" DM, which only makes sense once per scene. */
  amended: boolean;
}

/** Each scene holds the screen for 10 s before the next steer can land. Raise this if scenes feel
 * rushed in live testing. */
export const STEER_GAP_MS = 10_000;
/**
 * How long a steer may stay in flight before the channel gives up on it. The broadcaster
 * resolves one within seconds; one still open after this lost its result — the page reloaded,
 * its POST fell into a server restart, or Director never answered. Without this the channel
 * holds that steer forever and nothing else ever airs.
 */
export const STEER_TIMEOUT_MS = 90_000;
/** More than this and the scene stops resembling what the original prompter asked for. */
export const MAX_AMENDS_PER_SCENE = 3;
const VIEWER_TTL_MS = 10_000;
const BROADCASTER_TTL_MS = 15_000;
const CHAT_KEEP = 50;
const RANK_KEEP = 10;

export class Channel {
  /**
   * Seeded from the clock, not 1. The broadcaster page outlives the server across a hot reload
   * or a crash-loop; it dedups steers by id and keys its played-clip set on them, so an id
   * reused after a restart is silently ignored and the queue wedges behind it for good.
   */
  private nextId: number;
  private queue: Idea[] = [];
  private pending: Steer | undefined;
  private lastSteerAt = 0;
  private scene: Scene | undefined;
  private likedBy = new Set<string>();
  private chat: (Omit<ChatLine, "karma"> & { uid: string })[] = [];
  private players = new Map<string, { name: string; karma: number }>();
  private viewers = new Map<string, number>();
  private broadcasterSeenAt = 0;

  constructor(private readonly now: () => number = Date.now) {
    this.nextId = this.now();
  }

  /**
   * Queue an already-moderated idea or amend. One queued contribution per user, of either kind,
   * keeps the queue fair and spam-proof. An amend ("kind: amend") is only accepted while a scene
   * is on air, is tagged with the scene it targets (`forIdeaId`), and is refused once that scene
   * has already taken its three changes.
   */
  addIdea(input: {
    uid: string;
    name: string;
    text: string;
    source: Source;
    kind?: IdeaKind;
  }): AddResult {
    const kind = input.kind ?? "new";
    if (this.queue.some((idea) => idea.uid === input.uid)) {
      return { ok: false, reason: "You already have an idea in the queue. Wait until it airs." };
    }
    const forIdeaId = kind === "amend" ? this.scene?.ideaId : undefined;
    if (kind === "amend") {
      if (forIdeaId === undefined) {
        return { ok: false, reason: "Nothing is on air to change yet; send an idea first." };
      }
      if ((this.scene?.amends.length ?? 0) >= MAX_AMENDS_PER_SCENE) {
        return { ok: false, reason: "This scene has had its three changes; send a new idea." };
      }
    }
    const idea: Idea = {
      id: this.nextId++,
      at: this.now(),
      uid: input.uid,
      name: input.name,
      text: input.text,
      source: input.source,
      kind,
      ...(forIdeaId !== undefined ? { forIdeaId } : {}),
    };
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

  /** Amends (oldest first) ahead of new ideas (highest karma, then oldest). Does not remove it. */
  nextIdea(): Idea | undefined {
    return this.orderedQueue()[0];
  }

  /** Remove a queued idea without steering it — used to drop an amend whose target scene ended. */
  dropIdea(id: number): void {
    this.queue = this.queue.filter((idea) => idea.id !== id);
  }

  /**
   * True when a queued amend can no longer be applied: its target scene is no longer on air, or
   * that scene already has its full three changes. Either way it must be dropped, never steered.
   * Always false for a "new" idea.
   */
  isStaleAmend(idea: Idea): boolean {
    if (idea.kind !== "amend") return false;
    const scene = this.scene;
    return !scene || scene.ideaId !== idea.forIdeaId || scene.amends.length >= MAX_AMENDS_PER_SCENE;
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

  /** Serving order: queued amends first (oldest first), then new ideas (highest karma, then oldest) —
   * an amend is about what is on screen right now, so it jumps the line ahead of a fresh scene. */
  private orderedQueue(): Idea[] {
    const amends = this.queue.filter((idea) => idea.kind === "amend").sort((a, b) => a.at - b.at);
    const newIdeas = this.queue
      .filter((idea) => idea.kind === "new")
      .sort((a, b) => this.karmaOf(b.uid) - this.karmaOf(a.uid) || a.at - b.at);
    return [...amends, ...newIdeas];
  }

  /** True when no steer is in flight and the previous one has had time to reach the screen. */
  canSteer(): boolean {
    return this.pending === undefined && this.now() - this.lastSteerAt >= STEER_GAP_MS;
  }

  pendingSteer(): Steer | undefined {
    return this.pending;
  }

  /**
   * Give up on an in-flight steer the broadcaster never reported on, so the queue moves again.
   * Its idea is dropped with it — nobody knows whether it reached the screen. Returns the
   * abandoned steer exactly once, so the caller can log it and file its cost.
   */
  expireStaleSteer(): Steer | undefined {
    const steer = this.pending;
    if (!steer || this.now() - this.lastSteerAt < STEER_TIMEOUT_MS) return undefined;
    this.pending = undefined;
    this.queue = this.queue.filter((idea) => idea.id !== steer.ideaId);
    return steer;
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
   * Close the in-flight steer. Applied and "new": the idea becomes the scene on air, replacing
   * whatever was there. Applied and "amend": the scene on air stays the same scene (same prompter,
   * likes, karma target) but records the amendment and adopts the new steering prompt. Rejected:
   * the idea is dropped and the scene on air is unchanged. Returns the scene that went on air
   * (`onAir`), the one it replaced (`ended`, always undefined for an amend), and whether this was
   * an amend rather than a new scene taking over (`amended`).
   */
  resolveSteer(steerId: number, applied: boolean): SteerOutcome {
    const steer = this.pending;
    if (!steer || steer.steerId !== steerId) {
      return { onAir: undefined, ended: undefined, amended: false };
    }
    this.pending = undefined;
    const idea = this.queue.find((queued) => queued.id === steer.ideaId);
    this.queue = this.queue.filter((queued) => queued.id !== steer.ideaId);
    if (!applied || !idea) return { onAir: undefined, ended: undefined, amended: false };
    if (idea.kind === "amend") {
      return { onAir: this.applyAmend(idea, steer.prompt), ended: undefined, amended: true };
    }
    const ended = this.scene;
    this.scene = {
      ideaId: idea.id,
      uid: idea.uid,
      name: idea.name,
      text: idea.text,
      prompt: steer.prompt,
      airedAt: this.now(),
      likes: 0,
      amends: [],
    };
    this.likedBy.clear();
    return { onAir: this.scene, ended, amended: false };
  }

  /**
   * Apply an amend to the scene it targeted, in place: only its prompt and `amends` list change,
   * so likes and karma keep tracking the original prompter. Callers must only reach this for an
   * amend `isStaleAmend` still says is live — index.ts drops any other before it is ever steered,
   * and only one steer is ever in flight, so the scene cannot change out from under an amend
   * between `beginSteer` and `resolveSteer`.
   */
  private applyAmend(idea: Idea, prompt: string): Scene {
    const scene = this.scene;
    if (!scene || scene.ideaId !== idea.forIdeaId || scene.amends.length >= MAX_AMENDS_PER_SCENE) {
      throw new Error(`amend idea ${idea.id} can no longer be applied to its scene`);
    }
    scene.prompt = prompt;
    scene.amends = [...scene.amends, { name: idea.name, text: idea.text }];
    return scene;
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
      now: this.scene ? { ...this.scene, karma: this.karmaOf(this.scene.uid) } : null,
      steering: steeringIdea
        ? { name: steeringIdea.name, text: steeringIdea.text, kind: steeringIdea.kind }
        : null,
      queue: this.queue
        .filter((idea) => idea.id !== this.pending?.ideaId)
        .map((idea) => ({
          id: idea.id,
          name: idea.name,
          text: idea.text,
          karma: this.karmaOf(idea.uid),
          kind: idea.kind,
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
