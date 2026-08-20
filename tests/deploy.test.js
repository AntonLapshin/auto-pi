/**
 * M4 deploy.js tests.
 *
 * Verifies the GitHub Pages deployment helpers: reading the latest workflow run
 * status, classifying it, detecting failures, and creating/updating the
 * `pi:needs-human` + `pi:blocked` + `type:infra` issue instead of retrying
 * forever. Uses a fake `gh` runner so no network I/O is involved.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEPLOY_WORKFLOW_FILE,
  PAGES_ISSUE_LABELS,
  PI_HUMAN_MARKER,
  REASON_PAGES_DEPLOYMENT_FAILED,
  getLatestWorkflowRun,
  deploymentFailed,
  checkDeploymentStatus,
  findNeedsHumanIssue,
  buildNeedsHumanBody,
  createOrUpdateNeedsHumanIssue,
  handlePagesDeployment,
} from "../extensions/seed/deploy.js";

/** Build a fake `gh` runner that delegates to a per-call handler map. */
function fakeGh(handler) {
  return async (args) => {
    const cmd = args[0];
    if (handler[cmd]) return handler[cmd](args);
    return { ok: true, stdout: "", stderr: "" };
  };
}

const RUNS_JSON = JSON.stringify([
  {
    databaseId: 12345,
    status: "completed",
    conclusion: "failure",
    headBranch: "main",
    createdAt: "2026-08-19T00:00:00Z",
    displayTitle: "Deploy to GitHub Pages",
  },
]);

test("getLatestWorkflowRun reads the latest deploy run", async () => {
  let calledArgs = null;
  const gh = fakeGh({
    run: (args) => {
      calledArgs = args;
      return { ok: true, stdout: RUNS_JSON };
    },
  });
  const res = await getLatestWorkflowRun("octocat", "notes-app", gh);
  assert.equal(res.ok, true);
  assert.equal(res.run.databaseId, 12345);
  assert.equal(res.run.conclusion, "failure");
  // Uses the Pages deploy workflow path.
  assert.ok(calledArgs.includes("--workflow"));
  assert.ok(calledArgs.includes(DEPLOY_WORKFLOW_FILE));
  assert.ok(calledArgs.includes("octocat/notes-app"));
});

test("getLatestWorkflowRun returns null when there are no runs", async () => {
  const gh = fakeGh({ run: () => ({ ok: true, stdout: "[]" }) });
  const res = await getLatestWorkflowRun("octocat", "notes-app", gh);
  assert.equal(res.ok, true);
  assert.equal(res.run, null);
});

test("getLatestWorkflowRun reports gh failures", async () => {
  const gh = fakeGh({ run: () => ({ ok: false, stderr: "boom" }) });
  const res = await getLatestWorkflowRun("octocat", "notes-app", gh);
  assert.equal(res.ok, false);
  assert.match(res.error, /boom/);
});

test("deploymentFailed only flags completed failing runs", () => {
  assert.equal(deploymentFailed(null), false);
  assert.equal(deploymentFailed({ status: "in_progress", conclusion: "" }), false);
  assert.equal(
    deploymentFailed({ status: "completed", conclusion: "success" }),
    false,
  );
  assert.equal(
    deploymentFailed({ status: "completed", conclusion: "failure" }),
    true,
  );
  assert.equal(
    deploymentFailed({ status: "completed", conclusion: "cancelled" }),
    true,
  );
});

test("checkDeploymentStatus classifies states", async () => {
  const mkGh = (run) =>
    fakeGh({ run: () => ({ ok: true, stdout: JSON.stringify(run ? [run] : []) }) });

  const success = await checkDeploymentStatus("o", "r", mkGh({ status: "completed", conclusion: "success" }));
  assert.equal(success.state, "success");

  const failed = await checkDeploymentStatus("o", "r", mkGh({ status: "completed", conclusion: "failure" }));
  assert.equal(failed.state, "failed");

  const inProgress = await checkDeploymentStatus("o", "r", mkGh({ status: "in_progress", conclusion: "" }));
  assert.equal(inProgress.state, "in_progress");

  const notRun = await checkDeploymentStatus("o", "r", mkGh(null));
  assert.equal(notRun.state, "not_run");
  assert.equal(notRun.run, null);
});

test("buildNeedsHumanBody embeds the marker, labels and reason", () => {
  const body = buildNeedsHumanBody({
    owner: "octocat",
    repo: "notes-app",
    run: { databaseId: 99, headBranch: "main", conclusion: "failure" },
  });
  assert.ok(body.includes(PI_HUMAN_MARKER), "body carries the PI-HUMAN marker");
  assert.ok(body.includes(REASON_PAGES_DEPLOYMENT_FAILED), "body logs the failure reason");
  assert.match(body, /octocat\/notes-app/);
  assert.match(body, /#99/);
  assert.match(body, /private repo/i);
});

test("findNeedsHumanIssue locates the marker issue and ignores others", async () => {
  const gh = fakeGh({
    issue: () => ({
      ok: true,
      stdout: JSON.stringify([
        { number: 1, title: "Something else", body: "no marker", url: "https://x/1" },
        {
          number: 2,
          title: "GitHub Pages deployment failed — needs human attention",
          body: `${PI_HUMAN_MARKER}\n\nPages deployment failed`,
          url: "https://x/2",
        },
      ]),
    }),
  });
  const res = await findNeedsHumanIssue("octocat", "notes-app", gh);
  assert.equal(res.ok, true);
  assert.equal(res.issue.number, 2);
});

test("createOrUpdateNeedsHumanIssue creates a new issue with labels", async () => {
  const calls = [];
  const gh = fakeGh({
    issue: (args) => {
      calls.push(args);
      if (args[1] === "list") return { ok: true, stdout: "[]" };
      if (args[1] === "create") return { ok: true, stdout: "https://github.com/octocat/notes-app/issues/7\n" };
      return { ok: true, stdout: "" };
    },
  });
  const res = await createOrUpdateNeedsHumanIssue("octocat", "notes-app", gh, {
    run: { databaseId: 5, headBranch: "main", conclusion: "failure" },
  });
  assert.equal(res.ok, true);
  assert.equal(res.created, true);
  assert.equal(res.issue.number, 7);
  // The create call carries all three labels.
  const createArgs = calls.find((a) => a[1] === "create");
  const labelIdx = createArgs.indexOf("--label");
  assert.ok(labelIdx !== -1, "create call includes --label");
  for (const label of PAGES_ISSUE_LABELS) {
    assert.ok(createArgs[labelIdx + 1].includes(label), `labels include ${label}`);
  }
});

test("createOrUpdateNeedsHumanIssue updates an existing issue (no duplicate)", async () => {
  const calls = [];
  const gh = fakeGh({
    issue: (args) => {
      calls.push(args);
      if (args[1] === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            { number: 3, title: "GitHub Pages deployment failed — needs human attention", body: PI_HUMAN_MARKER },
          ]),
        };
      }
      if (args[1] === "edit") return { ok: true, stdout: "" };
      return { ok: true, stdout: "" };
    },
  });
  const res = await createOrUpdateNeedsHumanIssue("octocat", "notes-app", gh);
  assert.equal(res.ok, true);
  assert.equal(res.created, false, "updates, does not create a duplicate");
  assert.equal(res.issue.number, 3);
  assert.ok(calls.some((a) => a[1] === "edit"), "edits the existing issue");
  assert.ok(!calls.some((a) => a[1] === "create"), "does not create a new issue");
});

test("createOrUpdateNeedsHumanIssue supports dry-run", async () => {
  const gh = fakeGh({
    issue: (args) => {
      if (args[1] === "list") return { ok: true, stdout: "[]" };
      return { ok: true, stdout: "" };
    },
  });
  const res = await createOrUpdateNeedsHumanIssue("octocat", "notes-app", gh, { dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(res.created, true);
  assert.equal(res.issue.number, 0);
});

test("handlePagesDeployment converges on one issue for a persistent failure", async () => {
  // First cycle: list finds nothing, create succeeds.
  let listCount = 0;
  let created = false;
  const gh = fakeGh({
    issue: (args) => {
      if (args[1] === "list") {
        listCount += 1;
        return { ok: true, stdout: created ? JSON.stringify([{ number: 9, title: "GitHub Pages deployment failed", body: PI_HUMAN_MARKER }]) : "[]" };
      }
      if (args[1] === "create") {
        created = true;
        return { ok: true, stdout: "https://github.com/octocat/notes-app/issues/9\n" };
      }
      if (args[1] === "edit") return { ok: true, stdout: "" };
      return { ok: true, stdout: "" };
    },
    run: () => ({
      ok: true,
      stdout: JSON.stringify([{ databaseId: 1, status: "completed", conclusion: "failure", headBranch: "main" }]),
    }),
  });

  // First cycle creates the issue.
  const first = await handlePagesDeployment("octocat", "notes-app", gh);
  assert.equal(first.state, "failed");
  assert.equal(first.handled, true);
  assert.equal(first.issue.number, 9);

  // Second cycle (still failing) updates rather than creating another.
  const second = await handlePagesDeployment("octocat", "notes-app", gh);
  assert.equal(second.state, "failed");
  assert.equal(second.handled, true);
  assert.equal(second.issue.number, 9);
  assert.equal(listCount, 2, "checks for an existing issue each cycle");
  // Only one create happened across both cycles → no unbounded retry spam.
});

test("handlePagesDeployment does nothing when the deployment is healthy", async () => {
  let issueCalls = 0;
  const gh = fakeGh({
    issue: () => {
      issueCalls += 1;
      return { ok: true, stdout: "[]" };
    },
    run: () => ({
      ok: true,
      stdout: JSON.stringify([{ databaseId: 2, status: "completed", conclusion: "success", headBranch: "main" }]),
    }),
  });
  const res = await handlePagesDeployment("octocat", "notes-app", gh);
  assert.equal(res.ok, true);
  assert.equal(res.state, "success");
  assert.equal(res.handled, false);
  assert.equal(issueCalls, 0, "no issue work for a successful deployment");
});
