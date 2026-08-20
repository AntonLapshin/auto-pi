# PR Policy

The contract every pull request must satisfy before it is merged (plan §17.6, §17.7).

## Creation (Engineer)

- **Branch naming:** `task/{issueNum}-{slug}` (e.g. `task/12-note-search`).
- **Link the issue:** the commit message and/or PR body must include
  `Closes #{issueNum}` so GitHub auto-closes the issue on merge.
- **PR body** includes a summary, a bullet list of changes, test evidence
  (`npm test`, `npm run test:coverage`, `npm run build`), and a checklist.
- **Labels:** `pi:review-needed` (unless review is skipped), plus `size:*`,
  `milestone:*`, and `type:*` matching the issue.
- Add the `<!-- pi:pr issue={issueNum} -->` marker so the Review Engineer can
  resolve the linked issue.

## Review (Review Engineer)

- A PR is "ready for review" when it carries `pi:review-needed` /
  `pi:review-requested` or reviewers are requested.
- The reviewer physically verifies (lint, tests, 100% core coverage, build,
  diff scoping) and posts `PI-REVIEW` comments or approves.

## Merge (Engineer)

Merge an approved PR **only when ALL of these hold**:

- The PR is **approved** (review state `approved` / label `pi:approved`).
- **CI passes** on the PR.
- No **unresolved testable comments** remain.
- No **merge conflict** (mergeable).
- The PR scope is valid (matches the issue; no unrelated changes).

If all hold, squash-merge and delete the branch:

```bash
gh pr merge {prNum} --repo {owner}/{repo} --squash --delete-branch
```

## Merge failure handling

- **Conflict** → label the PR `pi:conflict` and report it so the loop routes it
  for resolution.
- **Transient / repeated failure** → label `pi:merge-blocked` (and
  `pi:needs-human` on repeated failures) and stop — do not loop forever.
