# Architecture notes

## State model

Each project has two independent pieces of progress:

- `completedStep` — integer `0..5`, the durable prefix of successfully completed pipeline steps.
- `run` — transient-but-persisted execution state: `IDLE | RUNNING | FAILED`, the active step, start time, attempt count, and last error.

The display status (`DRAFT`, `IN_PROGRESS`, `DONE`) is derived rather than stored.

## Start invariant

A step may begin only when all of these are true inside the project's keyed write lock:

1. The project belongs to the current user.
2. The requested step equals `STEP_KEYS[completedStep]`.
3. No non-stale run is already `RUNNING`.
4. If the previous run failed, it failed on this same expected step.

The `RUNNING` marker is written to disk before the pipeline runner is scheduled. This is the duplicate-call barrier shared by every browser tab.

## Completion invariant

A runner can mark a step complete only when that exact step is still the persisted active run and its ordinal equals `completedStep + 1`. It then increments `completedStep` and returns the run to `IDLE`.

A failure instead writes `FAILED` and preserves the existing `completedStep` and generated outputs.

## Crash / stale recovery

If the process dies after writing `RUNNING` but before it can finish/fail, the project will still look active after restart. The server never guesses that the external Gemini call failed immediately. Once `startedAt` is older than `STALE_STEP_MS` (default five minutes), the API/UI offers explicit recovery. Recovery only clears the run marker; it does not delete any already-persisted output.

## Partial image progress

Portrait and illustration loops persist after **every item**:

```text
generate image -> write bytes -> store public URL + new interaction id -> next item
```

On retry, items with an existing URL are skipped. This is both a UX feature (the browser sees images arrive during polling) and a cost-control feature (a failure on item 2 does not regenerate item 1).

## Gemini context graph

```text
book.txt -> Files API -> book interaction
                         │
                         ▼
                    style interaction
                         │
                         ▼
                 characters interaction ───► chapters interaction

style text -> image context -> portrait 1 -> portrait 2
                                           │
                                           ▼
                              chapter-image context -> illustration 1
```

The text and image histories are deliberately separate, matching the reference notebook. Project JSON persists the relevant interaction IDs so a later HTTP request can continue the same chain instead of resending the source book.

## Storage safety

JSON files are written to a unique temporary file and renamed into place. Within one process, a keyed promise mutex serializes mutations for the same project (and the shared user/session files), preventing overlapping read-modify-write cycles.

The accepted limitation is that this is not a multi-process storage engine. Running multiple Node server processes against the same `DATA_DIR` would require an OS-level file lock or a database. The assessment calls for one local stack, so that extra machinery is intentionally omitted.
