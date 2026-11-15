import Anthropic from '@anthropic-ai/sdk'
import type { ChatInput, InputContent, Provider } from './shared.js'
import { event } from './shared.js'
import type { ChatUsage, ProviderModel } from '../../shared/types.js'

const content = (value: InputContent): Anthropic.MessageParam['content'] => {
  if (typeof value === 'string') return value
  return value.map((part): Anthropic.ContentBlockParam => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(part.mimeType)) throw new Error('该模型不支持此图片格式')
      return { type: 'image', source: { type: 'base64', media_type: part.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: part.data } }
    }
    return { type: 'text', text: `附件「${part.name}」内容：\n\n${part.text}` }
  })
}
export const listAnthropicModels = async (provider: Provider): Promise<ProviderModel[]> => {
  const client = new Anthropic({ apiKey: provider.key, baseURL: provider.base_url, timeout: 30000, maxRetries: 0 })
  const models: ProviderModel[] = []
  for await (const model of await client.models.list()) models.push({ id: model.id, name: model.display_name || model.id })
  return models
}
export async function* streamAnthropic(provider: Provider, input: ChatInput): AsyncGenerator<string, ChatUsage> {
  const client = new Anthropic({ apiKey: provider.key, baseURL: provider.base_url, timeout: 120000, maxRetries: 0 })
  const messages: Anthropic.MessageParam[] = input.messages.map((message) => ({ role: message.role, content: content(message.content) }))
  const tools = input.searchMode === 'anthropic'
    ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]
    : input.searchMode === 'deepseek'
      ? [
          { type: 'deepseek_web_search', name: 'deepseek_web_search' },
          { type: 'deepseek_read_url', name: 'deepseek_read_url' },
        ]
      : []
  const thinking = input.searchMode === 'deepseek'
    ? { type: input.thinking ? 'enabled' : 'disabled' }
    : input.thinking
      ? { type: 'adaptive' as const, display: 'summarized' as const }
      : undefined
  const params = {
    model: input.model, messages, max_tokens: input.maxTokens,
    ...(tools.length ? { tools } : {}),
    ...(thinking ? { thinking } : {}),
    ...(input.searchMode === 'deepseek' ? { safety_check: { level: 'high' } } : {}),
  } as unknown as Parameters<typeof client.messages.stream>[0]
  const stream = client.messages.stream(params, { signal: input.signal })
  let outputChars = 0
  const usage = input.usage
  for await (const item of stream) {
    if (item.type === 'message_start') {
      usage.input = item.message.usage.input_tokens + (item.message.usage.cache_creation_input_tokens ?? 0) + (item.message.usage.cache_read_input_tokens ?? 0)
      usage.output = item.message.usage.output_tokens
      usage.estimated = false
      yield event('message_start', { type: 'message_start', message: { id: item.message.id, model: item.message.model, usage: item.message.usage } })
    } else if (item.type === 'content_block_start') {
      const block = item.content_block as unknown as Record<string, unknown>
      if (block.type === 'text' || block.type === 'thinking') {
        yield event('content_block_start', item)
      } else if (block.type === 'server_tool_use') {
        const raw = block.input as { query?: unknown; queries?: unknown; action?: unknown; url?: unknown } | undefined
        const queries = Array.isArray(raw?.queries)
          ? raw.queries.filter((query): query is string => typeof query === 'string')
          : typeof raw?.query === 'string' ? [raw.query] : []
        yield event('content_block_start', {
          type: 'content_block_start', index: item.index,
          content_block: {
            type: 'server_tool_use', id: block.id, name: block.name,
            input: raw?.url ? { action: 'read_link', url: raw.url } : { action: 'search', queries },
            caller: { type: 'direct' }, kind: raw?.url ? 'read_link' : 'search',
          },
        })
      } else if (block.type === 'web_search_tool_result') {
        const rawContent = Array.isArray(block.content) ? block.content : []
        const content = rawContent.map((entry) => {
          const value = entry as Record<string, unknown>
          if (value.type !== 'web_search_result') return value
          return {
            type: 'web_search_result',
            title: typeof value.title === 'string' ? value.title : String(value.url ?? ''),
            url: value.url,
            snippet: typeof value.snippet === 'string' ? value.snippet : '',
            site_name: typeof value.site_name === 'string' ? value.site_name : null,
            site_icon: typeof value.site_icon === 'string' ? value.site_icon : null,
            page_age: typeof value.page_age === 'string' ? value.page_age : null,
            encrypted_content: '',
          }
        })
        yield event('content_block_start', {
          type: 'content_block_start', index: item.index,
          content_block: { type: 'web_search_tool_result', tool_use_id: block.tool_use_id, content, kind: 'search' },
        })
      } else {
        yield event('content_block_start', item)
      }
    } else if (item.type === 'content_block_delta' && ['text_delta', 'thinking_delta', 'signature_delta', 'citations_delta'].includes(item.delta.type)) {
      if (item.delta.type === 'text_delta') outputChars += [...item.delta.text].length
      else if (item.delta.type === 'thinking_delta') outputChars += [...item.delta.thinking].length
      if (usage.estimated) usage.output = Math.ceil(outputChars / 2.5)
      yield event('content_block_delta', item)
    } else if (item.type === 'content_block_stop') {
      yield event('content_block_stop', item)
    } else if (item.type === 'message_delta') {
      usage.output = item.usage.output_tokens
      const toolUsage = (item.usage as unknown as { server_tool_use?: Record<string, unknown> }).server_tool_use
      if (toolUsage) {
        usage.searches = Object.values(toolUsage).reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0)
      }
      yield event('message_delta', { type: 'message_delta', delta: { stop_reason: item.delta.stop_reason ?? 'end_turn', stop_sequence: null }, usage: { input_tokens: usage.input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: usage.output } })
    }
  }
  yield event('message_stop', { type: 'message_stop' })
  return usage
}
