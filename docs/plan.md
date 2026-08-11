# Implementation plan

1. Preserve the supplied demo's four user surfaces: identity, project list, new project, project detail.
2. Build a filesystem repository with atomic writes and an in-process keyed mutex.
3. Model pipeline progress independently from project display status.
4. Add a server-side compare-and-set start gate so two tabs cannot start the same Gemini step.
5. Implement Google's notebook mechanics with the Interactions API and File API:
   - upload the `.txt` book once,
   - create a book interaction containing the document URI,
   - chain text interactions with `previous_interaction_id`,
   - request structured JSON for characters and chapters,
   - run a separate image interaction chain for portraits and chapter illustrations.
6. Persist each portrait/illustration immediately so the UI can reveal per-item progress.
7. Add explicit failed/stale recovery states and user-triggered retry only.
8. Test the state machine, caps, duplicate prevention, partial progress, and key UI render states.
