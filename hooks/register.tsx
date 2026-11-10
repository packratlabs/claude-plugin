import type { Hook, Register } from 'claude-code'

import {
  type Check,
  type IssueList,
  type Merged,
  type Pr,
  type PullAnswer,
  VERDICTS,
  WHEN_WIDTH,
  ago,
  checkGlyph,
  checkName,
  checkWhen,
  nextCheck,
  wrap,
  deployed,
  fit,
  noChecks,
  rereadAfter,
  isLive,
  issueDetails,
  issueSummary,
  issueTally,
  issueUrl,
  severityMark,
  summary,
  toPr,
  verdict,
  verificationUrl,
} from './logic'

type Api = Parameters<Hook<'session.start'>>[0]

const PANE = 'packrat'
const POLL_MS = 60_000
const ISSUES_LISTED = 25
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
let prs: Pr[] = []
let checkedAt = 0
let isRefreshing = false
let lastError: string | null = null
const expanded = new Set<number>()
let tab: 'pulls' | 'issues' = 'pulls'
const TABS: [typeof tab, string][] = [['pulls', 'PR Verifications'], ['issues', 'Issues']]
let issues: IssueList | null = null
let issuesCheckedAt = 0
let isRefreshingIssues = false
let issuesError: string | null = null
let pulling: Promise<void> | null = null
let caughtUpAt = 0
const openIssues = new Set<string>()
// Answers that will not change soon, so each poll asks Packrat only about the pull requests still in play.
const kept = new Map<number, { answer: PullAnswer; until: number }>()
let isStarted = false
let isStarting = false
let pluginOptions: Parameters<Register>[1] = {}
let checkedRepo = false
let logPath: string | null = null
let lastLogged = ''

// The pane shows only its latest error, and Claude Code keeps none of them, so each one also goes to a file.
async function log($: Api, line: string) {
  if (line === lastLogged) return
  lastLogged = line
  try {
    logPath ??= `${(await $.env.get('HOME')) ?? '.'}/.config/packrat/pane.log`
    const before = await $.fs.read(logPath).catch(() => '')
    const stamp = new Date(await $.clock.now()).toISOString()
    await $.fs.write(logPath, [...before.split('\n').filter(Boolean).slice(-499), `${stamp} ${repo ?? '-'} ${line}`].join('\n') + '\n')
  } catch {
    // A log that cannot be written must not take the pane down with it.
  }
}

function fail($: Api, message: string) {
  lastError = message
  void log($, message)
}


async function detectRepo($: Api) {
  root = await $.session.root()
  const found = await $.process.run(['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { cwd: root, timeoutMs: 20_000 })
  repo = found.exitCode === 0 && found.stdout.trim() !== '' ? found.stdout.trim() : null
  checkedRepo = true
}

async function readPull($: Api, number: number): Promise<PullAnswer | null> {
  const shown = await $.process.run([cli, 'pr', 'show', String(number), '--json'], { cwd: root, timeoutMs: 30_000 })
  if (shown.exitCode !== 0) {
    fail($, `${cli} pr show ${number}: ${shown.stderr.trim().split('\n')[0] ?? `exit ${shown.exitCode}`}`)
    return null
  }
  const answer = JSON.parse(shown.stdout) as PullAnswer
  // packrat before 0.1.2 printed no state, so every pull request would read as not verified.
  if (!('state' in answer)) fail($, 'This packrat CLI is too old to show verdicts. Run packrat update.')
  return answer
}

function refresh($: Api) {
  pulling ??= refreshPulls($).finally(() => {
    pulling = null
  })
  return pulling
}

async function refreshPulls($: Api) {
  if (repo === null || isRefreshing) return
  isRefreshing = true
  $.ui.invalidate('ui.render')
  try {
    const listed = await $.process.run(
      ['gh', 'pr', 'list', '--state', 'merged', '--limit', String(limit), '--json', 'number,title,url,mergedAt'],
      { cwd: root, timeoutMs: 30_000 },
    )
    if (listed.exitCode !== 0) {
      fail($, `gh pr list: ${listed.stderr.trim().split('\n')[0] ?? `exit ${listed.exitCode}`}`)
      return
    }
    lastError = null
    const merged = JSON.parse(listed.stdout) as Merged[]
    const now = await $.clock.now()
    const answers = await Promise.all(
      merged.map(async pr => {
        const held = kept.get(pr.number)
        if (held && now < held.until) return held.answer
        const answer = await readPull($, pr.number)
        const wait = rereadAfter(pr, answer, now)
        if (answer && wait > 0) kept.set(pr.number, { answer, until: now + wait })
        else kept.delete(pr.number)
        return answer
      }),
    )
    prs = deployed(merged.map((pr, i) => toPr(pr, answers[i] ?? null)))
    checkedAt = await $.clock.now()
  } catch (error) {
    fail($, `refresh failed: ${String(error)}`)
  } finally {
    isRefreshing = false
    $.ui.invalidate('ui.render')
  }
}

// The app comes from the pull requests' answers, because the Packrat that answers may be older than ?repo= on /issues.
const knownApp = () => prs.find(pr => pr.app !== null)?.app ?? null

async function refreshIssues($: Api) {
  if (repo === null || isRefreshingIssues) return
  isRefreshingIssues = true
  $.ui.invalidate('ui.render')
  try {
    if (knownApp() === null) await (pulling ?? refresh($))
    const [service, env] = knownApp()?.split('/') ?? []
    const argv = [cli, 'issues', '--json', '--limit', String(ISSUES_LISTED)]
    if (service) argv.push('--app', service)
    if (env) argv.push('--environment', env)
    const listed = await $.process.run(argv, { cwd: root, timeoutMs: 30_000 })
    if (listed.exitCode !== 0) {
      const said = listed.stderr.trim().split('\n')[0] ?? `exit ${listed.exitCode}`
      issuesError = said.includes('is not a packrat command') ? 'This packrat CLI is too old to list issues. Run packrat update.' : `${cli} issues: ${said}`
      void log($, issuesError)
      return
    }
    issues = JSON.parse(listed.stdout) as IssueList
    issuesError = null
    issuesCheckedAt = await $.clock.now()
  } catch (error) {
    issuesError = `issues refresh failed: ${String(error)}`
    void log($, issuesError)
  } finally {
    isRefreshingIssues = false
    $.ui.invalidate('ui.render')
  }
}

const refreshShown = ($: Api) => (tab === 'issues' ? refreshIssues($) : refresh($))

// A pane behind another tab, or closed, asks Packrat nothing; it reads again when it is drawn.
async function isShown($: Api) {
  try {
    return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
  } catch {
    return true
  }
}

async function show($: Api, next: typeof tab) {
  tab = next
  $.ui.invalidate('ui.render')
  if (next === 'issues' && (issues === null || (await $.clock.now()) - issuesCheckedAt >= POLL_MS)) void refreshIssues($)
}

// Run by /packrat, and by an open pane that draws after a reload (/reload-plugins or an update), which starts the
// module's state over and stops its clocks.
async function start($: Api) {
  if (isStarted || isStarting) return
  isStarting = true
  try {
    cli = String(pluginOptions.cli ?? '').trim() || `${$.plugin.root}/bin/packrat`
    site = String(pluginOptions.site ?? '').trim() || (await $.env.get('PACKRAT_URL')) || 'https://packrat.sh'
    await detectRepo($)
    if (repo === null) return
    $.clock.every(POLL_MS, async () => {
      if (await isShown($)) void refreshShown($)
    })
    $.clock.every(1_000, async () => {
      if (await isShown($)) $.ui.invalidate('ui.render')
    })
    isStarted = true
    void refresh($)
  } finally {
    isStarting = false
    $.ui.invalidate('ui.render')
  }
}

export const register: Register = (on, options) => {
  pluginOptions = options
  limit = Math.min(30, Math.max(3, Number(options.pulls ?? 12)))

  // Nothing runs until /packrat: a session that never opens the pane asks GitHub and Packrat nothing.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'packrat', description: "Show how this repository's pull requests did in production, and its issues", argumentHint: '[issues]' })

    return next(e)
  })

  on('command.run', { command: 'packrat' }, async ($, e) => {
    try {
      await start($)
      if (repo === null) return { text: 'Packrat: this directory is not a GitHub repository that gh can see.' }
      const next = /^\s*issues?\b/i.test(e.args) ? 'issues' : 'pulls'
      await $.ui.open({ id: PANE, title: 'Packrat', focus: true })
      await show($, next)
      if (next === 'pulls') void refresh($)

      return { text: `Opened ${next === 'issues' ? 'Issues' : 'PR Verifications'} for ${repo}.` }
    } catch (error) {
      void log($, `open failed: ${String(error)}`)
      return { text: `Packrat could not open PR Verifications: ${String(error)}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // A throw here leaves the pane blank, so it is drawn as an error and logged instead. A tree the engine refuses
    // (a `<>`, which is a Box, inside a Text) blanks it too, after this returns: the pane test mounts it to catch that.
    try {
      const width = Math.max(40, e.props.bodyColumns)
      const now = await $.clock.now()

      if (!checkedRepo) void start($)
      const shownAt = tab === 'issues' ? issuesCheckedAt : checkedAt
      if (isStarted && shownAt > 0 && now - shownAt >= POLL_MS && now - caughtUpAt >= POLL_MS) {
        caughtUpAt = now
        void refreshShown($)
      }
      if (repo === null) return <Text dimColor>{checkedRepo ? 'Not in a GitHub repository gh can see.' : 'Reading Packrat…'}</Text>

      const toggle = (n: number) => {
        if (expanded.has(n)) expanded.delete(n)
        else expanded.add(n)
        $.ui.invalidate('ui.render')
      }
      const ask = (n: number) => void $.prompt.fill({ text: `/packrat:ask how did PR ${n} do`, mode: 'replace' })
      const openPr = (url: string) => void $.process.run(['open', url], { timeoutMs: 10_000 })

      // An open pull request's checks hang off a rail that ends at its buttons, so the block reads as one thing.
      const checkLines = (pr: Pr) =>
        pr.checks.map(check => {
          const mark = checkGlyph(check)
          const when = checkWhen(check, now)
          return (
            <Box key={`check-${check.id}`} flexDirection="column">
              <Text>
                <Text dimColor>│ </Text><Text color={mark.tone}>{mark.glyph}</Text> {fit(checkName(check), Math.max(10, width - 6 - WHEN_WIDTH))} <Text dimColor>{when}</Text>
              </Text>
            </Box>
          )
        })

      const pullsBody = (
        <Box flexDirection="column">
          <Text>
            {summary(prs).map((part, i) => (
              <Text color={part.tone}>{i > 0 ? '  ' : ''}{part.text}</Text>
            ))}
            {nextCheck(prs, now) && <Text dimColor>{`  · next check ${nextCheck(prs, now)}`}</Text>}
            {prs.length === 0 && <Text dimColor>{isRefreshing ? 'Reading Packrat…' : 'No deployed pull requests yet.'}</Text>}
          </Text>
          {lastError !== null && <Text color="error" wrap="truncate-end">{lastError}</Text>}

          <Box marginTop={1} />
          {prs.map(pr => {
            const v = VERDICTS[verdict(pr.state)]
            // A pull request in its first hour opens by itself; pressing it flips that, as for any other.
            const isOpen = expanded.has(pr.number) !== isLive(pr, now)
            return (
              <Box key={`row-${pr.number}`} flexDirection="column">
                <Button key={`pr-${pr.number}`} plain onPress={() => toggle(pr.number)}>
                  <Text color={v.tone}>{v.glyph}</Text> <Text bold={isOpen} dimColor={!isOpen && verdict(pr.state) === 'worked'}>#{pr.number} {fit(pr.title, width - 8).trimEnd()}</Text>
                </Button>
                {isOpen && (
                  <Box flexDirection="column" marginBottom={1}>
                    {pr.checks.length === 0 && <Text dimColor>│ {noChecks(pr, NO_CHECKS)}</Text>}
                    {checkLines(pr)}
                    <Box flexDirection="row" gap={1}>
                      <Text dimColor>└</Text>
                      <Button key={`ask-${pr.number}`} label="Ask" dimColor onPress={() => ask(pr.number)} />
                      <Button key={`open-${pr.number}`} label="View PR" dimColor onPress={() => openPr(verificationUrl(pr, site))} />
                      {pr.deployedAt !== null && <Text dimColor>deployed {ago(now - pr.deployedAt)} ago</Text>}
                    </Box>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )

      const toggleIssue = (id: string) => {
        if (openIssues.has(id)) openIssues.delete(id)
        else openIssues.add(id)
        $.ui.invalidate('ui.render')
      }
      const askIssue = (id: string) => void $.prompt.fill({ text: `/packrat:ask what is going on with ${id}`, mode: 'replace' })
      const listed = issues?.issues ?? []
      const env = knownApp()?.split('/')[1] ?? 'production'

      const issuesBody = (
        <Box flexDirection="column">
          <Text>
            {issueSummary(listed).map((part, i) => (
              <Text color={part.tone}>{i > 0 ? '  ' : ''}{part.text}</Text>
            ))}
            {issues !== null && listed.length === 0 && <Text dimColor>No unresolved issues.</Text>}
            {issues === null && <Text dimColor>{issuesError === null ? 'Reading Packrat…' : ''}</Text>}
          </Text>
          {issuesError !== null && <Text color="error" wrap="truncate-end">{issuesError}</Text>}

          <Box marginTop={1} />
          {listed.map(issue => {
            const mark = severityMark(issue)
            const isAi = issue.kind === 'detected'
            const tally = issueTally(issue)
            const titleWidth = Math.max(10, width - tally.length - (isAi ? 3 : 0) - 6)
            const url = issues && issueUrl(issue, { app: issues.app, org: issues.org || (prs.find(pr => pr.org !== null)?.org ?? undefined) }, env, site)
            return (
              <Box key={`issue-row-${issue.id}`} flexDirection="column">
                <Button key={`issue-${issue.id}`} plain onPress={() => toggleIssue(issue.id)}>
                  <Text color={mark.tone}>{mark.glyph}</Text> {isAi && <Text color="suggestion">AI </Text>}
                  <Text bold={openIssues.has(issue.id)}>{fit(issue.title.replace(/\s+/g, ' '), titleWidth)}</Text> <Text dimColor>{tally}</Text>
                </Button>
                {openIssues.has(issue.id) && (
                  <Box flexDirection="column" marginBottom={1}>
                    {issueDetails(issue).flatMap(detail => wrap(detail, width - 2)).map((line, i) => (
                      <Text key={`issue-${issue.id}-line-${i}`}><Text dimColor>│ </Text>{line}</Text>
                    ))}
                    <Box flexDirection="row" gap={1}>
                      <Text dimColor>└</Text>
                      <Button key={`ask-issue-${issue.id}`} label="Ask" dimColor onPress={() => askIssue(issue.id)} />
                      {url && <Button key={`open-issue-${issue.id}`} label="View issue" dimColor onPress={() => openPr(url)} />}
                    </Box>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      )

      // Claude Code draws each tab as `N:  label `, and the row sets them and the app name two apart.
      const app = knownApp() ?? repo ?? ''
      const tabsWidth = TABS.reduce((n, [, label]) => n + label.length + 5, TABS.length * 2)

      const isBusy = tab === 'issues' ? isRefreshingIssues : isRefreshing

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={2}>
            {TABS.map(([key, label], i) => (
              <Button key={`tab-${key}`} plain hotkey={String(i + 1)} onPress={() => void show($, key)}>
                {tab === key ? <Text backgroundColor="suggestion" color="inverseText" bold> {label} </Text> : <Text dimColor> {label} </Text>}
              </Button>
            ))}
            <Text dimColor wrap="truncate-end">{' '.repeat(Math.max(0, width - tabsWidth - app.length))}{app}</Text>
          </Box>
          <Text dimColor>{'─'.repeat(width)}</Text>
          {tab === 'issues' ? issuesBody : pullsBody}
          <Box marginTop={1} flexDirection="row" gap={1}>
            <Button key="refresh" label="Refresh" hotkey="r" onPress={() => {
              kept.clear()
              void refreshShown($)
            }} />
            <Text dimColor>{isBusy ? 'checking…' : `checked ${shownAt > 0 ? ago(now - shownAt) : '–'} ago`}</Text>
          </Box>
        </Box>
      )
    } catch (error) {
      void log($, `render failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      return <Text color="error">Packrat could not draw this pane: {String(error)}. See ~/.config/packrat/pane.log.</Text>
    }
  })
}
