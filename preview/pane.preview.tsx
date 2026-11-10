// The pane drawn from recorded answers, for script/preview. script/preview copies this file in as a test, beside
// recorded.ts, which holds what each command answered when it was fetched.
import { mock, test } from 'claude-code/testing'

import { recorded } from './recorded'
import { fold, render } from './render'

const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('preview', async ($, on) => {
  const clock = mock.clock(on, { now: recorded.at })
  mock.env(on, { HOME: '/home/dev' })
  on('session.root', async () => ({ value: '/repo' }))
  on('process.run', async (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.startsWith('gh repo view')) return answer(`${recorded.repo}\n`)
    if (argv.startsWith('gh pr list')) return answer(recorded.merged)
    const shown = argv.match(/ pr show (\d+) --json$/)
    if (shown) return answer(recorded.pulls[shown[1]!] ?? '{}')
    if (argv.endsWith(' overview --json')) return answer(recorded.overview)
    if (argv.includes(' issues --json')) return answer(recorded.issues)
    return { value: { exitCode: 1, stdout: '', stderr: `preview has no answer for ${argv}`, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', async () => ({ value: undefined }))

  await $.command.run({ command: 'packrat', args: recorded.tab })
  await clock.settle()
  const pane = await $.ui.mount({
    plugin: 'packrat', surface: 'terminal', component: 'Pane', requestId: 'packrat',
    props: { title: 'Packrat', isFocused: true, bodyColumns: recorded.width, placement: 'dock' } as never,
  })
  await clock.settle()
  for (const key of recorded.press) {
    await (pane as unknown as { press: (target: { key: string }) => Promise<void> }).press({ key })
    await clock.settle()
  }
  const lines = render(JSON.parse(JSON.stringify(await pane.drawn()))).flatMap(line => fold(line, recorded.width))
  console.log(['<<<preview', `${'─'.repeat(recorded.width)}`, ...lines, `${'─'.repeat(recorded.width)}`, 'preview>>>'].join('\n'))
})
