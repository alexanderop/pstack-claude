export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type PotetoTodo = { id: string; content: string; status: TodoStatus }

export type PotetoAgent = { id: string; type: string; description: string }

export type PotetoRun = {
  isActive: boolean
  step: string | null
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
