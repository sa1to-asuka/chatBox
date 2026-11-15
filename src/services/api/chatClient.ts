import { readServerSentEvents } from './sse.js'
import type { MessageStreamEvent } from './types.js'
export { ApiError, type ApiErrorKind } from './client.js'

export class ChatRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'ChatRequestError'
  }
}
export type ChatStreamRequest = {
  sessionId: string; requestId: string; modelId: string
  prompt: string; history: { role: 'user' | 'assistant'; content: string }[]
  attachmentIds: string[]; thinking: boolean; search: boolean
}
export async function* streamChat(input: ChatStreamRequest, signal: AbortSignal): AsyncGenerator<MessageStreamEvent> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
  })
  if (!response.ok) {
    const data = await response.json() as { error?: string; code?: string }
    throw new ChatRequestError(data.error ?? '请求失败', response.status, data.code)
  }
  if (!response.body) {throw new Error('浏览器不支持流式响应')}
  for await (const event of readServerSentEvents(response.body)) {
    if (event.event === 'request') {continue}
    if (event.event === 'stream_error') {
      const error = JSON.parse(event.data) as { error: string; code?: string }
      throw new ChatRequestError(error.error, 502, error.code)
    }
    yield JSON.parse(event.data) as MessageStreamEvent
    if (event.event === 'message_stop') {return}
  }
}
