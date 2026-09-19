import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // telegram.ts builds the Telegram adapter at import time, which requires a bot token to be
    // set. This is a fake, never a live token: sendDM's production path is only ever exercised
    // through injected fakes in tests, not this adapter.
    env: { TELEGRAM_BOT_TOKEN: "test-token" },
  },
});
