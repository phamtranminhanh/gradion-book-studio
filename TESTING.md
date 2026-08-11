# Testing strategy

The test harness targets the behaviors that can create incorrect Gemini cost or corrupt resumability. It uses Node's built-in test runner and a deterministic `MockGeminiClient`, so the suite runs offline and never spends API quota.

## Backend

`tests/pipeline.test.js` covers the pipeline state machine plus filesystem persistence:

- a second start of the same running step is rejected before the runner can call Gemini;
- a later step cannot be started out of order;
- the happy path completes all five stages;
- mock Gemini deliberately returns 3 characters and 2 chapters, while the server persists only the required 2 / 1 caps;
- generated image files are actually written to disk;
- a simulated failure on the second portrait leaves the first portrait saved, and the retry skips it rather than paying for it again;
- a failed style retry reuses the already-uploaded book/file context instead of uploading the source again;
- a stranded `RUNNING` state can be recovered only after it becomes stale;
- projects are isolated by owner.

## Frontend

The browser itself is intentionally thin, so `tests/ui.test.js` tests the state-rendering functions that carry the most assessment risk rather than snapshotting every pixel:

- identity/project validation;
- project-list empty state;
- a running panel names the exact pipeline step and explains that refresh/tab duplication is guarded;
- a failed panel retries only the failed step and safely escapes error text;
- a stale run exposes recovery, not a second run button.

## Deliberately not tested

I did not add browser E2E automation, visual snapshots, or live Gemini tests. E2E is outside the required scope, visual snapshots would be brittle for a small take-home, and live Gemini tests would be slow, nondeterministic, and consume the candidate/reviewer quota. The REST adapter is kept small and follows Google's current request shapes; the state/cost logic around it is covered with the mock.

I also performed real local HTTP smoke runs in mock mode. The duplicate-start check served the app, returned HTTP 202 for the first `STYLE` request, returned 409 for an immediate duplicate, and then persisted step 1. A second end-to-end run drove `STYLE → CHARACTERS → PORTRAITS → CHAPTERS → ILLUSTRATIONS` through the HTTP API; every step advanced exactly once and the final project was `DONE` with 2 saved portraits and 1 saved chapter illustration.

## Real test report

The following is copied from a real `./test.sh` run on 2026-08-11:

```text
> gradion-book-illustration-studio@1.0.0 test
> node --test --test-reporter=spec tests/*.test.js

✔ server-side state guard blocks duplicate and out-of-order execution (22.489974ms)
✔ happy path persists all five steps and enforces 2-character / 1-chapter caps (49.64148ms)
✔ failed image step is retryable and keeps already-generated portrait (28.305705ms)
✔ retrying style after downstream failure does not re-upload the book context (13.963247ms)
✔ a stale running step can be explicitly recovered without data surgery (7.184288ms)
✔ project storage is isolated by owner (3.452693ms)
✔ identity and project forms reject missing input (0.722159ms)
✔ empty project state has a clear creation action (0.111905ms)
✔ running panel names the exact active step and duplicate-call behavior (0.75677ms)
✔ failed panel exposes retry for only the failed step and escapes the error (0.159136ms)
✔ stale running panel exposes recovery instead of a duplicate retry (0.165225ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 169.993551
```
