# Engineering Decisions

This file records the main decisions I made while building the Gradion Book Illustration Studio. I used ChatGPT as a coding assistant during the project, but I still reviewed the suggestions and changed some of them when I felt they did not fit the assessment well.

## 1. Keep the architecture small

At first, a more common full-stack setup such as React for the frontend, Express for the backend, and a database was considered. I decided not to use that approach because I felt it would add more setup than the project really needed.

The final project uses one Node.js process for the API and static frontend, while the browser side is built with plain JavaScript and CSS.

My main reason was that the difficult part of this assessment is not choosing a framework. The important part is making the five-step pipeline correct, resumable, and safe from duplicate Gemini calls. Using one small Node service also makes the project easier to run and easier for the reviewer to understand.

The disadvantage is that I had to write more of the HTTP handling and UI rendering myself. If this project became much larger, I would probably move the frontend to a component framework.

**AI override #1:** ChatGPT first considered a more conventional React + Express + database stack. I rejected it because I thought it was unnecessary for the size of this assessment.

---

## 2. Use local JSON files instead of a database

I chose local filesystem storage for users, sessions, project state, book text, and generated images.

For this project, I did not think a database was necessary. There are only a small number of local users and projects, and the application is not meant to be deployed as a multi-server production system.

Project JSON writes are done using a temporary file followed by rename, so the project file is not left half-written if something goes wrong during a write. I also use a per-project mutex when changing project state so two requests cannot update the same project at the same time.

The main limitation is that this locking approach only protects one Node process. If the system had multiple backend instances, I would replace this with a proper transactional database or another shared locking mechanism.

---

## 3. Separate completed progress from the currently running step

I did not want to store the whole pipeline using only one status value such as `PENDING`, `RUNNING`, or `DONE`.

Instead, I keep `completedStep` separately from the current `run` information.

For example, the project can correctly represent this situation:

```text
Portraits are already complete
Chapters is currently running
```

This is important when the user refreshes the page while a Gemini call is still running. The application still knows exactly which steps are safely completed and which step is currently active.

This makes the project state slightly more complicated, but I think it is much clearer and safer for resume/recovery behavior.

---

## 4. Prevent duplicate Gemini calls on the server

One important decision was that duplicate protection must be handled by the backend, not only by disabling a button in the browser.

A frontend-only solution would work for one normal click, but it would not fully protect against:

- double clicks
- refreshing the page
- opening the same project in another tab
- two requests reaching the backend almost at the same time

Before a Gemini step starts, the server locks the project and saves that step as `RUNNING`. If another request tries to start the same step, it sees that state and is rejected instead of making another Gemini request.

I considered this especially important because duplicate Gemini calls can waste API quota and can also create inconsistent results.

The downside is that if the server stops after saving `RUNNING`, the project could become stuck. Because of that, I also added stale-step recovery after a configured timeout.

**AI override #2:** A simpler browser-only duplicate guard was considered, but I rejected it because it did not protect against multiple tabs or simultaneous backend requests.

---

## 5. Save partial progress immediately

For portraits and illustrations, I decided not to wait until the whole step finishes before saving the result.

Each finished image is written to disk and the project state is updated immediately.

For example, if portrait 1 succeeds but portrait 2 fails, the successful first portrait is already stored. When the user retries the Portraits step, the application does not need to generate portrait 1 again.

This creates a few more filesystem writes, but there are at most two portraits and one chapter in this assessment, so the extra cost is very small. The benefit is that retries are cheaper and the user can see real progress.

---

## 6. Do not automatically retry Gemini calls

I decided that every Gemini request should only be attempted once for each user action.

If Gemini fails because of quota, network problems, or another API error, the step becomes `FAILED` and the error is shown to the user. The user can then decide whether to retry that step.

I did this because automatic retries could silently spend more API quota. It could also make it difficult to know how many actual attempts were made.

The implementation therefore uses direct REST calls to the Gemini Files API and Interactions API, and the model names are configurable through environment variables.

I originally considered using the official SDK because it is convenient, but the direct REST approach made the retry behavior more explicit and kept the integration small.

**AI override #3:** ChatGPT first considered using the SDK with its normal retry behavior. I changed this to single-attempt REST calls because the assessment specifically requires no automatic Gemini retries.

---

## 7. Upload the book once and reuse Gemini context

The book text should not be sent again for every pipeline step.

When the Style step starts, the book is uploaded once using the Gemini Files API and an initial interaction is created. Later text-generation steps reuse the previous interaction ID instead of sending the complete book again.

I also keep a separate image interaction chain for the portraits and chapter illustration. This helps the later images stay closer to the character appearances that were already generated.

This decision reduces unnecessary input tokens and also follows the intended flow of the provided book-illustration notebook.

---

## 8. Enforce the assessment limits on the backend

The assessment limits the result to a maximum of two adult characters and one chapter.

I enforce these limits on the backend instead of trusting only the frontend or the Gemini response.

The structured-output schema asks Gemini for the correct limits, but the server also applies its own final cap:

```text
Characters: maximum 2
Chapters: maximum 1
```

This means that even if Gemini unexpectedly returns more results, or if a modified client sends a different request, the server still keeps the project inside the assessment requirements.

---

## 9. Use a mock Gemini client for testing

I added a deterministic mock Gemini client so I could test the complete application without using API quota every time.

The mock follows the same pipeline interface as the real Gemini client, so the tests can still exercise:

- step ordering
- server-side limits
- duplicate execution protection
- failures and retries
- stale recovery
- partial portrait progress
- frontend states

I still treat the mock and the real Gemini API as different things. Passing the mock tests proves that the application logic works, but it does not guarantee that a real API account has enough quota or billing enabled.

---

## 10. Keep authentication simple for this assessment

I used a lightweight local identity based on name and email instead of building a full authentication system.

The purpose is only to separate users and make sure one user cannot access another user's projects. A production application would need proper authentication, secure cookies, password/OAuth handling, and stronger session security.

For this take-home assessment, I felt that implementing all of that would take time away from the pipeline behavior that is actually being evaluated.

---

## In the future

If I had more time, I would probably replace polling with Server-Sent Events so progress updates could appear immediately when a portrait or illustration finishes.

The current polling approach is simple and works correctly for this project, so I did not think adding real-time infrastructure was necessary before submission.

I would also do more testing with the real Gemini image model when API quota is available, especially around model errors and image-generation response formats.