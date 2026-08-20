# personas

Fresh-session persona prompts (markdown) used by the loop's dispatcher. Personas never
remember prior conversations — each invocation is a fresh Pi session.

| Milestone | Persona |
|-----------|---------|
| M7 | `pm.md` — Project Manager: breaks work into small tested issues |
| M8 | `engineer.md` — implements + tests + PRs |
| M9 | `review-engineer.md` — physical-evidence review |

Each persona runs inside a fresh session, with context injected from a file
(see M6 `persona-runner.js`).
