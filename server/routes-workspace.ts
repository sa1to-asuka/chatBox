import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '../shared/types.js'
import { currentUser } from './auth.js'
import { attachmentDir, dataDir, db } from './db.js'
import { body, cleanText, HttpError, requireString, sendError } from './http.js'
import {
  WORKSPACE_RETENTION_DAYS,
  createWorkspaceTask,
  isAllowedSource,
  isOutputFormat,
  processWorkspaceTask,
  readWorkspaceTask,
  renderPptxFile,
  resolveWorkspaceModel,
  retryWorkspaceTask,
  workspaceTaskDir,
  type WorkspaceStep,
  type WorkspaceTaskRow,
} from './workspace.js'
import {
  artifactHash,
  createGeneratedTask,
  renderGeneratedTask,
} from './artifacts.js'

const OUTPUT_MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
}

const taskPayload = (task: WorkspaceTaskRow) => ({
  id: task.id,
  title: task.title || task.source_name,
  status: task.status,
  instruction: task.instruction,
  modelId: task.model_id,
  sourceName: task.source_name,
  outputFormat: task.output_format,
  plan: parse<string[]>(task.plan || '[]'),
  steps: parse<WorkspaceStep[]>(task.steps || '[]'),
  outputName: task.output_name,
  outputSize: task.output_size,
  error: task.error,
  origin: task.origin,
  expired: task.expires_at <= Date.now(),
  remainingMs: Math.max(0, task.expires_at - Date.now()),
  downloadUrl: `/api/workspace/tasks/${encodeURIComponent(task.id)}/download`,
  createdAt: task.created_at,
  updatedAt: task.updated_at,
  expiresAt: task.expires_at,
})

export const registerWorkspaceRoutes = (app: FastifyInstance) => {
  app.post('/api/workspace/tasks', async (request, reply) => {
    let task: WorkspaceTaskRow | undefined
    let dir: string | undefined
    try {
      const user = currentUser(request)
      if (!request.isMultipart()) throw new HttpError(400, '请使用表单上传文件')
      const active = db.prepare(`SELECT id FROM workspace_tasks WHERE user_id=? AND status IN ('queued','processing')`)
        .get(user.id)
      if (active) throw new HttpError(429, '已有文件任务在处理中，请等待完成后再提交', 'workspace_busy')

      let uploaded: { filename: string; mimetype: string; buffer: Buffer } | null = null
      const fields: Record<string, string> = {}
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (uploaded) {
            part.file.resume()
            continue
          }
          uploaded = {
            filename: part.filename || 'upload',
            mimetype: part.mimetype,
            buffer: await part.toBuffer(),
          }
        } else {
          fields[part.fieldname] = String(part.value)
        }
      }
      if (!uploaded) throw new HttpError(400, '请选择要处理的文件')
      const sourceName = cleanText(uploaded.filename, 200)
      const sourceExt = sourceName.split('.').pop()?.toLowerCase() ?? ''
      if (!isAllowedSource(sourceExt)) {
        throw new HttpError(400, '仅支持 PDF、Word、Excel、PowerPoint、CSV、TXT、Markdown 文件')
      }
      const instruction = cleanText(requireString(fields.instruction, '处理要求', 4000), 4000)
      const modelId = requireString(fields.modelId, '模型', 100)
      if (!isOutputFormat(fields.format)) throw new HttpError(400, '输出格式不正确')
      const model = resolveWorkspaceModel(modelId, user)
      const title = cleanText(fields.title?.trim() || sourceName.replace(/\.[^.]+$/, ''), 100)
      task = createWorkspaceTask({
        userId: user.id,
        title,
        instruction,
        modelId: model.id,
        sourceName,
        sourceExt,
        outputFormat: fields.format,
      })
      dir = workspaceTaskDir(user.id, task.id)
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, `source.${sourceExt}`), uploaded.buffer)
      void processWorkspaceTask(task.id)
      return reply.code(202).send({ task: taskPayload(task) })
    } catch (error) {
      if (task) {
        db.prepare('DELETE FROM workspace_tasks WHERE id=?').run(task.id)
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      }
      return sendError(reply, error)
    }
  })

  app.post('/api/workspace/tasks/from-attachment', async (request, reply) => {
    let task: WorkspaceTaskRow | undefined
    let dir: string | undefined
    try {
      const user = currentUser(request)
      const data = body(request)
      const attachmentId = requireString(data.attachmentId, '附件', 100)
      const instruction = cleanText(requireString(data.instruction, '处理要求', 4000), 4000)
      const modelId = requireString(data.modelId, '模型', 100)
      if (!isOutputFormat(data.format)) throw new HttpError(400, '输出格式不正确')
      const attachment = db.prepare('SELECT name,storage_name FROM attachments WHERE id=? AND user_id=?')
        .get(attachmentId, user.id) as { name: string; storage_name: string } | undefined
      if (!attachment) throw new HttpError(404, '附件不存在或无权访问')
      const sourceExt = attachment.name.split('.').pop()?.toLowerCase() ?? ''
      if (!isAllowedSource(sourceExt)) throw new HttpError(400, '该附件格式不支持文件处理')
      const active = db.prepare(`SELECT id FROM workspace_tasks WHERE user_id=? AND status IN ('queued','processing')`)
        .get(user.id)
      if (active) throw new HttpError(429, '已有文件任务在处理中，请等待完成后再提交', 'workspace_busy')
      const model = resolveWorkspaceModel(modelId, user)
      task = createWorkspaceTask({
        userId: user.id,
        title: attachment.name.replace(/\.[^.]+$/, '').slice(0, 100),
        instruction,
        modelId: model.id,
        sourceName: attachment.name,
        sourceExt,
        outputFormat: data.format,
      })
      dir = workspaceTaskDir(user.id, task.id)
      await mkdir(dir, { recursive: true })
      await copyFile(path.join(attachmentDir, attachment.storage_name), path.join(dir, `source.${sourceExt}`))
      void processWorkspaceTask(task.id)
      return reply.code(202).send({ task: taskPayload(task) })
    } catch (error) {
      if (task) {
        db.prepare('DELETE FROM workspace_tasks WHERE id=?').run(task.id)
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      }
      return sendError(reply, error)
    }
  })

  app.post('/api/workspace/render-pptx', async (request, reply) => {
    let dir: string | undefined
    try {
      currentUser(request)
      const data = body(request)
      const content = requireString(data.content, '演示文稿内容', 120000)
      const title = cleanText(
        typeof data.title === 'string' && data.title.trim() ? data.title : 'Chatbox 演示文稿',
        80
      )
      const tempDir = path.join(dataDir, 'workspace', 'render', randomUUID())
      dir = tempDir
      await mkdir(tempDir, { recursive: true })
      const outputPath = path.join(tempDir, 'output.pptx')
      await renderPptxFile(content, title, tempDir, outputPath)
      const size = (await stat(outputPath)).size
      const name = `${title.replace(/\.pptx$/i, '')}.pptx`
      reply.raw.on('close', () => {
        void rm(tempDir, { recursive: true, force: true })
      })
      return reply
        .header('Content-Type', OUTPUT_MIME.pptx)
        .header('Content-Disposition', `attachment; filename="chatbox-presentation.pptx"; filename*=UTF-8''${encodeURIComponent(name)}`)
        .header('Content-Length', String(size))
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(createReadStream(outputPath))
    } catch (error) {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      return sendError(reply, error)
    }
  })

  app.post('/api/workspace/artifacts', async (request, reply) => {
    try {
      const user = currentUser(request)
      const data = body(request)
      const format = data.format
      if (format !== 'docx' && format !== 'xlsx' && format !== 'pptx') {
        throw new HttpError(400, '该格式不支持对话生成')
      }
      const content = requireString(data.content, '文件内容', 120000)
      const title = cleanText(
        typeof data.title === 'string' && data.title.trim() ? data.title : '对话生成',
        100
      )
      const task = createGeneratedTask({
        user,
        modelId: 'chatbox',
        format,
        title,
        content,
        idempotencyKey: artifactHash(user.id, format, title, content),
      })
      const done = task.status === 'done' ? task : await renderGeneratedTask(task.id)
      return reply.code(done.status === 'failed' ? 500 : 200).send({ task: taskPayload(done) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/workspace/tasks', async (request) => {
    const user = currentUser(request)
    const query = request.query as {
      limit?: string; cursor?: string; status?: string; format?: string; includeExpired?: string
    }
    const filtered = query.limit !== undefined || query.cursor !== undefined || query.status !== undefined ||
      query.format !== undefined || query.includeExpired !== undefined
    if (!filtered) {
      const rows = db.prepare('SELECT * FROM workspace_tasks WHERE user_id=? ORDER BY created_at DESC LIMIT 50')
        .all(user.id) as WorkspaceTaskRow[]
      return { tasks: rows.map(taskPayload), retentionDays: WORKSPACE_RETENTION_DAYS }
    }
    const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit ?? '20', 10) || 20))
    const offset = Math.max(0, Number.parseInt(query.cursor ?? '0', 10) || 0)
    const conditions = ['user_id=?']
    const values: unknown[] = [user.id]
    if (query.status === 'done' || query.status === 'failed') {
      conditions.push('status=?')
      values.push(query.status)
    } else if (query.status === 'active') {
      conditions.push("status IN ('queued','processing')")
    }
    if (query.format && ['docx', 'xlsx', 'pptx', 'pdf'].includes(query.format)) {
      conditions.push('output_format=?')
      values.push(query.format)
    }
    if (query.includeExpired !== '1') {
      conditions.push('expires_at>?')
      values.push(Date.now())
    }
    const where = conditions.join(' AND ')
    const total = (db.prepare(`SELECT COUNT(*) count FROM workspace_tasks WHERE ${where}`).get(...values) as { count: number }).count
    const rows = db.prepare(`SELECT * FROM workspace_tasks WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...values, limit, offset) as WorkspaceTaskRow[]
    return {
      tasks: rows.map(taskPayload),
      retentionDays: WORKSPACE_RETENTION_DAYS,
      nextCursor: offset + rows.length < total ? String(offset + rows.length) : null,
      total,
    }
  })

  app.get('/api/workspace/tasks/:id', async (request, reply) => {
    try {
      const user = currentUser(request)
      const task = readWorkspaceTask((request.params as { id: string }).id)
      if (!task || task.user_id !== user.id) throw new HttpError(404, '任务不存在或已过期')
      return { task: taskPayload(task) }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/workspace/tasks/:id/download', async (request, reply) => {
    const user = currentUser(request)
    const task = readWorkspaceTask((request.params as { id: string }).id)
    if (!task || task.user_id !== user.id || task.status !== 'done' || !task.output_file) {
      throw new HttpError(404, '文件不存在或已过期')
    }
    if (task.expires_at <= Date.now()) throw new HttpError(410, '文件已过期，已超过 15 天保留期', 'file_expired')
    const filePath = path.join(workspaceTaskDir(user.id, task.id), task.output_file)
    let size: number
    try {
      size = (await stat(filePath)).size
    } catch {
      throw new HttpError(404, '文件不存在或已过期')
    }
    const name = task.output_name ?? task.output_file
    const fallbackName = task.output_format === 'pptx'
      ? 'chatbox-presentation.pptx'
      : task.output_format === 'xlsx'
        ? 'chatbox-spreadsheet.xlsx'
        : task.output_format === 'docx'
          ? 'chatbox-document.docx'
          : 'chatbox-document.pdf'
    return reply
      .header('Content-Type', OUTPUT_MIME[task.output_format] ?? 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .header('Content-Length', String(size))
      .header('Cache-Control', 'private, max-age=0')
      .header('X-Content-Type-Options', 'nosniff')
      .send(createReadStream(filePath))
  })

  app.delete('/api/workspace/tasks/:id', async (request, reply) => {
    try {
      const user = currentUser(request)
      const task = readWorkspaceTask((request.params as { id: string }).id)
      if (!task || task.user_id !== user.id) throw new HttpError(404, '任务不存在')
      if (task.status === 'queued' || task.status === 'processing') {
        throw new HttpError(409, '任务正在处理中，请等待完成后再删除')
      }
      await rm(workspaceTaskDir(user.id, task.id), { recursive: true, force: true })
      db.prepare('DELETE FROM workspace_tasks WHERE id=?').run(task.id)
      return { ok: true }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/workspace/tasks/:id/retry', async (request, reply) => {
    try {
      const user = currentUser(request)
      const id = (request.params as { id: string }).id
      const current = readWorkspaceTask(id)
      if (!current || current.user_id !== user.id) throw new HttpError(404, '任务不存在')
      if (current.expires_at <= Date.now()) throw new HttpError(410, '文件已过期，无法重试', 'file_expired')
      const active = db.prepare(`SELECT id FROM workspace_tasks WHERE user_id=? AND status IN ('queued','processing') AND id<>?`)
        .get(user.id, id)
      if (active) throw new HttpError(429, '已有文件任务在处理中，请等待完成后再提交', 'workspace_busy')
      const task = retryWorkspaceTask(id, user.id)
      if (!task) throw new HttpError(400, '只有失败的任务可以重试')
      if (task.origin === 'chat') void renderGeneratedTask(task.id)
      else void processWorkspaceTask(task.id)
      return reply.code(202).send({ task: taskPayload(task) })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
