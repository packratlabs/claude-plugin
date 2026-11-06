import type { Hook, Register } from 'claude-code'

import {
  type Check,
  type Merged,
  type Pr,
  type PullAnswer,
  FIRST_LOOK_MS,
  VERDICTS,
  WHEN_WIDTH,
  ago,
  checkGlyph,
  checkName,
  countdown,
  day,
  due,
  fit,
  isLive,
  summary,
  toPr,
  orgOf,
  verdict,
  verificationUrl,
} from './logic'

type Api = Parameters<Hook<'session.start'>>[0]

const PANE = 'packrat'
const POLL_MS = 60_000
const NO_CHECKS: Record<string, string> = {
  '': 'No deploy recorded yet.',
  not_observable: 'Nothing in production can show whether it worked.',
  archived: 'Its verification was archived.',
}

// Module state, as pr-monitor keeps it: a reload starts it over and the next poll fills it again.
let root = ''
let repo: string | null = null
let cli = 'packrat'
let limit = 12
let site = 'https://packrat.sh'
let org: string | null = null
let prs: Pr[] = []
let checkedAt = 0
let isRefreshing = false
let lastError: string | null = null
const expanded = new Set<number>()
let isStarted = false


async function detectRepo($: Api) {
  root = await $.session.root()
  const found = await $.process.run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: root, timeoutMs: 20_000 })
  repo = found.exitCode === 0 && found.stdout.trim() !== '' ? found.stdout.trim() : null
}

async function readPull($: Api, number: number): Promise<PullAnswer | null> {
  const shown = await $.process.run([cli, 'pr', 'show', String(number), '--json'], { cwd: root, timeoutMs: 30_000 })
  if (shown.exitCode !== 0) {
    lastError = `${cli} pr show ${number}: ${shown.stderr.trim().split('\n')[0] ?? `exit ${shown.exitCode}`}`
    return null
  }
  const answer = JSON.parse(shown.stdout) as PullAnswer
  // packrat before 0.1.2 printed no state, so every pull request would read as not verified.
  if (!('state' in answer)) lastError = 'This packrat CLI is too old to show verdicts. Run packrat update.'
  return answer
}

async function refresh($: Api) {
  if (repo === null || isRefreshing) return
  isRefreshing = true
  $.ui.invalidate('ui.render')
  try {
    const listed = await $.process.run(
      ['gh', 'pr', 'list', '--state', 'merged', '--limit', String(limit), '--json', 'number,title,url,mergedAt'],
      { cwd: root, timeoutMs: 30_000 },
    )
    if (listed.exitCode !== 0) {
      lastError = `gh pr list: ${listed.stderr.trim().split('\n')[0] ?? `exit ${listed.exitCode}`}`
      return
    }
    lastError = null
    const merged = JSON.parse(listed.stdout) as Merged[]
    const answers = await Promise.all(merged.map(pr => readPull($, pr.number)))
    prs = merged.map((pr, i) => toPr(pr, answers[i] ?? null))
    checkedAt = await $.clock.now()
  } catch (error) {
    lastError = `refresh failed: ${String(error)}`
  } finally {
    isRefreshing = false
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = (on, options) => {
  limit = Math.min(30, Math.max(3, Number(options.pulls ?? 12)))

  // Nothing runs until /packrat: a session that never opens the pane asks GitHub and Packrat nothing.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'packrat', description: "Show how this repository's pull requests did in production" })

    return next(e)
  })

  on('command.run', { command: 'packrat' }, async $ => {
    try {
      if (!isStarted) {
        cli = String(options.cli ?? '').trim() || `${$.plugin.root}/bin/packrat`
        site = String(options.site ?? '').trim() || (await $.env.get('PACKRAT_URL')) || 'https://packrat.sh'
        await detectRepo($)
        if (repo === null) return { text: 'Packrat: this directory is not a GitHub repository that gh can see.' }
        const auth = await $.process.run([cli, 'auth', 'status'], { timeoutMs: 20_000 })
        org = auth.exitCode === 0 ? orgOf(auth.stdout) : null
        $.clock.every(POLL_MS, () => void refresh($))
        $.clock.every(1_000, () => $.ui.invalidate('ui.render'))
        isStarted = true
      }
      await $.ui.open({ id: PANE, title: 'Packrat PR Verifications', focus: true })
      void refresh($)

      return { text: `Opened PR Verifications for ${repo}.` }
    } catch (error) {
      return { text: `Packrat could not open PR Verifications: ${String(error)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(40, e.props.bodyColumns)
    const now = await $.clock.now()

    if (repo === null) return <Text dimColor>Not in a GitHub repository gh can see.</Text>

    const toggle = (n: number) => {
      if (expanded.has(n)) expanded.delete(n)
      else expanded.add(n)
      $.ui.invalidate('ui.render')
    }
    const ask = (n: number) => void $.prompt.fill({ text: `/packrat:ask how did PR ${n} do`, mode: 'replace' })
    const openPr = (url: string) => void $.process.run(['open', url], { timeoutMs: 10_000 })

    const checkLines = (pr: Pr, indent: number) =>
      pr.checks.map(check => {
        const mark = checkGlyph(check)
        const when = check.result === 'passed' || check.result === 'failed' || check.result === 'inconclusive'
          ? (check.runs?.length ? day(check.runs[check.runs.length - 1]!.at) : '')
          : due(check, now)
        return (
          <Box key={`check-${check.id}`} flexDirection="column" marginLeft={indent}>
            <Text>
              <Text color={mark.tone}>{mark.glyph}</Text> {fit(checkName(check), Math.max(10, width - indent - 4 - WHEN_WIDTH))} <Text dimColor>{when}</Text>
            </Text>
          </Box>
        )
      })

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>Packrat PR Verifications</Text>
          <Text dimColor> · {prs.find(pr => pr.app !== null)?.app ?? repo}</Text>
        </Text>
        <Text>
          {summary(prs).map((part, i) => (
            <Text color={part.tone}>{i > 0 ? ' · ' : ''}{part.text}</Text>
          ))}
          {prs.length === 0 && <Text dimColor>{isRefreshing ? 'Reading Packrat…' : 'No merged pull requests yet.'}</Text>}
        </Text>
        {lastError !== null && <Text color="error" wrap="truncate-end">{lastError}</Text>}

        <Box marginTop={1} />
        {prs.map(pr => {
          const v = VERDICTS[verdict(pr.state)]
          // A pull request in its first hour opens by itself; pressing it flips that, as for any other.
          const isOpen = expanded.has(pr.number) !== isLive(pr, now)
          const firstLook = (pr.deployedAt ?? now) + FIRST_LOOK_MS
          const hasRun = pr.checks.some(check => (check.runs?.length ?? 0) > 0)
          return (
            <Box key={`row-${pr.number}`} flexDirection="column">
              <Button key={`pr-${pr.number}`} plain onPress={() => toggle(pr.number)}>
                <Text color={v.tone}>{v.glyph}</Text> #{pr.number} {fit(pr.title, width - 8).trimEnd()}
              </Button>
              {isOpen && (
                <Box flexDirection="column">
                  {pr.deployedAt !== null && (
                    <Box marginLeft={2}>
                      <Text dimColor>
                        deployed {ago(now - pr.deployedAt)} ago
                        {isLive(pr, now) && !hasRun && (firstLook > now ? <> · first look in {countdown(firstLook - now)}</> : ' · first look running')}
                      </Text>
                    </Box>
                  )}
                  {pr.checks.length === 0 && (
                    <Box marginLeft={2}>
                      <Text dimColor>No checks. {NO_CHECKS[pr.state ?? ''] ?? 'Not judged yet.'}</Text>
                    </Box>
                  )}
                  {checkLines(pr, 2)}
                  <Box flexDirection="row" gap={1} marginLeft={2}>
                    <Button key={`ask-${pr.number}`} label="Ask" variant="primary" onPress={() => ask(pr.number)} />
                    <Button key={`open-${pr.number}`} label="View PR" onPress={() => openPr(verificationUrl(pr, site, org))} />
                  </Box>
                </Box>
              )}
            </Box>
          )
        })}
        <Box marginTop={1} flexDirection="row" gap={1}>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refresh($)} />
          <Text dimColor>{isRefreshing ? 'checking…' : `checked ${checkedAt > 0 ? ago(now - checkedAt) : '–'} ago`}</Text>
        </Box>
      </Box>
    )
  })
}
