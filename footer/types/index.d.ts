declare module 'claude-code' {
  export type FooterProject = { folder: string; branch: string; model: string }
  export type FooterMetrics = {
    contextPercent: number | null
    estimated: boolean
    limits: SessionRateLimit[]
    cost: number | null
  }
  interface PluginState {
    footer: {
      project: FooterProject | null
      metrics: FooterMetrics | null
    }
  }
}
