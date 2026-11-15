import OpenAI from 'openai'
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { ChatInput, InputContent, Provider } from './shared.js'
import { blockStart, blockStop, citationEvent, messageStart, messageStop, textEvent, thinkingEvent } from './shared.js'
import type { ChatUsage, ProviderModel } from '../../shared/types.js'

const content = (value: InputContent): string | ChatCompletionContentPart[] => {
  if (typeof value === 'string') return value
  return value.map((part): ChatCompletionContentPart => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') return { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
    return { type: 'text', text: `附件「${part.name}」内容：\n\n${part.text}` }
  })
}
export const listOpenAIModels = async (provider: Provider): Promise<ProviderModel[]> => {
  const client = new OpenAI({ apiKey: provider.key, baseURL: provider.base_url, timeout: 30000, maxRetries: 0 })
  const models: ProviderModel[] = []
  for await (const model of await client.models.list()) models.push({ id: model.id, name: model.id })
  return models
}
export async function* streamOpenAI(provider: Provider, input: ChatInput): AsyncGenerator<string, ChatUsage> {
  const client = new OpenAI({ apiKey: provider.key, baseURL: provider.base_url, timeout: 120000, maxRetries: 0 })
  const messages: ChatCompletionMessageParam[] = input.messages.map((message): ChatCompletionMessageParam => message.role === 'user'
    ? { role: 'user', content: content(message.content) }
    : { role: 'assistant', content: typeof message.content === 'string' ? message.content : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') })
  const stream = await client.chat.completions.create({
    model: input.model, messages, stream: true, max_tokens: input.maxTokens,
    stream_options: { include_usage: true },
    ...(input.searchMode === 'openai' ? { web_search_options: {} } : {}),
  }, { signal: input.signal })
  yield messageStart(input.model)
  let index = -1
  let open: 'text' | 'thinking' | null = null
  let outputChars = 0
  const usage = input.usage
  const startBlock = (type: 'text' | 'thinking') => {
    if (open === type) return ''
    const close = open ? blockStop(index) : ''
    open = type
    index++
    return close + blockStart(index, type)
  }
  for await (const chunk of stream) {
    if (chunk.usage) {
      usage.input = chunk.usage.prompt_tokens
      usage.output = chunk.usage.completion_tokens
      usage.estimated = false
    }
    for (const choice of chunk.choices) {
      const delta = choice.delta as unknown as {
        content?: string | null
        reasoning_content?: string | null
        reasoning?: string | null
        annotations?: { type?: string; url_citation?: { url?: unknown; title?: unknown } }[]
      }
      // DeepSeek 用 reasoning_content，OpenRouter 等兼容接口用 reasoning；有就转成思考块。
      const reasoning = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : ''
      if (reasoning && input.thinking) {
        const start = startBlock('thinking')
        if (start) yield start
        outputChars += [...reasoning].length
        if (usage.estimated) usage.output = Math.ceil(outputChars / 2.5)
        yield thinkingEvent(index, reasoning)
      }
      const text = delta.content
      if (text) {
        const start = startBlock('text')
        if (start) yield start
        outputChars += [...text].length
        if (usage.estimated) usage.output = Math.ceil(outputChars / 2.5)
        yield textEvent(index, text)
      }
      for (const annotation of delta.annotations ?? []) {
        if (annotation.type !== 'url_citation' || typeof annotation.url_citation?.url !== 'string') continue
        const url = annotation.url_citation.url
        if (!/^https?:\/\//i.test(url)) continue
        const start = startBlock('text')
        if (start) yield start
        yield citationEvent(index, url, typeof annotation.url_citation.title === 'string' ? annotation.url_citation.title : url)
      }
    }
  }
  if (open) yield blockStop(index)
  if (usage.estimated) usage.output = Math.ceil(outputChars / 2.5)
  yield messageStop(usage)
  return usage
}
