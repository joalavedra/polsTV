# Defence

Norma scanned `feat/skeleton` on Sunday morning and reported 133 findings under Scalability and
21 under Manageability. We took the first batch of ten from each, fixed them, pushed, and
rescanned. Below is what we changed, what we left alone, and our reasons.

Score before: __ / after: __

Every fix has the comment Norma asks for next to it:
`// Recommended by Norma — fixed with Claude Sonnet 5 via Claude Code`.
`grep -rn "Recommended by Norma" src spike` lists all 50.

## 1. What we fixed

### Awaits with no error handling (Scalability, 10 findings)

Five were in server code, and we would have wanted these fixed even without a scanner.

- `vonage.ts`, `videoAccess()`. When the Vonage session can't be created, the error now says
  which token was being issued (publisher or subscriber) and keeps the original error as its
  cause. Before, you got a raw SDK error with no hint of who had asked for what.
- `index.ts`, the `/say` route. `handleSay` already turns the failures we expect into 4xx and 503
  answers. Anything we didn't expect used to surface as a plain-text 500 that the viewer page
  can't parse. Now it is logged with the viewer's uid and answered as `{ ok: false, reason }`,
  the shape the page already shows to the user.
- `telegram.ts`, photo intake. If handling a photo failed, the person got no reply, which on
  Telegram looks like a dead bot. The failure is now logged and the bot answers "Something went
  wrong with that photo. Try again."
- `showrunner.ts`, `writeAmend()`. A failed Nebius call is rethrown with the amendment text
  attached. It still throws, because the caller relies on that to report the steer as failed.
- `announcer.ts`, `synthesise()`. A network failure or timeout talking to SLNG, a bad HTTP
  status, and a response body that failed to download are now three different errors, and each
  names the clip. We added a test for the network case and confirmed it fails when the fix is
  taken out.

The other five were in test files (`say.test.ts`, `telegram.test.ts`, `eval.test.ts`). We wrapped
them so the rescan passes, and made each catch rethrow with the name of the call that rejected,
so a failing test says more than it did. Section 3 explains why we stopped at five.

### console calls and hardcoded localhost (Manageability, 10 findings)

- Logging. We did not add pino or winston. Mastra already ships a logger, so there is one small
  file, `src/mastra/log.ts`, and all 26 `console.*` calls in the server code go through it, not
  only the eight Norma listed. The same logger is handed to Mastra, so framework lines and our
  lines come out of one place. We kept every message's text identical because we grep the
  production log for lines like `slng_tts ms=`. What this buys is modest. Mastra's console
  logger gives us levels and a single place to swap in a JSON transport later. It does not give
  us JSON lines today.
- `PUBLIC_URL`. `index.ts` and `telegram.ts` both fell back to `http://localhost:4111` when the
  variable was missing. In production that would have put a localhost link into Telegram
  messages and link previews, and nothing would have told us. There is now one function, no
  fallback, and a missing value fails the first time it is needed with "PUBLIC_URL is missing.
  Add it to .env (see .env.example)." The local value lives in `.env.example`. A new test covers
  both the unset and the set case.
- `spike/server.mjs`. One `console.log` in a throwaway script, replaced with
  `process.stdout.write`.

## 2. What we didn't fix

1. The remaining 123 "await without try/catch" findings.
2. The two token routes, `/viewer-token` and `/b/:secret/publisher-token`. They still answer a
   bare 500 if Vonage is down.
3. The global handler for unhandled promise rejections that Norma suggests.
4. The `console` calls in the two browser pages, `index.html` and `broadcaster.html`.
5. Everything else in `spike/`.

We expect the other 11 Manageability findings to clear on the rescan, since the logging change
covered every `console.*` call in the server and not only the listed ones. We haven't seen that
rescan yet, so we list it here as unconfirmed.

## 3. Why

**The remaining await findings.** We counted the awaits in the repo: 84 are in test files and 68
are in server code. In a test, `const outcome = await handleSay(...)` with no try/catch is
correct. If the promise rejects, vitest fails the test and prints the error, and that is the
behaviour we want. Wrapping it adds six lines and no safety. We did five to confirm that the
rescan recognises the fix, then stopped, because sixty more would make the tests harder to read
in exchange for a better number. If Norma can skip `*.test.ts` for this rule, that is the fix we
would choose.

In the server code, many of the flagged awaits sit inside functions that are supposed to throw.
`moderate()` is the clearest case. It fails closed: if Nebius is down, the idea is refused, and
`say.ts` turns that throw into a 503 with a message for the viewer, in one place. A second
try/catch inside `moderate()` would handle the same error twice or, worse, swallow it. Our rule
is that an error gets handled once, at the boundary that can do something useful with it. The
five we fixed were boundaries that weren't doing that yet.

**The token routes.** This one is a real gap and a small one. If Vonage is down nobody can
watch anyway, but the route should answer a 503 with a reason. We ran out of time before the
freeze.

**The global rejection handler.** We decided against it. Node exits on an unhandled rejection,
and our supervisor brings the server back about three seconds later (in the Docker image the
platform restarts the container). A handler that logs and carries on would keep a process
running in a state nobody designed for. A crash and a clean restart is easier to reason about.

**The browser pages.** The broadcaster runs in a headless tab that nobody can open. Its
`console` output is piped into the server log on purpose, with Chrome's
`--enable-logging=stderr`, and that log is the only view we have into that tab. Both pages are
single files with no build step, so a logging library there would mean a bundler or a CDN
script for a worse result.

**spike/.** It is Saturday's feasibility script for the video model. Nothing imports it and it
is not deployed. We fixed the line Norma flagged and left the rest as a record of the spike.
