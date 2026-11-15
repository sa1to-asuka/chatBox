import { randomUUID } from 'node:crypto'

export type InputContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'document'; text: string; name: string }
>
export type InputMessage = { role: 'user' | 'assistant'; content: InputContent }
import type { ChatUsage, SearchMode } from '../../shared/types.js'
export type ChatInput = {
  model: string; messages: InputMessage[]; maxTokens: number; thinking: boolean
  searchMode: SearchMode
  signal: AbortSignal; usage: ChatUsage
}
export type Provider = { id: string; name: string; type: 'openai' | 'anthropic'; base_url: string; key: string }
export const event = (type: string, data: unknown): string => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
export const messageStart = (model: string): string => event('message_start', {
  type: 'message_start', message: { id: randomUUID(), model },
})
export const messageStop = (usage: { input: number; output: number }): string =>
  event('message_delta', {
    type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { input_tokens: usage.input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: usage.output },
  }) + event('message_stop', { type: 'message_stop' })
export const textEvent = (index: number, text: string): string =>
  event('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
export const citationEvent = (index: number, url: string, title: string): string =>
  event('content_block_delta', {
    type: 'content_block_delta', index,
    delta: {
      type: 'citations_delta',
      citation: { type: 'web_search_result_location', url, title, cited_text: '', encrypted_index: '' },
    },
  })
export const blockStart = (index: number, type: 'text' | 'thinking'): string =>
  event('content_block_start', { type: 'content_block_start', index, content_block: type === 'text' ? { type, text: '' } : { type, thinking: '', signature: '' } })
export const blockStop = (index: number): string => event('content_block_stop', { type: 'content_block_stop', index })
