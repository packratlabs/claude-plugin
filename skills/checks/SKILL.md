---
name: checks
description: Draft the checks Packrat runs in production after a pull request deploys. Use before you open a pull request (gh pr create), or when the plugin's hook asks for a checks draft.
---

# Pull request checks

After a pull request deploys, Packrat runs its checks against production data and reports whether the change
did what it was for. You draft the checks once, before you open the pull request. The plugin's hook validates the
draft before `gh pr create` runs, and declares it under the pull request's number once `gh pr create` prints it.
The checks are not part of the pull request's description.

A check is a rule: SQL that returns one row, and conditions over that row. From the moment the deploy goes live,
Packrat runs the SQL every five minutes until the check's window ends. The conditions decide the result, so a
check can pass minutes after the deploy.

## Where the draft goes

Write the draft to `$(git rev-parse --path-format=absolute --git-common-dir)/packrat/checks/<branch>.json`,
where `<branch>` is `git branch --show-current`. The file is inside `.git`, so it is never committed.
Create the directory if it does not exist. When the hook stops `gh pr create`, it names the exact path.

## What to check

Write one check for each thing the change does, in the developer's terms: a filter is used, a job writes rows, a
page gets faster, an error stops. Do not add checks that nothing broke, such as "no new errors" or "p95 stays the
same": Packrat watches the app for those already. Write a check that something never happens only when that is
the change itself, such as "no raw email address in the log lines" for a redaction change.

If production cannot show the change at all, such as a change to docs or tests only, write
`{"none": "why production cannot show this change"}` instead.

## What a check holds

Read the tables and their columns before you write SQL: run `packrat open https://packrat.sh/docs/api.md` and use
its Schema section. Then look at a recent span or log line of the code you changed with `packrat sql`, because
attribute names differ between instrumentations (`http.target` in one app, `url.query` in another). Three
examples, one of each kind:

```json
[
  { "title": "Shoppers filter by Abercrombie",
    "claim": "At least one request to the shop grid filters by brands[]=abercrombie and answers below 500.",
    "sql": "SELECT count(*) AS seen, count(*) FILTER (WHERE json_extract_string(span_attributes, '$.\"http.target\"') LIKE '%brands%=abercrombie%') AS matched FROM packrat_spans(since := getvariable('deployed_at'), until := getvariable('until')) WHERE parent_span_id IS NULL AND kind = 2 AND name LIKE 'GET /colors%' AND try_cast(json_extract_string(span_attributes, '$.\"http.status_code\"') AS INTEGER) < 500",
    "pass_when": "matched >= 1",
    "window": "3d" },
  { "title": "No raw email in the logs",
    "claim": "No log line from the new version holds an email address outside an [email:…] token.",
    "sql": "SELECT count(*) AS seen, count(*) FILTER (WHERE regexp_matches(body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}')) AS violations FROM packrat_logs(since := getvariable('deployed_at'), until := getvariable('until')) WHERE json_extract_string(resource_attributes, '$.\"service.version\"') = getvariable('version')",
    "fail_when": "violations > 0",
    "min_seen": 1000,
    "window": "1d" },
  { "title": "The cart is faster",
    "claim": "The p95 of GET /cart is under 300 ms, down from about 840 ms.",
    "sql": "SELECT count(*) AS seen, quantile_cont(duration_ms, 0.95) AS p95_ms FROM packrat_spans(since := getvariable('deployed_at'), until := getvariable('until')) WHERE parent_span_id IS NULL AND name = 'GET /cart'",
    "pass_when": "p95_ms < 300",
    "fail_when": "p95_ms >= 300",
    "min_seen": 200,
    "window": "1d" }
]
```

- **`title`** names the result, in at most 80 characters: "The cart is faster", not the task.
- **`claim`** is what must be true, in a sentence a person reads.
- **`sql`** is one DuckDB statement that returns exactly one row. Its `seen` column counts the chances the
  changed code had to show the claim: the requests to the route, the runs of the job. **Count in `seen` only
  the rows that carry what the check reads**, so a misspelled attribute leaves `seen` at 0 instead of passing
  a check that measured nothing. Give each other column the name a condition uses.
- The SQL reads these variables: `getvariable('deployed_at')` (when the deploy went live),
  `getvariable('until')` (the moment of the run), `getvariable('version')` (the deployed `service.version`),
  and `getvariable('baseline_since')` and `getvariable('baseline_until')` (the same hours a week before). Bound
  every macro by them.
- **`pass_when`** alone passes the check on the first run where it holds: something the change does appears.
- **`fail_when`** alone fails it on the first run where it holds, and passes it when the window ends.
- **Both** judge it once, on the first run where `seen` reaches `min_seen`: a measure. Give the number the claim
  needs, never "faster" or "the same".
- **`min_seen`** is how large `seen` must be before a condition is judged. Default 1. A check that never reaches it
  ends inconclusive: the code did not run enough to tell.
- **`window`** is how long after the deploy the check stays open: `10m`, `1h`, `1d`, up to `30d`. Default `1h`.
  Use the time the code needs to run enough, such as the next run of a daily job or a weekday's traffic.
- **`at_end`** is the result when the window ends and nothing decided it. Default `passed` for a check with only
  `fail_when`, `inconclusive` otherwise.

Say a status is below 500 unless the change is about a status code: a client's 401 is not a failure of the change.

A pull request holds at most 10 checks.

## Draft once, before the pull request

Draft the checks when the change is ready to open, from the whole diff, not after each edit. If no data
production records would show a result, add the instrumentation first, such as an OpenTelemetry span
attribute that records the outcome (the number of rows a job wrote, or the code path a request took), and
commit it on the same branch. The instrumentation then ships with the change, and the checks have data
from the first run. An attribute the change adds is missing before the deploy; that is expected.

Check a draft yourself with `packrat pr checks set --dry-run --file <draft>`. Packrat runs each check's SQL once:

- **A check whose SQL fails** is refused with what DuckDB said. Fix it and try again.
- **A check that already passes before the deploy** is kept with a warning: passing would prove nothing. Make it
  read only what the change adds, such as the new attribute or `getvariable('version')`.

If a check is still refused after two attempts, stop changing it. Send it in the draft as
`{"title": "…", "claim": "…", "sql": "…", "dropped": "what Packrat said, and why you stopped"}`. It never runs;
the pull request's page lists it, and Packrat records it so the skill can be improved. Tell the user which check
you dropped and why.

## Changing the checks

Until a deploy ships the pull request, edit the draft and run `packrat pr checks set <number> --file <draft>`.
Sending again replaces the list. After the deploy, add a check with `packrat check add --pull <number>`, which
reads one check in the same shape on stdin.
