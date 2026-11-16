// A pull request this session opened that no deploy has shipped yet. The same fields as Merged in hooks/logic.ts.
export type Created = { number: number; title: string; url: string; mergedAt: string }

declare module 'claude-code' {
  interface PluginState {
    packrat: { created: Shaped<Created[]> }
  }
}
