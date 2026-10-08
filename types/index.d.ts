export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type PotetoTodo = { id: string; content: string; status: TodoStatus }

export type AgentStatus = 'running' | 'done'

export type PotetoAgent = { id: string; agentId: string | null; type: string; description: string; status: AgentStatus }

export type PotetoRun = {
  isActive: boolean
  doneMs: number | null
  startedAt: number | null
  isWaiting: boolean
  step: string | null
  steps: string[]
  stepIndex: number | null
  playbook: string | null
  principles: string[]
  skills: string[]
  agents: PotetoAgent[]
  todos: PotetoTodo[]
}

declare module 'claude-code' {
  interface PluginState {
    pstack: { isOn: boolean; run: PotetoRun; isBandHidden: boolean }
  }
}
