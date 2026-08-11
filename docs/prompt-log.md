# AI artifact — prompt log

## Initial implementation prompt

> "analyse the assessment of the project and implement"

The implementation was produced with ChatGPT as the coding copilot. The recruiter-provided assessment and demo were treated as the specification, then the current Google Gemini cookbook and official API documentation were checked before coding the Gemini adapter.

## Constraints fed back into implementation

- Do not copy the demo's `localStorage` state model.
- Do not use the demo's 8-second stuck threshold.
- Enforce the 2-character / 1-chapter caps on the backend.
- Do not auto-retry Gemini calls.
- Use current Gemini text/image model IDs through environment variables.
