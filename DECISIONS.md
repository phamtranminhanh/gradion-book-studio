# Engineering decisions

> **Candidate review note:** this file is an AI-assisted factual draft based on the implementation session. The assessment asks for decisions in the candidate's own words. Before submitting, read the code, challenge these choices yourself, and rewrite any sentence that does not reflect a decision you personally reviewed. Do not claim an override you did not make.

## One Node process and no framework dependencies

ChatGPT initially considered a conventional React + Express + database stack because it is a familiar full-stack default. After reading the “keep it simple and lean” requirement, the implementation deliberately moved the other way: Node's built-in HTTP server, browser ES modules, and plain CSS. The main reason is that the assessed complexity is pipeline correctness, not routing/build-tool setup, and one process makes the start command and local filesystem behavior very easy to review. The cost is less framework ergonomics and more hand-written HTTP/rendering code; if the UI grew beyond this bounded assessment, I would introduce a component framework rather than keep expanding string templates. **AI override #1: rejected the initially overbuilt stack.**

## JSON files with atomic writes instead of a database

The first implementation question was whether resumability automatically implied SQLite/Postgres. It does not at this scope. Each project is an isolated JSON document, the source text and images already have to live on disk, and writes go through a per-key mutex plus temp-file/rename atomic replacement. This keeps the persisted state inspectable during review and avoids a migration layer for a handful of local entities. The accepted limit is important: the mutex protects one Node process, not several processes sharing a directory. A production multi-instance service would need a real transactional store or cross-process locking.

## Separate durable completion from active run state

A single project `status` value looked simpler at first, but it cannot represent both “which prefix of the five steps is safely complete” and “what is happening right now.” The implementation therefore stores `completedStep` separately from `run.state/run.step/run.startedAt/run.attempt`. UI status is derived. This is what makes a refresh during Chapter generation unambiguous: Portraits can remain durably complete while Chapters is still `RUNNING`. The cost is a slightly richer invariant that the state-machine tests must protect.

## The duplicate guard belongs on the server, before Gemini

The supplied demo prevents a second click inside one browser state. That is useful UX but not cost protection: another tab, a refresh, or two near-simultaneous requests can bypass it. The implementation writes the `RUNNING` marker while holding the project's server-side mutex **before** scheduling the external call; a competing request sees that marker and gets HTTP 409. I rejected an AI temptation to rely on disabling the button/polling state because that would only make the race less visible, not correct. The trade-off is that a process crash can leave `RUNNING` persisted, so the same design also needs explicit stale recovery. **AI override #2: browser-only duplicate protection was rejected as unsafe for API cost.**

## Persist external checkpoints and partial images immediately

It would be simpler to hold a whole step's result in memory and write once at the end. That is wrong for the resume requirement. The upload URI, initial book interaction ID, style/character interaction IDs, image-chain ID, and each image URL are saved as soon as they exist. If portrait 2 fails after portrait 1 succeeded, retry skips portrait 1 and continues from persisted state. The extra writes are trivial at a maximum of two portraits and one chapter, while the benefit is less duplicate Gemini spend and visible per-item progress.

## Direct REST calls, and explicitly no automatic retry

ChatGPT first attempted to use the official `@google/genai` package. Package installation was not reliable in the build environment, and the assessment explicitly notes that the notebook's calls can be mapped to documented REST endpoints. The implementation therefore uses `fetch` against the Files API and Interactions API, while keeping model IDs in environment variables. This also made one assessment-specific override obvious: Google's notebook configures SDK HTTP retries, but this assessment says Gemini calls must never be auto-retried. The REST adapter makes exactly one request per user-triggered attempt and surfaces errors back into the persisted failed state. The cost is maintaining a small amount of request/response parsing ourselves. **AI override #3: SDK/automatic-retry behavior was replaced with single-attempt REST calls.**

## If I had one more day

I would add Server-Sent Events for project updates. Polling every 1.5 seconds is intentionally simple and correct here, but SSE would make portrait/illustration arrival immediate, reduce redundant detail requests, and give the UI a cleaner path for future attempt-history events without changing the pipeline state model.
