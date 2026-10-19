/** Whether a tool row's card shows its whole output. */
export type Expanded = boolean

declare module 'claude-code' {
  interface PluginState {
    'vscode-timeline': {
      /** One per tool row, by its tool_use_id. */
      expanded: StateFamily<Expanded>
    }
  }
}
