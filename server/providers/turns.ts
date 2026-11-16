import type { InputContent } from './shared.js'
import type { ChatUsage } from '../../shared/types.js'

export type ChatTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ToolCall = { id: string; name: string; input: unknown }

export type ProviderTurn =
  | { role: 'user'; content: InputContent }
  | {
      role: 'assistant'
      text: string
      toolCalls?: ToolCall[]
      thinking?: { text: string; signature?: string }[]
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean }

export type RoundPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'citation'; url: string; title: string }

export type RoundResult = {
  text: string
  thinking: { text: string; signature?: string }[]
  toolCalls: ToolCall[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens'
  usage: ChatUsage
  assistantTurn: Extract<ProviderTurn, { role: 'assistant' }>
}

export class ToolUnsupportedError extends Error {
  constructor(message = 'provider does not support tools') {
    super(message)
    this.name = 'ToolUnsupportedError'
  }
}

export const isToolError = (error: unknown): boolean => {
  if (error instanceof ToolUnsupportedError) return true
  const value = error as { status?: number; message?: string; error?: { message?: string } }
  const status = value?.status
  const message = `${value?.message ?? ''} ${value?.error?.message ?? ''}`
  if (status && ![400, 404, 422].includes(status)) return false
  return /tool|function|web_search|function_call/i.test(message)
}

export const usageFrom = (input: number, output: number, estimated = false): ChatUsage => ({
  input, output, estimated,
})
