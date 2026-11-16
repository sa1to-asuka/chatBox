import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { InputContent } from './shared.js'
import {
  ToolUnsupportedError,
  isToolError,
  usageFrom,
  type ChatTool,
  type ProviderTurn,
  type RoundPart,
  type RoundResult,
  type ToolCall,
} from './turns.js'

const content = (value: InputContent) => {
  if (typeof value === 'string') return value
  return value.map((part) => {
    if (part.type === 'text') return { type: 'text' as const, text: part.text }
    if (part.type === 'image') {
      return { type: 'image_url' as const, image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
    }
    return { type: 'text' as const, text: `附件「${part.name}」内容：\n\n${part.text}` }
  })
}

const messagesOf = (turns: ProviderTurn[], system?: string): ChatCompletionMessageParam[] => {
  const result: ChatCompletionMessageParam[] = []
  if (system) result.push({ role: 'system', content: system })
  for (const turn of turns) {
    if (turn.role === 'user') {
      result.push({ role: 'user', content: content(turn.content) as ChatCompletionMessageParam['content'] } as ChatCompletionMessageParam)
    } else if (turn.role === 'tool') {
      result.push({ role: 'tool', tool_call_id: turn.toolCallId, content: turn.content })
    } else {
      result.push({
        role: 'assistant',
        content: turn.text || null,
        ...(turn.toolCalls?.length
          ? {
              tool_calls: turn.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
              })),
            }
          : {}),
      } as ChatCompletionMessageParam)
    }
  }
  return result
}

export async function* runOpenAIRound(
  provider: { key: string; base_url: string },
  input: {
    model: string
    system?: string
    messages: ProviderTurn[]
    maxTokens: number
    thinking: boolean
    tools?: ChatTool[]
    nativeWebSearch?: boolean
    signal: AbortSignal
  }
): AsyncGenerator<RoundPart, RoundResult> {
  const client = new OpenAI({ apiKey: provider.key, baseURL: provider.base_url, timeout: 120_000, maxRetries: 0 })
  const messages = messagesOf(input.messages, input.system)
  const tools = input.tools?.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }))
  let stream
  try {
    stream = await client.chat.completions.create({
      model: input.model,
      messages,
      stream: true,
      max_tokens: input.maxTokens,
      stream_options: { include_usage: true },
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
      ...(input.nativeWebSearch ? { web_search_options: {} } : {}),
    } as Parameters<typeof client.chat.completions.create>[0], { signal: input.signal })
  } catch (error) {
    if (tools?.length && isToolError(error)) throw new ToolUnsupportedError()
    throw error
  }

  let text = ''
  let thinkingText = ''
  let outputChars = 0
  let usageInput = 0
  let usageOutput = 0
  let hasUsage = false
  let finishReason: string | null = null
  const calls = new Map<number, { id: string; name: string; args: string }>()
  const thinkingParts: { text: string; signature?: string }[] = []

  for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
    if (chunk.usage) {
      usageInput += chunk.usage.prompt_tokens
      usageOutput += chunk.usage.completion_tokens
      hasUsage = true
    }
    for (const choice of chunk.choices) {
      finishReason = choice.finish_reason ?? finishReason
      const delta = choice.delta as unknown as {
        content?: string | null
        reasoning_content?: string | null
        reasoning?: string | null
        annotations?: { type?: string; url_citation?: { url?: unknown; title?: unknown } }[]
        tool_calls?: {
          index?: number
          id?: string
          function?: { name?: string; arguments?: string }
        }[]
      }
      const reasoning = typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string' ? delta.reasoning : ''
      if (reasoning && input.thinking) {
        thinkingText += reasoning
        outputChars += [...reasoning].length
        yield { kind: 'thinking', text: reasoning }
      }
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content
        outputChars += [...delta.content].length
        yield { kind: 'text', text: delta.content }
      }
      for (const annotation of delta.annotations ?? []) {
        if (annotation.type !== 'url_citation' || typeof annotation.url_citation?.url !== 'string') continue
        const url = annotation.url_citation.url
        if (!/^https?:\/\//i.test(url)) continue
        yield {
          kind: 'citation',
          url,
          title: typeof annotation.url_citation.title === 'string' ? annotation.url_citation.title : url,
        }
      }
      for (const fragment of delta.tool_calls ?? []) {
        const index = fragment.index ?? calls.size
        const current = calls.get(index) ?? { id: '', name: '', args: '' }
        if (fragment.id) current.id = fragment.id
        if (fragment.function?.name) current.name += fragment.function.name
        if (fragment.function?.arguments) current.args += fragment.function.arguments
        calls.set(index, current)
      }
    }
  }

  const toolCalls: ToolCall[] = [...calls.values()]
    .filter((call) => call.name)
    .map((call) => {
      let inputValue: unknown = {}
      try {
        inputValue = call.args ? JSON.parse(call.args) : {}
      } catch {
        inputValue = { __parse_error: true, raw: call.args }
      }
      return { id: call.id || `call_${Math.random().toString(36).slice(2)}`, name: call.name, input: inputValue }
    })
  if (thinkingText) thinkingParts.push({ text: thinkingText })
  const estimatedInput = Math.ceil(JSON.stringify(messages).length / 2.5)
  const usage = hasUsage
    ? usageFrom(usageInput, usageOutput, false)
    : usageFrom(estimatedInput, Math.ceil(outputChars / 2.5), true)
  const stopReason = toolCalls.length > 0
    ? 'tool_use'
    : finishReason === 'length' ? 'max_tokens' : 'end_turn'
  return {
    text,
    thinking: thinkingParts,
    toolCalls,
    stopReason,
    usage,
    assistantTurn: { role: 'assistant', text, toolCalls, thinking: thinkingParts },
  }
}
