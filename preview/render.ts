// Draws a pane's tree as terminal text: a column box stacks its children, a row box sets them side by side with
// its gap, and text keeps its colour, dimness, underline and inverse as ANSI codes. Close enough to Claude Code's own drawing to judge
// a layout, not a copy of it.
type Node = string | number | null | undefined | boolean | { type: string; props?: Record<string, unknown>; children?: Node[] }

const TONES: Record<string, string> = { error: '31', success: '32', warning: '33', suggestion: '34', subtle: '90' }

function style(text: string, props: Record<string, unknown>) {
  const codes = [props.bold ? '1' : '', props.dimColor ? '2' : '', props.underline ? '4' : '', props.inverse ? '7' : '', TONES[String(props.backgroundColor ?? '')]?.replace(/^./, (d: string) => d === '9' ? '10' : '4') ?? '', TONES[String(props.color ?? '')] ?? ''].filter(Boolean)
  return codes.length > 0 && text ? `\x1b[${codes.join(';')}m${text}\x1b[0m` : text
}

function inline(node: Node, inherited: Record<string, unknown> = {}): string {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return style(String(node), inherited)
  const props = { ...inherited, ...(node.props ?? {}) }
  const children = node.children ?? []
  if (node.type === 'Button' && children.length === 0) return style(`[${String(props.label ?? '')}]`, props)
  // Claude Code draws a plain Button's hotkey before it, `1: `, in the accent colour.
  const key = node.type === 'Button' && node.props?.plain && node.props.hotkey ? `${style(String(node.props.hotkey), { color: 'suggestion' })}: ` : ''
  return key + children.map(child => inline(child, props)).join('')
}

export function render(node: Node): string[] {
  if (node === null || node === undefined || typeof node !== 'object') return []
  const props = node.props ?? {}
  const children = node.children ?? []
  if (node.type !== 'Box') return [inline(node)]
  const blank = Array.from({ length: Number(props.marginTop ?? 0) }, () => '')
  const after = Array.from({ length: Number(props.marginBottom ?? 0) }, () => '')
  if (props.flexDirection === 'row') {
    const gap = ' '.repeat(Number(props.gap ?? 0))
    return [...blank, children.map(child => (typeof child === 'object' && child && child.type === 'Box' ? render(child).join(' ') : inline(child))).filter(Boolean).join(gap), ...after]
  }
  return [...blank, ...children.flatMap(child => render(child)), ...after]
}

// Breaks a drawn line at width visible characters, carrying its colour codes over the break.
export function fold(line: string, width: number): string[] {
  const out: string[] = []
  let current = ''
  let shown = 0
  let open = ''
  for (const token of line.match(/\x1b\[[0-9;]*m|[\s\S]/gu) ?? []) {
    if (token.startsWith('\x1b[')) {
      current += token
      open = token === '\x1b[0m' ? '' : open + token
      continue
    }
    if (shown === width) {
      out.push(current + (open ? '\x1b[0m' : ''))
      current = open
      shown = 0
    }
    current += token
    shown += 1
  }
  out.push(current)
  return out
}
