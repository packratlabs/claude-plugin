// What the pane shows, worked out from `gh pr list` and `packrat pr show --json`. No `$`, so tests drive it directly.

export type Run = { at: string; result: string; evidence: string }

export type Check = {
  id: string
  title: string | null
  what: string
  due_at: string
  // When it will run: the first hourly look after it is due. Older servers do not send it.
  runs_at?: string | null
  closed_at: string | null
  result: string | null
  // Why a failed check did not stop the deploy working; the site shows that check as excused.
  accepted?: string | null
  source: string | null
  runs: Run[] | null
  // A rule check runs every five minutes until due_at, the end of its window. Older servers send none of these.
  kind?: string | null
  seen?: number | null
  min_seen?: number | null
  // 'failed' or 'broken' while it waits for the analyst to review it.
  review?: string | null
}

export type Deploy = { deployed_at: string; verdict: string | null }

export type PullAnswer = { app: string; org?: string; pull: number; state: string | null; deploys: Deploy[]; checks: Check[] }

export type Merged = { number: number; title: string; url: string; mergedAt: string }

export type Pr = Merged & { app: string | null; org: string | null; state: string | null; deployedAt: number | null; checks: Check[] }

export type Verdict = 'worked' | 'didnt' | 'partly' | 'pending' | 'none'
export type Tone = 'success' | 'error' | 'warning' | 'suggestion' | 'subtle'

export const VERDICTS: Record<Verdict, { glyph: string; tone: Tone; label: string }> = {
  didnt: { glyph: '✗', tone: 'error', label: "didn't work" },
  partly: { glyph: '◐', tone: 'warning', label: 'partly' },
  pending: { glyph: '◷', tone: 'suggestion', label: 'pending' },
  worked: { glyph: '✓', tone: 'success', label: 'worked' },
  none: { glyph: '–', tone: 'subtle', label: 'not verified' },
}

// Analyst::Pulls states, folded into the pane's five.
export function verdict(state: string | null): Verdict {
  switch (state) {
    case 'confirmed':
    case 'fixed':
      return 'worked'
    case 'refuted':
      return 'didnt'
    case 'partly':
      return 'partly'
    case 'pending':
      return 'pending'
    default:
      return 'none'
  }
}

export const LIVE_MS = 60 * 60 * 1000

// How long the pane keeps a settled answer before asking again. Not forever: a later deploy can fix a pull request
// that did not work, or ship it again.
export const SETTLED_MS = 15 * 60 * 1000
const UNSHIPPED_MS = 24 * 60 * 60 * 1000

// An answer that will not change within the minute: a verdict with no check open, or a pull request merged a day
// ago that no deploy has shipped.
export function isSettled(merged: Merged, answer: PullAnswer | null, now: number) {
  if (answer === null) return false
  if (answer.deploys.length === 0) return now - Date.parse(merged.mergedAt) > UNSHIPPED_MS
  return verdict(answer.state) !== 'pending' && answer.checks.every(check => check.closed_at !== null)
}

// A pending pull request past its first hour changes only when a look runs, about once an hour.
export const PENDING_MS = 5 * 60 * 1000

// How long the pane keeps an answer before asking Packrat again: not at all in a deploy's first hour, when the first
// look is minutes away.
export function rereadAfter(merged: Merged, answer: PullAnswer | null, now: number) {
  if (answer === null) return 0
  if (isSettled(merged, answer, now)) return SETTLED_MS
  const first = answer.deploys.map(d => Date.parse(d.deployed_at)).filter(t => !Number.isNaN(t)).sort((a, b) => a - b)[0]
  if (first === undefined || now - first < LIVE_MS) return 0
  return PENDING_MS
}

export function isLive(pr: Pr, now: number) {
  return pr.deployedAt !== null && now - pr.deployedAt < LIVE_MS && verdict(pr.state) === 'pending'
}

export type Counts = { failed: number; excused: number; pending: number; passed: number; inconclusive: number }

export const isExcused = (check: Check) => check.result === 'failed' && !!check.accepted

// Closed before checks had results, or withdrawn by a developer.
const isClosedUnjudged = (check: Check) => check.closed_at !== null && (check.result === null || check.result === '')

export function counts(checks: readonly Check[]): Counts {
  const out = { failed: 0, excused: 0, pending: 0, passed: 0, inconclusive: 0 }
  for (const check of checks) {
    if (isClosedUnjudged(check)) continue
    if (isExcused(check)) out.excused += 1
    else if (check.result === 'failed') out.failed += 1
    else if (check.result === 'passed') out.passed += 1
    else if (check.result === 'inconclusive') out.inconclusive += 1
    else out.pending += 1
  }
  return out
}

export function summary(prs: readonly Pr[]) {
  const parts: { text: string; tone: Tone }[] = []
  for (const v of ['didnt', 'partly', 'pending', 'worked'] as const) {
    const n = prs.filter(pr => verdict(pr.state) === v).length
    if (n > 0) parts.push({ text: `${VERDICTS[v].glyph} ${n} ${VERDICTS[v].label}`, tone: VERDICTS[v].tone })
  }
  return parts
}

export function toPr(merged: Merged, answer: PullAnswer | null): Pr {
  const first = answer?.deploys.map(d => Date.parse(d.deployed_at)).filter(t => !Number.isNaN(t)).sort((a, b) => a - b)[0]
  return { ...merged, app: answer?.app ?? null, org: answer?.org ?? null, state: answer?.state ?? null, deployedAt: first ?? null, checks: answer?.checks ?? [] }
}

// Packrat has a page for a pull request only once a recorded deploy shipped it; until then it has nothing to verify.
export const deployed = (prs: readonly Pr[]) => prs.filter(pr => pr.deployedAt !== null)

// A check with no title is named by its first sentence, after the pull request and commit it opens with.
export function checkName(check: Check) {
  if (check.title) return check.title
  const what = check.what.replace(/\s+/g, ' ').trim().replace(/^(?:PR\s*)?#\d+\s*(?:\([0-9a-f]{7,40}\)\s*)?[,;:–—-]?\s*/i, '')
  const name = (/^.+?(?:[.:](?=\s)|$)/.exec(what)?.[0] ?? '').replace(/[.:]$/, '').trim()
  return name ? name[0]!.toUpperCase() + name.slice(1) : check.id
}

export function checkGlyph(check: Check): { glyph: string; tone: Tone } {
  if (isExcused(check)) return { glyph: '⊘', tone: 'subtle' }
  // A rule check that failed is open until the analyst reviews it, and is shown as pending until then.
  if (check.kind && check.closed_at === null) return { glyph: VERDICTS.pending.glyph, tone: VERDICTS.pending.tone }
  if (isClosedUnjudged(check)) return { glyph: '•', tone: 'subtle' }
  switch (check.result) {
    case 'passed':
      return { glyph: '✓', tone: 'success' }
    case 'failed':
      return { glyph: '✗', tone: 'error' }
    case 'inconclusive':
      return { glyph: '?', tone: 'warning' }
    default:
      return { glyph: VERDICTS.pending.glyph, tone: VERDICTS.pending.tone }
  }
}

// The day a closed check last ran, or when an open one runs.
export function checkWhen(check: Check, now: number) {
  if (check.closed_at === null) return due(check, now)
  const runs = check.runs ?? []
  return day(runs[runs.length - 1]?.at ?? check.closed_at)
}

export function lastEvidence(check: Check) {
  const runs = check.runs ?? []
  return runs[runs.length - 1]?.evidence ?? null
}

export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

// Coarser the further off it is: minutes within the hour, hours and minutes within six, then hours alone.
export function until(ms: number) {
  const m = Math.max(1, Math.ceil(ms / 60_000))
  if (m < 60) return `${m}m`
  if (m < 6 * 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
  return `${Math.round(m / 60)}h`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function day(iso: string) {
  const t = new Date(iso)
  return `${t.getDate()} ${MONTHS[t.getMonth()]}`
}

export function due(check: Check, now: number) {
  if (check.kind) return progress(check)
  const runs = check.runs_at ?? check.due_at
  const at = Date.parse(runs)
  if (Number.isNaN(at)) return ''
  if (at <= now) return 'next look'
  if (at - now < 24 * 3600 * 1000) return `in ${until(at - now)}`
  return day(runs)
}

// An open rule check is pending until it closes, unless it waits for review.
export function progress(check: Check) {
  return check.review ? 'to review' : 'pending'
}

// The widest a check's time can be: 'in 14h 04m'.
export const WHEN_WIDTH = 10

export function fit(text: string, width: number) {
  if (width <= 1) return ''
  return text.length > width ? text.slice(0, width - 1) + '…' : text.padEnd(width)
}

// The pull request's page on the site, or GitHub's when the org or app is not known.
export function verificationUrl(pr: Pr, site: string) {
  const [service, env] = pr.app?.split('/') ?? []
  const org = pr.org
  if (org === null || service === undefined || env === undefined) return pr.url
  const app = `${encodeURIComponent(service)}/${encodeURIComponent(env)}`
  return `${site.replace(/\/+$/, '')}/orgs/${org}/apps/${app}/pulls/${pr.number}`
}

export const NO_CHECKS = 'No checks.'

// One row of `packrat issues --json`: an error issue, or one the analyst raised (`kind` `detected`).
export type Issue = {
  id: string
  kind: string
  title: string
  culprit: string | null
  status: string
  substatus: string | null
  severity: string | null
  summary: string | null
  events: number
  users: number
  last_seen: string | null
  environment?: string
  state?: string
  normal?: boolean
  errors?: string[]
  pull?: number | null
  reasons?: string[]
}

export type IssueList = { app: string; org?: string; period: string; issues: Issue[] }

export const SEVERITIES: Record<string, { glyph: string; tone: Tone; label: string }> = {
  critical: { glyph: '▲', tone: 'error', label: 'critical' },
  high: { glyph: '▲', tone: 'warning', label: 'high' },
  '': { glyph: '·', tone: 'subtle', label: 'unrated' },
  low: { glyph: '▽', tone: 'subtle', label: 'low' },
}

export const severityMark = (issue: Issue) => SEVERITIES[issue.severity ?? ''] ?? SEVERITIES['']!

export function issueSummary(issues: readonly Issue[]) {
  const parts: { text: string; tone: Tone }[] = []
  for (const key of ['critical', 'high', 'low', '']) {
    const n = issues.filter(issue => (issue.severity ?? '') === key).length
    if (n > 0) parts.push({ text: `${SEVERITIES[key]!.glyph} ${n} ${SEVERITIES[key]!.label}`, tone: SEVERITIES[key]!.tone })
  }
  return parts
}

// What the row says on its right: the counts, and the substatus when it is news.
export function issueTally(issue: Issue) {
  const tag = issue.substatus === 'new' || issue.substatus === 'regressed' || issue.substatus === 'escalating' ? `${issue.substatus} · ` : ''
  const users = issue.users > 0 ? ` · ${issue.users} ${issue.users === 1 ? 'user' : 'users'}` : ''
  return `${tag}${issue.events} ev${users}`
}

// The lines under an open issue: what the analyst wrote, where it happened, and why it ranks where it does.
// Text broken at spaces into lines of at most width, so each can carry the rail; a longer word is cut.
export function wrap(text: string, width: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = ''
    }
    line = line ? `${line} ${word}` : word.slice(0, width)
  }
  if (line) lines.push(line)
  return lines
}

export function issueDetails(issue: Issue) {
  return issue.summary ? [issue.summary] : []
}

// An error issue is one service's across every environment; its page is one environment's.
export function issueUrl(issue: Issue, list: { app: string; org?: string }, env: string, site: string) {
  const service = list.app.split('/')[0]
  if (!list.org || !service) return null
  const app = `${encodeURIComponent(service)}/${encodeURIComponent(issue.environment || env)}`
  return `${site.replace(/\/+$/, '')}/orgs/${list.org}/apps/${app}/issues/${encodeURIComponent(issue.id)}`
}
