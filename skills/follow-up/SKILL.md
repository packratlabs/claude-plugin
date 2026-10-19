---
name: follow-up
description: Write the Follow-up section of a pull request description, which Packrat uses to verify the change in production. Use when you create or edit a pull request description (gh pr create, gh pr edit).
---

# Follow-up sections

After a pull request is deployed, Packrat reads the `## Follow-up` section of its description and
checks production data to determine whether the change worked. Without this section, Packrat has only
the title. Add a Follow-up section to every pull request, after the summary.

Base the section on the change's expected effect in production, not on test results. Each item
states:

- **The signal.** Data that production records: a span, a span attribute, a log line, an error that
  stops, or a value that changes. Use exact names.
- **How to check it.** Describe the check in terms of that data, so it can be run without further
  input.
- **When the result is expected.** For example: at deploy, within an hour, after the next 03:00 job,
  or when weekday traffic resumes.

If the change could affect related behavior, also list what must stay the same, such as error rates
or the latency of a related endpoint.

If production records nothing that shows the result, state this and add instrumentation, such as an
OpenTelemetry span attribute that records the outcome (the number of rows a job wrote, or the code path
a request took).

### Example

```markdown
## Follow-up

- **The cart page is faster.** p95 latency of `GET /cart` drops from about 840 ms to under 300 ms. Expected within an hour of deploy.
- **Totals are correct.** On `checkout.charge` spans, `charge.amount` equals `cart.total` for every checkout, including gift cards. Expected within a day.
- **No other endpoint slows down.** p95 latency of `POST /checkout` stays at the previous day's level.
```

### Later checks

If a result can only be verified later, such as a job that runs next week, create a check with
`packrat check add --pull <number>` after the pull request has a number.
