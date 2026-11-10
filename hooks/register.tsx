import type { Hook, Register } from 'claude-code'

import {
  type Check,
  type IssueList,
  type Overview,
  type OverviewItem,
  type Tone,
  SPARK_WIDTH,
  itemMark,
  plainParagraphs,
  sparkline,
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
let tab: 'overview' | 'pulls' | 'issues' = 'overview'
let overview: Overview | null = null
let overviewCheckedAt = 0
let isRefreshingOverview = false
let overviewError: string | null = null
// Items on the Overview opened or closed by a press: the first act or watch item starts open, every other one closed.
const flippedOverview = new Set<string>()
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

async function refreshOverview($: Api) {
  if (repo === null || isRefreshingOverview) return
  isRefreshingOverview = true
  $.ui.invalidate('ui.render')
  // The Overview ends with the Issues tab's counts, so it reads the issues too.
  if (issues === null || (await $.clock.now()) - issuesCheckedAt >= POLL_MS) void refreshIssues($)
  try {
    const read = await $.process.run([cli, 'overview', '--json'], { cwd: root, timeoutMs: 45_000 })
    if (read.exitCode !== 0) {
      const said = read.stderr.trim().split('\n')[0] ?? `exit ${read.exitCode}`
      overviewError = said.includes('is not a packrat command') ? 'This packrat CLI is too old to show the overview. Run packrat update.' : `${cli} overview: ${said}`
      void log($, overviewError)
      return
    }
    overview = JSON.parse(read.stdout) as Overview
    overviewError = null
    overviewCheckedAt = await $.clock.now()
  } catch (error) {
    overviewError = `overview refresh failed: ${String(error)}`
    void log($, overviewError)
  } finally {
    isRefreshingOverview = false
    $.ui.invalidate('ui.render')
  }
}

const refreshShown = ($: Api) => (tab === 'issues' ? refreshIssues($) : tab === 'overview' ? refreshOverview($) : refresh($))

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
  if (next === 'overview' && (overview === null || (await $.clock.now()) - overviewCheckedAt >= POLL_MS)) void refreshOverview($)
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
    if (tab === 'overview') void refreshOverview($)
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
    await $.command.register({ name: 'packrat', description: "Show this repository's app in production: its last 24 hours, its pull requests and its issues", argumentHint: '[pulls|issues]' })

    return next(e)
  })

  on('command.run', { command: 'packrat' }, async ($, e) => {
    try {
      await start($)
      if (repo === null) return { text: 'Packrat: this directory is not a GitHub repository that gh can see.' }
      const next = /^\s*issues?\b/i.test(e.args) ? 'issues' : /^\s*(pulls?|prs?|verifications?)\b/i.test(e.args) ? 'pulls' : 'overview'
      await $.ui.open({ id: PANE, title: 'Packrat', focus: true })
      await show($, next)
      if (next === 'pulls') void refresh($)

      return { text: `Opened ${{ overview: 'the Overview', issues: 'Issues', pulls: 'PR Verifications' }[next]} for ${repo}.` }
    } catch (error) {
      void log($, `open failed: ${String(error)}`)
      return { text: `Packrat could not open its pane: ${String(error)}` }
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

      const flipOverview = (key: string) => {
        if (flippedOverview.has(key)) flippedOverview.delete(key)
        else flippedOverview.add(key)
        $.ui.invalidate('ui.render')
      }
      const ov = overview
      const ovBase = ov && ov.org ? `${site.replace(/\/+$/, '')}/orgs/${ov.org}/apps/${ov.app.split('/').map(encodeURIComponent).join('/')}` : null
      // A CLI older than 0.1.10 drops the feed, so the pane falls back to the latest summary's items.
      const ovItems = ov ? ov.feed ?? ov.items : []
      const firstProblem = ovItems.findIndex(item => ['act', 'watch', 'urgent'].includes(item.status))
      const tabLink = (to: 'pulls' | 'issues', label: string, parts: { text: string; tone: Tone }[], none: string) => (
        <Button key={`ov-to-${to}`} plain onPress={() => void show($, to)}>
          <Text bold>{label}</Text>{'  '}
          {parts.map((part, i) => <Text key={`ov-to-${to}-${i}`} color={part.tone}>{i > 0 ? '  ' : ''}{part.text}</Text>)}
          {parts.length === 0 && <Text dimColor>{none}</Text>}
          <Text dimColor>  →</Text>
        </Button>
      )
      const askItem = (item: OverviewItem) =>
        item.pull ? ask(item.pull.number) : item.issue ? askIssue(item.issue) : void $.prompt.fill({ text: `/packrat:ask look into "${item.title}"`, mode: 'replace' })

      const overviewBody = (
        <Box flexDirection="column">
          {overviewError !== null && <Text color="error" wrap="truncate-end">{overviewError}</Text>}
          {ov === null && overviewError === null && <Text dimColor>Reading Packrat…</Text>}
          {ov !== null && (
            <Box flexDirection="column">
              <Text dimColor>{ov.feed ? 'What the analyst said in the last 24 hours' : ov.report ? `Latest summary, ${ago(now - Date.parse(ov.report.at))} ago` : ''}</Text>
              <Box marginTop={1} />
              {ovItems.length === 0 && <Text dimColor>Nothing yet. The analyst writes a summary at 06:00, 12:00 and 18:00 Denver time.</Text>}
              {ovItems.map((item, index) => {
                const key = `item:${index}:${item.title}`
                const isOpen = flippedOverview.has(key) !== (index === firstProblem)
                const mark = itemMark(item)
                const spark = item.chart?.kind === 'bars' ? sparkline(item.chart.rows.map(row => Number(row[1]))) : ''
                const tag = item.pull ? `#${item.pull.number} ${item.pull.label ?? ''}`.trimEnd() : item.issue ?? ''
                const titleWidth = Math.max(10, width - 2 - (spark ? SPARK_WIDTH + 1 : 0) - (tag ? tag.length + 1 : 0))
                // As the mail lays an item out: the chart's caption, then each part under its own dim label, a blank line between.
                const parts = [['What changed', item.changed], ['Why it matters', item.matters], ['Evidence', item.evidence], ['Next', item.next]]
                  .filter(([, text]) => text)
                const blocks: { label: string | null; text: string }[] = item.body
                  ? plainParagraphs(item.body).map(text => ({ label: null, text }))
                  : parts.map(([label, text]) => ({ label: label!, text: text! }))
                const lines = [
                  ...(item.chart?.caption ? wrap(item.chart.caption, width - 2).map(text => ({ text, dim: true })) : []),
                  ...blocks.flatMap(({ label, text }) => [
                    { text: '', dim: false }, ...(label ? [{ text: label, dim: true }] : []), ...wrap(text, width - 2).map(line => ({ text: line, dim: false })),
                  ]),
                ].filter((line, i) => i > 0 || line.text !== '')
                const said = item.at ? `${item.kind === 'daily' ? 'summary' : item.kind === 'update' ? 'update' : 'urgent mail'}, ${ago(now - Date.parse(item.at))} ago` : ''
                return (
                  <Box key={`ov-item-${index}`} flexDirection="column">
                    <Button key={`ov-item-row-${index}`} plain onPress={() => flipOverview(key)}>
                      <Text color={mark.tone}>{mark.glyph}</Text> <Text bold={isOpen}>{fit(item.title.replace(/\s+/g, ' '), titleWidth)}</Text>
                      {spark && <Text color={mark.tone}> {spark.padEnd(SPARK_WIDTH)}</Text>}
                      {tag && <Text dimColor> {tag}</Text>}
                    </Button>
                    {isOpen && (
                      <Box flexDirection="column" marginBottom={1}>
                        {lines.map((line, i) => (
                          <Text key={`ov-item-${index}-line-${i}`}><Text dimColor>│ </Text><Text dimColor={line.dim}>{line.text}</Text></Text>
                        ))}
                        <Box flexDirection="row" gap={1}>
                          <Text dimColor>└</Text>
                          <Button key={`ov-ask-${index}`} label="Ask" dimColor onPress={() => askItem(item)} />
                          {item.issue && ovBase && <Button key={`ov-issue-${index}`} label={item.issue} dimColor onPress={() => openPr(`${ovBase}/issues/${encodeURIComponent(item.issue!)}`)} />}
                          {item.pull && ovBase && <Button key={`ov-pull-${index}`} label="View PR" dimColor onPress={() => openPr(`${ovBase}/pulls/${item.pull!.number}`)} />}
                          {said && <Text dimColor>{said}</Text>}
                        </Box>
                      </Box>
                    )}
                  </Box>
                )
              })}
              <Box marginTop={1} />
              {tabLink('pulls', 'PR Verifications', summary(prs), 'none deployed lately')}
              {tabLink('issues', 'Issues', issueSummary(issues?.issues ?? []), issues ? 'none open' : 'reading…')}
            </Box>
          )}
        </Box>
      )

      const isBusy = tab === 'issues' ? isRefreshingIssues : tab === 'overview' ? isRefreshingOverview : isRefreshing

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={2}>
            <Button key="tab-overview" plain dimColor={tab !== 'overview'} onPress={() => void show($, 'overview')}><Text bold={tab === 'overview'}>{tab === 'overview' ? '▸ ' : '  '}Overview</Text></Button>
            <Button key="tab-pulls" plain dimColor={tab !== 'pulls'} onPress={() => void show($, 'pulls')}><Text bold={tab === 'pulls'}>{tab === 'pulls' ? '▸ ' : '  '}PR Verifications</Text></Button>
            <Button key="tab-issues" plain dimColor={tab !== 'issues'} onPress={() => void show($, 'issues')}><Text bold={tab === 'issues'}>{tab === 'issues' ? '▸ ' : '  '}Issues</Text></Button>
            <Text dimColor wrap="truncate-end">{knownApp() ?? repo}</Text>
          </Box>
          {tab === 'issues' ? issuesBody : tab === 'overview' ? overviewBody : pullsBody}
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
