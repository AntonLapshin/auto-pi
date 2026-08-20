# Testing Policy

Defines the testing contract every code change must satisfy (plan §19, §25).

## Requirements

- **Every change adds tests.** Never ship logic without a test covering it.
- **`src/core` is 100% covered** (`npm run test:coverage`). Business logic
  without full coverage is a review-blocking defect.
- **Run the full suite before opening a PR:**

  ```bash
  npm ci
  npm run lint
  npm test
  npm run test:coverage
  npm run build
  ```

  All must pass, with 100% core coverage.

## What to test

Test the core functions across these cases (the Review Engineer checks for them):

- empty / invalid input
- duplicates
- case sensitivity
- boundaries (min/max/off-by-one)
- error / async paths
- malformed data
- missing fields

## Review enforcement (plan §18.4)

The Review Engineer physically verifies each PR: it runs the verification
commands, inspects the diff, and checks that every new/changed core function has
tests covering the cases above. Missing tests → a `PI-REVIEW type=missing-tests
severity=blocking` comment.
