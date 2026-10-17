---
name: query
description: Production telemetry for this app in Packrat — every trace and log line, unsampled, kept for a year and queryable in SQL. Use for "why is this slow", "what happened in production", N+1 hunting, error spikes, incidents, browser sessions, and to check what a change did once it shipped.
allowed-tools: Bash(packrat sql:*), Bash(packrat apps:*)
---

# Querying production with Packrat

Query with `packrat sql "<SQL>"` (or `-f file.sql`). It prints NDJSON rows, and a line on stderr that
names the app that answered. `packrat apps` lists the apps; when there is more than one, `--app
<service>` says which to ask about. If it says "not signed in", ask the person to type
`! packrat login`.

Before the first query of a session, fetch https://packrat.sh/docs/investigate.md and follow it: it
has the traps, the cookbook, the incident ladder and the macros. The response format and the tables
to select from are in https://packrat.sh/docs/api.md.

Even if you cannot fetch them, these five produce a confident wrong answer rather than an error:

- A root span is `parent_span_id IS NULL`, never `= ''`.
- Durations nest: use self time, and never `sum()` across a trace.
- Group log lines by `template_id`, never by their text.
- Never carry a `template_id` from one app to another.
- Bound every query with `since` and `until`.

Browser sessions are `packrat_replays` and `packrat_replay_events`. To link one, give the `link`
column of `packrat_replays`: it is the replay's page in Packrat. Never compose a Sentry address.

For a pull request — how it went, or a check to run later — use the `packrat:pr` skill. For a pasted
Packrat URL, `packrat open`.
