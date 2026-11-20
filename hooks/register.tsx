import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import {
  type Check,
  type IssueLink,
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
  createdPull,
  wrap,
  deployed,
  fit,
  NO_CHECKS,
  NEW_CHIP,
  NO_CHIP,
  tabLabel,
  rereadAfter,
  isLive,
  issueDetails,
  issueSummary,
  issueTally,
  issueLinkParts,
  issueUrl,
  linkedIssueUrl,
  linkedPullUrl,
  severityMark,
  summary,
  toPr,
  verdict,
  verificationUrl,
  verifies,
  waitingLine,
} from './logic'

type Api = Parameters<Hook<'session.start'>>[0]

const PANE = 'packrat'
const POLL_MS = 60_000
const ISSUES_LISTED = 25
// After the name of a check the day-after review failed, as the site shows a Review chip.
const REVIEW = ' review'
// Module state, as pr-monitor keeps it: a reload starts it over and the next poll fills it again.
let root = ''
let repo: string | null = null
let cli = 'packrat'
let limit = 12
let site = 'https://packrat.sh'
let prs: Pr[] = []
// The pull requests this session opened that no deploy has shipped yet. Only these are shown before their deploy:
// a team's open pull requests would fill the pane. Kept in the session's state, which a reload of the plugin leaves.
const created = atom({ plugin: 'packrat', key: 'created' } as const, [], { shape: 'created-1' })
const DECLARE_ASKS = 5
const DECLARE_WAIT_MS = 2_000
let waiting: Pr[] = []
let checkedAt = 0
let isRefreshing = false
let lastError: string | null = null
// A row keeps the state it was last drawn in, so a verdict arriving does not close a row someone is reading.
const opened = new Map<number, boolean>()
type Tab = 'pulls' | 'issues'
let tab: Tab = 'pulls'
const TABS: [Tab, string][] = [['pulls', 'PR Verifications'], ['issues', 'Issues']]
let issues: IssueList | null = null
let issuesCheckedAt = 0
let isRefreshingIssues = false
let issuesError: string | null = null
let pulling: Promise<void> | null = null
let caughtUpAt = 0
const openIssues = new Set<string>()
// The pull requests the person opened, as against ones that opened by themselves while live: only these are seen.
const openedByHand = new Set<number>()
// The checks of an open pull request whose results were new when it was opened, so their chips stay while it is open.
const freshChecks = new Map<number, Set<string>>()
// Once a tab has had a new row, it keeps the chip column, so titles do not move as the last one is read.
const chipColumn = { pulls: false, issues: false }
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

// Marks a row seen as the person opens it. A CLI without `seen` fails, which costs a log line and nothing else.
async function markSeen($: Api, kind: 'pr' | 'issues', id: string) {
  const ran = await $.process.run([cli, kind, 'seen', id], { cwd: root, timeoutMs: 30_000 })
  if (ran.exitCode !== 0) {
    void log($, `${cli} ${kind} seen ${id}: ${ran.stderr.trim().split('\n')[0] ?? `exit ${ran.exitCode}`}`)
    return
  }
  if (kind === 'pr') {
    const number = Number(id)
    const read = (pr: Pr) => ({ ...pr, unread: false, checks: pr.checks.map(check => ({ ...check, new: false })) })
    prs = prs.map(pr => (pr.number === number ? read(pr) : pr))
    const held = kept.get(number)
    if (held) held.answer = { ...held.answer, unread: false, checks: held.answer.checks.map(check => ({ ...check, new: false })) }
  } else if (issues) {
    issues = { ...issues, issues: issues.issues.map(issue => (issue.id === id ? { ...issue, unread: false } : issue)) }
  }
  $.ui.invalidate('ui.render')
}

function openPull($: Api, number: number) {
  opened.set(number, true)
  openedByHand.add(number)
  const pr = prs.find(row => row.number === number)
  freshChecks.set(number, new Set(pr?.checks.filter(check => check.new).map(check => check.id) ?? []))
  if (pr?.unread) void markSeen($, 'pr', String(number))
}

function closePull(number: number) {
  opened.set(number, false)
  openedByHand.delete(number)
  freshChecks.delete(number)
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
    const shipped = new Set(prs.map(pr => pr.number))
    if ((await read($, created)).some(pr => shipped.has(pr.number))) await update($, created, list => list.filter(pr => !shipped.has(pr.number)))
    const opened = await read($, created)
    const declared = await Promise.all(opened.map(pr => readPull($, pr.number)))
    waiting = opened.map((pr, i) => toPr(pr, declared[i] ?? null))
    checkedAt = await $.clock.now()
    // A change that arrives while the person has the row open, they see.
    for (const pr of prs) if (pr.unread && openedByHand.has(pr.number)) void markSeen($, 'pr', String(pr.number))
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
    for (const issue of issues.issues) if (issue.unread && openIssues.has(issue.id)) void markSeen($, 'issues', issue.id)
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

// Opens the pane on a pull request `gh pr create` just opened, when Packrat verifies its repository. Nothing is
// started for a repository it does not: one question to the CLI, and no pane.
async function showCreated($: Api, command: string, output: string) {
  try {
    const found = createdPull(command, output)
    if (found === null) return
    const here = await $.session.root()
    const packrat = String(pluginOptions.cli ?? '').trim() || `${$.plugin.root}/bin/packrat`
    // The plugin's command hook declares the checks after this runs, so a new app is asked again until it has.
    for (let asked = 1; ; asked++) {
      const shown = await $.process.run([packrat, 'pr', 'show', String(found.number), '--json'], { cwd: here, timeoutMs: 30_000 })
      if (shown.exitCode !== 0) return
      if (verifies(JSON.parse(shown.stdout) as PullAnswer)) break
      if (asked === DECLARE_ASKS) return
      await $.clock.sleep(DECLARE_WAIT_MS)
    }
    await start($)
    if (repo?.toLowerCase() !== found.repo.toLowerCase()) return
    const viewed = await $.process.run(['gh', 'pr', 'view', String(found.number), '--json', 'title', '-q', '.title'], { cwd: root, timeoutMs: 20_000 })
    const opened: Merged = { number: found.number, title: viewed.exitCode === 0 ? viewed.stdout.trim() : '', url: found.url, mergedAt: '' }
    await update($, created, list => [...list.filter(pr => pr.number !== opened.number), opened])
    tab = 'pulls'
    // Not focused: the person is in the chat, and did not ask for this.
    await $.ui.open({ id: PANE, title: 'Packrat' })
    await refresh($)
    // The plugin's command hook declares the checks after this runs, so the row is read once more for their count.
    await refresh($)
  } catch (error) {
    void log($, `showing a new pull request failed: ${String(error)}`)
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

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) void showCreated($, e.command, ran.result.stdout)

    return ran
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

      if (prs.some(pr => pr.unread)) chipColumn.pulls = true
      if (issues?.issues.some(issue => issue.unread)) chipColumn.issues = true

      const toggle = (n: number) => {
        if (opened.get(n)) closePull(n)
        else openPull($, n)
        $.ui.invalidate('ui.render')
      }
      const ask = (n: number) => void $.prompt.fill({ text: `/packrat:ask how did PR ${n} do`, mode: 'replace' })
      const openPr = (url: string) => void $.process.run(['open', url], { timeoutMs: 10_000 })
      // A pull request named on another's row opens its own row when the pane lists it, and its page when not.
      const showPull = (from: Pr, n: number) => {
        if (prs.some(pr => pr.number === n)) {
          openPull($, n)
          $.ui.invalidate('ui.render')
        } else openPr(linkedPullUrl(from, n, site))
      }

      // An issue a pull request is linked to, its id and the other pull request as links.
      const linkLine = (pr: Pr, link: IssueLink, rail: string) => (
        <Box key={`link-${pr.number}-${link.link}-${link.id}`} flexDirection="row">
          <Text dimColor>{rail}</Text>
          {issueLinkParts(link).map((part, i) => {
            if ('text' in part) return <Text key={`t-${i}`} dimColor>{part.text}</Text>
            if ('issue' in part) {
              const url = linkedIssueUrl(pr, part.issue, site)
              return <Button key={`i-${i}`} plain onPress={() => url && openPr(url)}><Text color="suggestion">{part.issue}</Text></Button>
            }
            return <Button key={`p-${i}`} plain onPress={() => showPull(pr, part.pull)}><Text color="suggestion">#{part.pull}</Text></Button>
          })}
        </Box>
      )

      // An open pull request's checks hang off a rail that ends at its buttons, so the block reads as one thing.
      // A thing the day-after review found is a failed check named by what should be true, marked as the review's, with
      // what it found under it.
      const checkLines = (pr: Pr) =>
        pr.checks.map(check => {
          const mark = checkGlyph(check)
          const when = checkWhen(check, now)
          const found = check.source === 'day_after' && check.result === 'failed'
          const isNew = check.new === true || (freshChecks.get(pr.number)?.has(check.id) ?? false)
          const room = Math.max(10, width - 6 - WHEN_WIDTH - (found ? REVIEW.length : 0) - (isNew ? NEW_CHIP.length + 1 : 0))
          return (
            <Box key={`check-${check.id}`} flexDirection="column">
              <Text>
                <Text dimColor>│ </Text>{isNew && <Text backgroundColor="suggestion" color="inverseText" bold>{NEW_CHIP}</Text>}{isNew ? ' ' : ''}<Text color={mark.tone}>{mark.glyph}</Text> {fit(checkName(check), room)}{found && <Text dimColor>{REVIEW}</Text>} <Text dimColor>{when}</Text>
              </Text>
              {found && check.outcome && !pr.settled && (
                <Text>
                  <Text dimColor>│ </Text>  {fit(check.outcome, Math.max(10, width - 6))}
                </Text>
              )}
              {pr.issues.filter(link => link.check === check.id).map(link => linkLine(pr, link, '│   ↳ '))}
            </Box>
          )
        })

      // The issues no check of its own opened: the one its verdict opened, and the ones it fixes.
      const otherLinks = (pr: Pr) =>
        pr.issues.filter(link => !link.check || !pr.checks.some(check => check.id === link.check)).map(link => linkLine(pr, link, '│ '))

      const pullsBody = (
        <Box flexDirection="column">
          <Text>
            {summary(prs).map((part, i) => (
              <Text color={part.tone}>{i > 0 ? '  ' : ''}{part.text}</Text>
            ))}
            {prs.length === 0 && waiting.length === 0 && <Text dimColor>{isRefreshing ? 'Reading Packrat…' : 'No deployed pull requests yet.'}</Text>}
          </Text>
          {lastError !== null && <Text color="error" wrap="truncate-end">{lastError}</Text>}

          <Box marginTop={1} />
          {waiting.map(pr => (
            <Box key={`waiting-${pr.number}`} flexDirection="column" marginBottom={1}>
              <Text><Text color={VERDICTS.pending.tone}>{VERDICTS.pending.glyph}</Text> <Text bold>#{pr.number} {fit(pr.title, width - 8).trimEnd()}</Text></Text>
              <Text dimColor>└ {waitingLine(pr)}</Text>
            </Box>
          ))}
          {prs.map(pr => {
            const v = VERDICTS[verdict(pr.state)]
            const chip = chipColumn.pulls ? (pr.unread ? <Text backgroundColor="suggestion" color="inverseText" bold>{NEW_CHIP}</Text> : NO_CHIP) : null
            const titleWidth = width - 8 - (chipColumn.pulls ? NEW_CHIP.length + 1 : 0)
            // A pull request first drawn while live opens by itself, and stays open once it is not.
            if (!opened.has(pr.number)) opened.set(pr.number, isLive(pr, now))
            const isOpen = opened.get(pr.number)!
            return (
              <Box key={`row-${pr.number}`} flexDirection="column">
                <Button key={`pr-${pr.number}`} plain onPress={() => toggle(pr.number)}>
                  {chip}{chip !== null ? ' ' : ''}<Text color={pr.settled ? 'subtle' : v.tone}>{v.glyph}</Text> <Text bold={pr.unread} dimColor={!isOpen && !pr.unread && (verdict(pr.state) === 'worked' || pr.settled)}>#{pr.number} {fit(pr.title, titleWidth).trimEnd()}</Text>
                </Button>
                {isOpen && (
                  <Box flexDirection="column" marginBottom={1}>
                    {pr.checks.length === 0 && <Text dimColor>│ {NO_CHECKS}</Text>}
                    {checkLines(pr)}
                    {otherLinks(pr)}
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
        else {
          openIssues.add(id)
          if (listed.find(issue => issue.id === id)?.unread) void markSeen($, 'issues', id)
        }
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
            const chip = chipColumn.issues ? (issue.unread ? <Text backgroundColor="suggestion" color="inverseText" bold>{NEW_CHIP}</Text> : NO_CHIP) : null
            const titleWidth = Math.max(10, width - tally.length - (isAi ? 3 : 0) - 6 - (chipColumn.issues ? NEW_CHIP.length + 1 : 0))
            const url = issues && issueUrl(issue, { app: issues.app, org: issues.org || (prs.find(pr => pr.org !== null)?.org ?? undefined) }, env, site)
            return (
              <Box key={`issue-row-${issue.id}`} flexDirection="column">
                <Button key={`issue-${issue.id}`} plain onPress={() => toggleIssue(issue.id)}>
                  {chip}{chip !== null ? ' ' : ''}<Text color={mark.tone}>{mark.glyph}</Text> {isAi && <Text color="suggestion">AI </Text>}
                  <Text bold={issue.unread === true}>{fit(issue.title.replace(/\s+/g, ' '), titleWidth)}</Text> <Text dimColor>{tally}</Text>
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
      const unread = { pulls: prs.filter(pr => pr.unread).length, issues: listed.filter(issue => issue.unread).length }
      const labels = TABS.map(([key, label]) => [key, tabLabel(label, unread[key]), unread[key] > 0] as const)
      const tabsWidth = labels.reduce((n, [, label]) => n + label.length + 5, TABS.length * 2)

      const isBusy = tab === 'issues' ? isRefreshingIssues : isRefreshing

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={2}>
            {labels.map(([key, label, hasNew], i) => (
              <Button key={`tab-${key}`} plain hotkey={String(i + 1)} onPress={() => void show($, key)}>
                {tab === key ? <Text backgroundColor="suggestion" color="inverseText" bold> {label} </Text> : <Text dimColor={!hasNew} bold={hasNew}> {label} </Text>}
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
