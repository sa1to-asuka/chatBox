import { createHash, randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { db } from './db.js'
import type { UserRow } from './auth.js'
import {
  generateOutput,
  readWorkspaceTask,
  workspaceTaskDir,
  type OutputFormat,
  type WorkspaceStep,
  type WorkspaceTaskRow,
} from './workspace.js'

const RETENTION_MS = 15 * 86_400_000
const RENDER_FORMATS = new Set<OutputFormat>(['docx', 'xlsx', 'pptx'])
const rendering = new Map<string, Promise<WorkspaceTaskRow>>()

export type GeneratedArtifact = {
  taskId: string
  title: string
  outputName: string | null
  outputSize: number | null
  outputFormat: OutputFormat
  expiresAt: number
  downloadUrl: string
  status: WorkspaceTaskRow['status']
}

const artifactSteps = (): WorkspaceStep[] => [
  { key: 'generate', label: '生成文件', status: 'pending' },
  { key: 'save', label: '保存文件', status: 'pending' },
]

export const artifactHash = (userId: string, format: string, title: string, content: string): string =>
  createHash('sha256').update(`${userId}\0${format}\0${title}\0${content}`).digest('hex')

const byIdempotency = (userId: string, key: string): WorkspaceTaskRow | undefined =>
  db.prepare('SELECT * FROM workspace_tasks WHERE user_id=? AND idempotency_key=?')
    .get(userId, key) as WorkspaceTaskRow | undefined

export const createGeneratedTask = (input: {
  user: UserRow
  modelId: string
  format: OutputFormat
  title: string
  content: string
  idempotencyKey: string
}): WorkspaceTaskRow => {
  if (!RENDER_FORMATS.has(input.format)) throw new Error('该格式不支持对话生成')
  const existing = byIdempotency(input.user.id, input.idempotencyKey)
  if (existing) return existing
  const id = randomUUID()
  const now = Date.now()
  const title = (input.title.trim() || '对话生成').slice(0, 100)
  const steps = artifactSteps()
  try {
    db.prepare(`INSERT INTO workspace_tasks
      (id,user_id,title,status,instruction,model_id,source_name,source_ext,output_format,plan,steps,
       origin,content,idempotency_key,created_at,updated_at,expires_at)
      VALUES (?,?,?,'processing','由聊天生成',?,?,?,?,'[]',?,'chat',?,?,?,?,?)`).run(
      id, input.user.id, title, input.modelId, `${title}.${input.format}`, input.format,
      input.format, JSON.stringify(steps), input.content, input.idempotencyKey, now, now, now + RETENTION_MS
    )
  } catch (error) {
    const duplicate = byIdempotency(input.user.id, input.idempotencyKey)
    if (duplicate) return duplicate
    throw error
  }
  return readWorkspaceTask(id)!
}

export const artifactPayload = (task: WorkspaceTaskRow): GeneratedArtifact => ({
  taskId: task.id,
  title: task.title,
  outputName: task.output_name,
  outputSize: task.output_size,
  outputFormat: task.output_format,
  expiresAt: task.expires_at,
  downloadUrl: `/api/workspace/tasks/${encodeURIComponent(task.id)}/download`,
  status: task.status,
})

const runRender = async (task: WorkspaceTaskRow): Promise<WorkspaceTaskRow> => {
  const now = Date.now()
  const steps: WorkspaceStep[] = [
    { key: 'generate', label: '生成文件', status: 'running' },
    { key: 'save', label: '保存文件', status: 'pending' },
  ]
  db.prepare("UPDATE workspace_tasks SET status='processing', steps=?, error=NULL, updated_at=? WHERE id=?")
    .run(JSON.stringify(steps), now, task.id)
  const dir = workspaceTaskDir(task.user_id, task.id)
  try {
    await mkdir(dir, { recursive: true })
    const output = await generateOutput({
      format: task.output_format,
      content: task.content ?? '',
      title: task.title || task.source_name,
      dir,
    })
    const fileStat = await stat(output.path)
    const finished = Date.now()
    steps[0] = { ...steps[0], status: 'done', detail: output.name }
    steps[1] = { ...steps[1], status: 'done', detail: output.name }
    db.prepare(`UPDATE workspace_tasks SET status='done', steps=?, output_name=?, output_file=?,
      output_size=?, error=NULL, updated_at=?, expires_at=? WHERE id=?`).run(
      JSON.stringify(steps), output.name, output.file, fileStat.size, finished, finished + RETENTION_MS, task.id
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : '文件生成失败'
    steps[0] = { ...steps[0], status: 'failed', detail: message.slice(0, 120) }
    steps[1] = { ...steps[1], status: 'failed' }
    db.prepare("UPDATE workspace_tasks SET status='failed', steps=?, error=?, updated_at=? WHERE id=?")
      .run(JSON.stringify(steps), message.slice(0, 500), Date.now(), task.id)
    throw error
  }
  return readWorkspaceTask(task.id)!
}

export const renderGeneratedTask = (taskId: string): Promise<WorkspaceTaskRow> => {
  const task = readWorkspaceTask(taskId)
  if (!task) return Promise.reject(new Error('文件任务不存在'))
  if (task.status === 'done') return Promise.resolve(task)
  const active = rendering.get(taskId)
  if (active) return active
  const promise = runRender(task).finally(() => rendering.delete(taskId))
  rendering.set(taskId, promise)
  return promise
}

export const persistGeneratedArtifact = async (input: {
  user: UserRow
  modelId: string
  format: OutputFormat
  title: string
  content: string
  idempotencyKey: string
}): Promise<WorkspaceTaskRow> => {
  const task = createGeneratedTask(input)
  if (task.status === 'done' || task.status === 'failed') return task
  return renderGeneratedTask(task.id)
}

export type ArtifactBlock = {
  format: 'pptx' | 'docx' | 'xlsx'
  content: string
  title: string | null
}

const ARTIFACT_BLOCK = /```(pptx|docx|xlsx)([^\n]*)\r?\n([\s\S]*?)```/i

export const extractArtifactBlock = (text: string): ArtifactBlock | null => {
  const match = ARTIFACT_BLOCK.exec(text)
  if (!match) return null
  const meta = match[2] ?? ''
  const filename = /filename\s*=\s*["']?([^"'\s]+)["']?/i.exec(meta)?.[1]
  return {
    format: match[1].toLowerCase() as ArtifactBlock['format'],
    title: filename?.replace(/\.[^.]+$/, '') ?? null,
    content: match[3].trim(),
  }
}

export const stripArtifactBlock = (text: string): string => text.replace(ARTIFACT_BLOCK, '').trim()
