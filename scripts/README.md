# scripts

Fallback Node.js CLI entries for the harness commands. They mirror the interactive
slash commands (`/seed`, `/loop`, `/stop`, `/status`, `/doctor`) so the harness can be
driven from `npm run <cmd>` or `node scripts/<cmd>.js` outside an interactive Pi session
(e.g. from the loop orchestrator's `nohup` launch).

| File               | Status | Milestone |
|--------------------|--------|-----------|
| `seed.js`          | implemented | M2        |
| `loop.js`          | implemented | M6        |
| `stop.js`          | implemented | M6        |
| `status.js`        | stub   | M13       |
| `doctor.js`       | implemented | M1        |
| `stub.js`          | shared stub helper | — |

In the M0 skeleton every script is a `not implemented` stub that exits 0. Milestones
replace the stubs one by one (M1 replaced `doctor.js` with the real prerequisite
check — it exits non-zero if any required check fails). The `package.json` `scripts`
entries already point at these files.

The doctor CLI shares its check logic with the interactive `/doctor` command via
`extensions/doctor/core.js`, so both report identical results.
