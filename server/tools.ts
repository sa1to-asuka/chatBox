import { randomUUID } from 'node:crypto'
import type { UserRow } from './auth.js'
import type { AgentConfig, SearchBackend, SearchModel } from './agent-config.js'
import { searchWeb, type SearchOutcome } from './search.js'
import type { ChatTool } from './providers/turns.js'
import {
  artifactPayload,
  createGeneratedTask,
  renderGeneratedTask,
  type GeneratedArtifact,
} from './artifacts.js'
import type { WorkspaceTaskRow } from './workspace.js'
import { readWorkspaceTask } from './workspace.js'

export type ToolContext = {
  user: UserRow
  modelId: string
  requestId: string
  signal: AbortSignal
  config: AgentConfig
  backend: SearchBackend | null
  summaryModel: SearchModel | null
  activePlugin: string | null
  searchCache: Map<string, SearchOutcome>
  searchedOk: boolean
  searchAttempts: number
  searchFailures: number
  fileCount: number
}

const searchTool: ChatTool = {
  name: 'web_search',
  description: '检索实时网页，返回摘要和来源 URL。用于新闻、价格、政策、统计数据、版本、赛事等最新事实。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '具体的搜索词，包含主题、时间范围或关键实体' },
    },
    required: ['query'],
    additionalProperties: false,
  },
}

const fileTool: ChatTool = {
  name: 'create_file',
  description: '把最终内容保存为可下载的 PPT、Word 或 Excel 文件，并加入文件管理。生成 PPT 前应先联网核实数据。',
  inputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['pptx', 'docx', 'xlsx'], description: '输出格式' },
      title: { type: 'string', description: '文件名和文档标题，不带扩展名' },
      content: {
        type: 'string',
        description: 'pptx 为演示文稿 JSON 字符串；docx 为 Markdown；xlsx 为 CSV。',
      },
    },
    required: ['format', 'title', 'content'],
    additionalProperties: false,
  },
}

export const activeTools = (ctx: ToolContext): ChatTool[] => {
  const tools: ChatTool[] = []
  if (ctx.backend) tools.push(searchTool)
  if (ctx.activePlugin === 'pptx' || ctx.activePlugin === 'docx' || ctx.activePlugin === 'xlsx') {
    tools.push(fileTool)
  }
  return tools
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export const runSearchTool = async (
  ctx: ToolContext,
  args: unknown
): Promise<{
  outcome: SearchOutcome
  usage?: { input: number; output: number; estimated: boolean }
  summaryUsed: boolean
}> => {
  if (!ctx.backend) {
    return { outcome: { ok: false, code: 'search_unavailable', error: '未配置联网搜索后端' }, summaryUsed: false }
  }
  const query = typeof asObject(args).query === 'string' ? String(asObject(args).query).trim() : ''
  if (!query) {
    return { outcome: { ok: false, code: 'search_empty', error: '搜索词为空' }, summaryUsed: false }
  }
  const key = query.toLowerCase()
  const cached = ctx.searchCache.get(key)
  if (cached) return { outcome: cached, summaryUsed: false }
  const outcome = await searchWeb(ctx.backend, query, {
    signal: ctx.signal,
    summaryModel: ctx.summaryModel,
  })
  ctx.searchCache.set(key, outcome)
  ctx.searchAttempts += 1
  if (outcome.ok) {
    ctx.searchedOk = true
  } else {
    ctx.searchFailures += 1
  }
  return { outcome, usage: outcome.ok ? outcome.usage : undefined, summaryUsed: Boolean(outcome.ok && outcome.usage) }
}

type FileToolError = { ok: false; error: string }

export const prepareFileTool = (
  ctx: ToolContext,
  args: unknown,
  callId: string
): { ok: true; task: WorkspaceTaskRow; artifact: GeneratedArtifact } | FileToolError => {
  const value = asObject(args)
  const format = value.format
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 100) : ''
  const raw = value.content
  const content = typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw)
  if (format !== 'pptx' && format !== 'docx' && format !== 'xlsx') {
    return { ok: false, error: 'create_file 只支持 pptx、docx、xlsx' }
  }
  if (ctx.activePlugin !== format) {
    return { ok: false, error: `当前任务模式不能生成 ${format} 文件` }
  }
  if (!title) return { ok: false, error: '文件名不能为空' }
  if (!content.trim()) return { ok: false, error: '文件内容不能为空' }
  if (content.length > 120_000) return { ok: false, error: '文件内容超过 120000 字符限制' }
  if (ctx.fileCount >= ctx.config.maxFiles) return { ok: false, error: `本次最多生成 ${ctx.config.maxFiles} 个文件` }
  if (format === 'pptx' && ctx.backend && !ctx.searchedOk && ctx.searchFailures < 2) {
    return { ok: false, error: '请先调用 web_search 获取最新资料，再生成演示文稿' }
  }
  ctx.fileCount += 1
  try {
    const task = createGeneratedTask({
      user: ctx.user,
      modelId: ctx.modelId,
      format,
      title,
      content,
      idempotencyKey: `${ctx.requestId}:${callId}`,
    })
    return { ok: true, task, artifact: artifactPayload(task) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '创建文件任务失败' }
  }
}

export const finishFileTool = async (
  task: WorkspaceTaskRow
): Promise<{ ok: true; artifact: GeneratedArtifact } | { ok: false; error: string; task: WorkspaceTaskRow }> => {
  if (task.status === 'failed') return { ok: false, error: task.error || '文件生成失败', task }
  if (task.status === 'done') return { ok: true, artifact: artifactPayload(task) }
  try {
    const done = await renderGeneratedTask(task.id)
    if (done.status !== 'done') return { ok: false, error: done.error || '文件生成失败', task: done }
    return { ok: true, artifact: artifactPayload(done) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '文件生成失败',
      task: readWorkspaceTask(task.id) ?? task,
    }
  }
}

export const runCreateFileTool = async (
  ctx: ToolContext,
  args: unknown,
  callId: string,
  onCreated?: (artifact: GeneratedArtifact) => void
): Promise<{ ok: true; artifact: GeneratedArtifact } | { ok: false; error: string; task?: WorkspaceTaskRow }> => {
  const prepared = prepareFileTool(ctx, args, callId)
  if (!prepared.ok) return prepared
  onCreated?.(prepared.artifact)
  return finishFileTool(prepared.task)
}

export const newToolContext = (input: Omit<ToolContext, 'searchCache' | 'searchedOk' | 'searchAttempts' | 'searchFailures' | 'fileCount'>): ToolContext => ({
  ...input,
  searchCache: new Map(),
  searchedOk: false,
  searchAttempts: 0,
  searchFailures: 0,
  fileCount: 0,
})

export const toolCallId = (name: string): string => `${name}_${randomUUID().slice(0, 12)}`
