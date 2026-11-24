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

In a git worktree, your file tools cannot write to that directory, because it is outside the worktree. Write
the draft to a file inside the worktree or your scratch space, then let the CLI keep it:

```bash
packrat pr checks draft --file <your draft>
```

It prints the path it wrote. Do not copy the file there another way.

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
attribute names differ between instrumentations (`http.target` in one app, `url.query` in another).

Ask about requests and jobs in `packrat_traces`: one row for each, up to the present minute, with `unit` (the
route or job class), `duration_ms`, `http_status_code`, `error`, `spans` and the request's own
`span_attributes`. Packrat runs a check's SQL over its whole window to validate the draft, and every five minutes
after the deploy, so a check that reads `packrat_spans` for a day reads every span of that day each time. Use
`packrat_spans` only for a span that is not a request or a job, such as a query inside one. Three examples, one
of each kind:

```json
[
  { "title": "Shoppers filter by Abercrombie",
    "claim": "At least one request to the shop grid filters by brands[]=abercrombie and answers below 500.",
    "sql": "SELECT count(*) AS seen, count(*) FILTER (WHERE json_extract_string(span_attributes, '$.\"http.target\"') LIKE '%brands%=abercrombie%') AS matched FROM packrat_traces(since := getvariable('deployed_at'), until := getvariable('until')) WHERE kind = 'web' AND unit LIKE 'GET /colors%' AND http_status_code < 500",
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
    "sql": "SELECT count(*) AS seen, quantile_cont(duration_ms, 0.95) AS p95_ms FROM packrat_traces(since := getvariable('deployed_at'), until := getvariable('until')) WHERE kind = 'web' AND unit = 'GET /cart'",
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
  ends inconclusive: the code did not run enough to tell. **Size it from the traffic.** Before you choose it, count
  the route or job over the last week with `packrat sql`, without the attribute the change adds (which counts 0
  before the deploy), and choose a `min_seen` and `window` that traffic reaches comfortably: a page served about 300
  times a day cannot reach 500 in `1d`.
- **`window`** is how long after the deploy the check stays open: `10m`, `1h`, `1d`, up to `30d`. Default `1h`.
  Use the time the code needs to run enough, such as the next run of a daily job or a weekday's traffic.
- **`at_end`** is the result when the window ends and nothing decided it. Default `passed` for a check with only
  `fail_when`, `inconclusive` otherwise.

Say a status is below 500 unless the change is about a status code: a client's 401 is not a failure of the change.

A pull request holds at most 10 checks.

## A change to a page

When the change alters what a page shows or does (a view, a stylesheet, a JavaScript controller), check what
visitors did on the page. Browser events show:

- **Clicks, JavaScript errors, the page's requests and where people go next**, in `packrat_replay_events`: one row
  for each page view, click, request and error, with `kind`, `detail` (what it is about), `url` (the page it
  happened on), `version`, `device` (`desktop`, `mobile`, `tablet` or `bot`) and `viewport_width`. A session's rows
  share a `replay_id`, so its `page` rows in order are the pages it went through.
- **How fast the page is**, from its view spans in `packrat_spans`: `scope_name = 'packrat.browser'`, named by the
  page's path, with `browser.web_vital.lcp.value`, `.cls.value` and `.inp.value` in `span_attributes`. A view's span
  arrives about six minutes after the visitor leaves the page.

First find out whether the page sends browser events. Count its views over the last week:

```sql
SELECT count(*) AS views FROM packrat_replay_events(since := now() - INTERVAL 7 DAY)
WHERE kind = 'page' AND url LIKE '%/settings%'
```

For a new page, count a page the same controller already renders.

- **The page has views:** write the check on browser events. Count in `seen` the views of the changed page on the
  deployed version, and size `min_seen` from the views you counted.
- **It has none:** the app sends no browser events, or not from this page. Check the request the change makes in
  `packrat_traces` instead. If it makes none, declare `{"none": "…"}` and say the page sends no browser events. Do
  not turn browser events on in the pull request: which pages send them is the developer's choice.

A click's `detail` names the element by its tag, its id and its text, such as `button#export "Export"`. An element
with no id is named by the nearest ancestor that has one, so give the element the change adds an `id`, and match on
it. Look at a recent click on the page with `packrat sql` to see how its elements are named.

- `click`: people used what the change added.
- `rage click`: an element pressed five times or more with nothing happening. Strong evidence something is broken.
- `error click`: a click followed by a JavaScript error.
- `dead click`: weak evidence on its own, because some clicks the page did answer are reported as dead. Do not fail
  a check on it alone.

When the change is about layout, split by `device` or `viewport_width`: a page that works on a desktop can break on a
phone. Nothing records how a page looks, so a change to how it looks and not to what it does cannot be checked:
declare `{"none": …}` for it.

```json
[
  { "title": "People export from the settings page",
    "claim": "At least one person who opens the settings page clicks the new Export button.",
    "sql": "SELECT count(*) FILTER (WHERE kind = 'page') AS seen, count(*) FILTER (WHERE kind = 'click' AND detail LIKE '%#export%') AS clicked FROM packrat_replay_events(since := getvariable('deployed_at'), until := getvariable('until')) WHERE url LIKE '%/settings%' AND version = getvariable('version')",
    "pass_when": "clicked >= 1",
    "window": "3d" },
  { "title": "The settings page loads faster on phones",
    "claim": "The p75 LCP of the settings page on phones is under 2500 ms, down from about 4100 ms.",
    "sql": "SELECT count(*) AS seen, quantile_cont(TRY_CAST(json_extract_string(span_attributes, '$.\"browser.web_vital.lcp.value\"') AS DOUBLE), 0.75) AS lcp_p75 FROM packrat_spans(since := getvariable('deployed_at'), until := getvariable('until')) WHERE scope_name = 'packrat.browser' AND name = '/settings' AND json_extract_string(span_attributes, '$.\"device.type\"') = 'mobile' AND json_extract_string(span_attributes, '$.\"browser.web_vital.lcp.value\"') IS NOT NULL",
    "pass_when": "lcp_p75 < 2500",
    "fail_when": "lcp_p75 >= 2500",
    "min_seen": 30,
    "window": "3d" }
]
```

## Draft once, before the pull request

Draft the checks when the change is ready to open, from the whole diff, not after each edit. If no data
production records would show a result, add the instrumentation first, such as an OpenTelemetry span
attribute that records the outcome (the number of rows a job wrote, or the code path a request took), and
commit it on the same branch. The instrumentation then ships with the change, and the checks have data
from the first run. An attribute the change adds is missing before the deploy; that is expected. For a change to
a page, the instrumentation is an `id` on the element it adds; see "A change to a page".

Check a draft yourself with `packrat pr checks set --dry-run --file <draft>`. Packrat runs each check's SQL once:

- **A check whose SQL fails** is refused with what DuckDB said. Fix it and try again.
- **A check that already passes before the deploy** is kept with a warning: passing would prove nothing. Make it
  read only what the change adds, such as the new attribute or `getvariable('version')`.

If a check is still refused after two attempts, stop changing it. Send it in the draft as
`{"title": "…", "claim": "…", "sql": "…", "dropped": "what Packrat said, and why you stopped"}`. It never runs;
the pull request's page lists it, and Packrat records it so the skill can be improved. Tell the user which check
you dropped and why.

If a refusal is wrong, or tells you to do something that does not fix it, report it with `packrat feedback`
(`packrat help feedback`) once you have worked around it or stopped.

If the change fixes a Packrat issue, also write `Fixes <ID>` (for example `Fixes SHOP-41`) in the pull
request's description, one line for each issue. Packrat resolves it when the deploy goes live.

## Changing the checks

Until a deploy ships the pull request, edit the draft and run `packrat pr checks set <number> --file <draft>`.
Sending again replaces the list. After the deploy, add a check with `packrat check add --pull <number>`, which
reads one check in the same shape on stdin.
