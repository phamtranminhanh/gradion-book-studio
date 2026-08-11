# AI coding context

This repository implements the Gradion Intern Fullstack Developer take-home assessment.

## Source of truth
- `gradion-assessment-intern-software-engineer.md` supplied by the recruiter.
- `app-demo.html` supplied by the recruiter for UI scope/behavior.
- Google's `Book_illustration.ipynb`, steps 1–5 only.

## Non-negotiables
- Five user-triggered steps: Style → Characters → Portraits → Chapters → Illustrations.
- Main adult characters only, hard cap 2 server-side.
- Chapter prompt hard cap 1 server-side.
- Book content is sent to Gemini once; later text steps chain by interaction id.
- Duplicate execution is prevented on the server, not only in the browser.
- Partial image progress is persisted after each item.
- Failed steps retry only that step. No automatic Gemini retries.
- A stranded running step can be explicitly recovered after the stale threshold.
- Book text and images stay on local disk and are served by this application.
- Keep the architecture small; no deployment, queues, Redis, or cloud storage.

## Coding expectations
- Node 22+, ESM.
- Prefer built-in Node APIs except the official `@google/genai` SDK.
- Atomic JSON writes (temp file + rename) and keyed mutexes for write coordination.
- Tests must not call Gemini; use a deterministic fake.
