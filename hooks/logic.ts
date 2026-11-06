// What the pane shows, worked out from `gh pr list` and `packrat pr show --json`. No `$`, so tests drive it directly.

export type Run = { at: string; result: string; evidence: string }

export type Check = {
  id: string
  title: string | null
  what: string
  due_at: string
  closed_at: string | null
  result: string | null
  source: string | null
  runs: Run[] | null
}

export type Deploy = { deployed_at: string; verdict: string | null }

export type PullAnswer = { app: string; pull: number; state: string | null; deploys: Deploy[]; checks: Check[] }

export type Merged = { number: number; title: string; url: string; mergedAt: string }

export type Pr = Merged & { app: string | null; state: string | null; deployedAt: number | null; checks: Check[] }

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

export function isLive(pr: Pr, now: number) {
  return pr.deployedAt !== null && now - pr.deployedAt < LIVE_MS && verdict(pr.state) === 'pending'
}

export type Counts = { failed: number; pending: number; passed: number; inconclusive: number }

export function counts(checks: readonly Check[]): Counts {
  const out = { failed: 0, pending: 0, passed: 0, inconclusive: 0 }
  for (const check of checks) {
    if (check.closed_at !== null && (check.result === null || check.result === '')) continue
    if (check.result === 'failed') out.failed += 1
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
  return { ...merged, app: answer?.app ?? null, state: answer?.state ?? null, deployedAt: first ?? null, checks: answer?.checks ?? [] }
}

export function checkName(check: Check) {
  return check.title ?? check.what.split('\n')[0] ?? check.id
}

export function checkGlyph(check: Check): { glyph: string; tone: Tone } {
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

// The org's public id from `packrat auth status`: "Signed in to dlite (org_j9m7lj1jp5fg) as …".
export function orgOf(authStatus: string) {
  return /\((org_[a-z0-9]+)\)/.exec(authStatus)?.[1] ?? null
}

// The pull request's page on the site, or GitHub's when the org or app is not known.
export function verificationUrl(pr: Pr, site: string, org: string | null) {
  const [service, env] = pr.app?.split('/') ?? []
  if (org === null || service === undefined || env === undefined) return pr.url
  const app = `${encodeURIComponent(service)}/${encodeURIComponent(env)}`
  return `${site.replace(/\/+$/, '')}/orgs/${org}/apps/${app}/pulls/${pr.number}`
}
