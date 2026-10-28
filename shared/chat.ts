// Chat with Claude from inside the app: shared between server and browser.

export interface ChatTool {
  id: string
  name: string
  summary: string
  state: 'running' | 'ok' | 'error'
}
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  by?: string
  /** What the user had selected when they asked, shown as a chip. */
  context?: string
  tools?: ChatTool[]
  pending?: boolean
  stopped?: boolean
  error?: string
  costUsd?: number
  ms?: number
}
export interface ChatSettings {
  claudePath?: string
  model?: string
}
export interface ChatStatus {
  available: boolean
  path?: string
  version?: string
  loggedIn: boolean
  authMethod?: string
  error?: string
  model?: string
}
