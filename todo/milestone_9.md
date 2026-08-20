# Milestone 9: Review Engineer Persona

**Depends on:** Milestone 8
**Reference:** plan.md §18, §19, §22, §28 "Milestone 9"

## Goal

Implement the Review Engineer persona: PR verification with physically verifiable evidence, missing-test detection, and approve/request-changes flow.

## Tasks

- [x] Write `personas/review-engineer.md` persona prompt (plan.md §18; verify against testing policy §25.2, ui-thin-layer §25.3, done-definition §25.4).
- [x] Implement Reviewer context packer: PR diff summary, PR body, linked issue, acceptance criteria, test output, coverage output, relevant policy excerpts (plan.md §21.1).

### Verification commands
- [x] Run, per PR:
  ```bash
  npm ci
  npm run lint
  npm test
  npm run test:coverage
  npm run build
  ```
- [x] Enforce 100% core coverage (plan.md §19).

### Review rules
- [x] Allowed review reasons (plan.md §18.1): failing tests, missing tests, missing acceptance coverage, broken build, lint failure, coverage failure, business logic in UI, unsafe dependency, secret-like strings, incorrect core behavior.
- [x] Disallow subjective/style/visual comments.
- [x] Every comment follows `PI-REVIEW type=... severity=blocking|...` format with verification command, expected outcome, and location (plan.md §18.3).
- [x] Missing-test detection across cases: empty/invalid input, duplicates, case sensitivity, boundaries, error/async paths, malformed data, missing fields (plan.md §18.4).
- [x] Optionally create follow-up "Add missing tests for PR #N" issues.

### Approval conditions (plan.md §18.5)
- [x] Approve only when: ci/lint/test/coverage/build all pass, core coverage 100%, PR scoped to issue, acceptance criteria covered, no unresolved testable comments, no security/secrets.
- [x] On approve: approve PR, add `pi:approved` + `pi:merge-ready`, remove `pi:review-needed` + `pi:changes-requested`.
- [x] On issues: request changes, add `pi:changes-requested`, remove `pi:review-needed`.
- [x] Respect `config.review.reviewerCanPushTestCommits` (default `false`) for role separation.

## Acceptance Criteria

- Reviewer leaves only physically verifiable comments (all `PI-REVIEW` format).
- Reviewer detects missing core tests.
- Reviewer approves only when all checks pass and acceptance criteria are covered.
