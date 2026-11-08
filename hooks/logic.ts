// What the pane shows, worked out from `gh pr list` and `packrat pr show --json`. No `$`, so tests drive it directly.

export type Run = { at: string; result: string; evidence: string }

export type Check = {
  id: string
  title: string | null
  what: string
  due_at: string
  closed_at: string | null
  result: string | null
  // Why a failed check did not stop the deploy working; the site shows that check as excused.
  accepted?: string | null
  source: string | null
  runs: Run[] | null
}

export type Deploy = { deployed_at: string; verdict: string | null }

export type PullAnswer = { app: string; org?: string; pull: number; state: string | null; deploys: Deploy[]; checks: Check[]; none?: string | null }

export type Merged = { number: number; title: string; url: string; mergedAt: string }

export type Pr = Merged & { app: string | null; org: string | null; state: string | null; deployedAt: number | null; checks: Check[]; none: string | null }

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
// Analyst::DeployJob asks for a look ten minutes after a deploy goes live.
export const FIRST_LOOK_MS = 10 * 60 * 1000

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
    if (n > 0) parts.push({ text: `${n} ${VERDICTS[v].label}`, tone: VERDICTS[v].tone })
  }
  return parts
}

export function toPr(merged: Merged, answer: PullAnswer | null): Pr {
  const first = answer?.deploys.map(d => Date.parse(d.deployed_at)).filter(t => !Number.isNaN(t)).sort((a, b) => a - b)[0]
  return { ...merged, app: answer?.app ?? null, org: answer?.org ?? null, state: answer?.state ?? null, deployedAt: first ?? null, checks: answer?.checks ?? [], none: answer?.none ?? null }
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
  if (isClosedUnjudged(check)) return { glyph: '•', tone: 'subtle' }
  switch (check.result) {
    case 'passed':
      return { glyph: '✓', tone: 'success' }
    case 'failed':
      return { glyph: '✗', tone: 'error' }
    case 'inconclusive':
      return { glyph: '?', tone: 'warning' }
    default:
      return { glyph: '·', tone: 'subtle' }
  }
}

// The day a closed check last ran, or when an open one is due.
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

export function countdown(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function day(iso: string) {
  const t = new Date(iso)
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`
}

export function due(check: Check, now: number) {
  const at = Date.parse(check.due_at)
  if (Number.isNaN(at)) return ''
  if (at <= now) return 'next look'
  if (at - now < 24 * 3600 * 1000) return `in ${countdown(at - now)}`
  return day(check.due_at)
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

// What the pane says of a pull request with no checks: why its author declared none, or what its state says.
export function noChecks(pr: Pr, byState: Record<string, string>) {
  return pr.none ? `No checks: ${pr.none}` : `No checks. ${byState[pr.state ?? ''] ?? 'Not judged yet.'}`
}
