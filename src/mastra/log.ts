// Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code
// Shared structured logger for src/mastra/*.ts. Import `{ log }` from here, never from index.ts
// (index.ts imports this module, so that direction would be circular).
import { ConsoleLogger } from "@mastra/core/logger";

export const log = new ConsoleLogger({ name: "polsTV", level: "info" });
