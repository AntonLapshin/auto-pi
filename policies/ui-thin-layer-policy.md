# UI Thin-Layer Policy

The UI must stay a thin, dumb layer over the pure core (plan §17.3, §19).

## Rules

- **No business logic in the UI.** `src/ui/components` render props and call
  callbacks; they never implement rules, validation, filtering, or state
  transitions.
- **View models are thin.** `src/ui/viewModels` bind core functions to component
  state; they contain no business rules.
- **All business logic lives in `src/core`** — pure, framework-free, and 100%
  covered.
- **Impure I/O lives in `src/adapters`** (storage, fetch, external APIs), never
  in core.

## Why

Keeping the UI thin makes the business logic fully testable (100% core coverage)
and keeps the UI swappable. Business logic in the UI is a review-blocking defect:
the Review Engineer raises `PI-REVIEW type=ui-business-logic` when it is found.
