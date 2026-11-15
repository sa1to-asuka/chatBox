import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { attachmentDir, db } from './db.js'
import { adminUser, currentUser, hashPassword, publicUser, type UserRow } from './auth.js'
import { body, cleanText, HttpError, requireString, sendError } from './http.js'
import { encrypt, decrypt } from './auth.js'
import { displayName, password, username } from './validation.js'
import { ownsFolder } from './routes-chat-tools.js'
import { attachmentContent } from './attachments.js'
import { estimateInputTokens, maxOutputFor, reserve, settle } from './quota.js'
import { streamOpenAI, listOpenAIModels } from './providers/openai.js'
import { streamAnthropic, listAnthropicModels } from './providers/anthropic.js'
import { event } from './providers/shared.js'
import { beijingDay, clampInteger, isSearchMode, parse, type ModelCapabilities, type ProviderModel, type SearchMode } from '../shared/types.js'

const id = () => randomUUID()
const normalizeCapabilities = (model: { capabilities: string; search_mode: string }): ModelCapabilities => {
  const value = parse<Partial<ModelCapabilities>>(model.capabilities)
  return {
    vision: value.vision === true, files: value.files === true,
    thinking: value.thinking === true, search: model.search_mode !== 'none',
  }
}
const modelRow = (modelId: string, user: UserRow) => {
  const model = db.prepare(`SELECT m.*,p.type,p.base_url,p.api_key_encrypted,p.name provider_name
    FROM models m JOIN providers p ON p.id=m.provider_id WHERE m.id=? AND m.enabled=1 AND p.enabled=1`).get(modelId) as {
    id: string; provider_id: string; upstream_id: string; display_name: string; premium: number; multiplier: number
    capabilities: string; search_mode: string; type: 'openai' | 'anthropic'; base_url: string; api_key_encrypted: string; provider_name: string
  } | undefined
  if (!model) throw new HttpError(404, '模型不存在或已停用')
  if (model.premium && user.role === 'user') throw new HttpError(403, '高级模型需要 VIP 权限', 'vip_required')
  return model
}
const publicModel = (model: ReturnType<typeof modelRow>) => ({
  id: model.id, name: model.display_name, upstreamId: model.upstream_id, provider: model.provider_name,
  premium: model.premium === 1, multiplier: model.multiplier, capabilities: normalizeCapabilities(model),
})
export const registerApi = (app: FastifyInstance) => {
  app.get('/api/models', async (request) => {
    const user = currentUser(request)
    const rows = db.prepare(`SELECT m.*,p.type,p.base_url,p.api_key_encrypted,p.name provider_name
      FROM models m JOIN providers p ON p.id=m.provider_id WHERE m.enabled=1 AND p.enabled=1 ORDER BY m.premium,m.display_name`).all() as Parameters<typeof publicModel>[0][]
    return { models: rows.filter((model) => !model.premium || user.role !== 'user').map(publicModel) }
  })
  app.post('/api/chats', async (request, reply) => {
    try {
      const user = currentUser(request)
      const data = body(request)
      const chatId = requireString(data.id, '会话', 100)
      const now = Date.now()
      db.prepare('INSERT INTO chat_sessions(id,user_id,created_at,updated_at) VALUES(?,?,?,?)').run(chatId, user.id, now, now)
      return { id: chatId, revision: 0 }
    } catch (error) { return sendError(reply, error) }
  })
  app.get('/api/chats', async (request) => {
    const user = currentUser(request)
    const sessions = db.prepare(`SELECT id,title,created_at createdAt,updated_at updatedAt,revision,
        pinned,pinned_at pinnedAt,folder_id folderId
      FROM chat_sessions WHERE user_id=?
      ORDER BY pinned DESC, COALESCE(pinned_at,0) DESC, updated_at DESC`).all(user.id) as
      { pinned: number }[]
    return { sessions: sessions.map((session) => ({ ...session, pinned: session.pinned === 1 })) }
  })
  app.delete('/api/chats', async (request) => {
    const user = currentUser(request)
    const files = db.prepare('SELECT storage_name storageName FROM attachments WHERE user_id=?').all(user.id) as { storageName: string }[]
    const deleted = db.prepare('DELETE FROM chat_sessions WHERE user_id=?').run(user.id).changes
    db.prepare('DELETE FROM attachments WHERE user_id=?').run(user.id)
    await Promise.all(files.map((file) => unlink(path.join(attachmentDir, file.storageName)).catch(() => undefined)))
    return { deleted }
  })
  app.get('/api/chats/:id', async (request) => {
    const user = currentUser(request)
    const { id: chatId } = request.params as { id: string }
    const chat = db.prepare('SELECT * FROM chat_sessions WHERE id=? AND user_id=?').get(chatId, user.id) as { title: string; root_message_id: string | null; revision: number; created_at: number; updated_at: number } | undefined
    if (!chat) throw new HttpError(404, '会话不存在')
    const rows = db.prepare('SELECT data FROM chat_messages WHERE user_id=? AND session_id=? ORDER BY created_at').all(user.id, chatId) as { data: string }[]
    return { session: { id: chatId, title: chat.title, createdAt: chat.created_at, updatedAt: chat.updated_at, rootMessageId: chat.root_message_id, messages: rows.map((row) => parse(row.data)), revision: chat.revision } }
  })
  app.put('/api/chats/:id', async (request, reply) => {
    try {
      const user = currentUser(request)
      const { id: chatId } = request.params as { id: string }
      const data = body(request)
      const revision = data.revision === undefined ? 0 : clampInteger(data.revision, 0, Number.MAX_SAFE_INTEGER)
      if (revision === null || !Array.isArray(data.messages) || data.messages.length > 1000) throw new HttpError(400, '会话格式不正确')
      let folderValue: string | null | undefined
      if (Object.hasOwn(data, 'folderId')) {
        if (data.folderId === null) folderValue = null
        else if (typeof data.folderId === 'string' && ownsFolder(user.id, data.folderId)) folderValue = data.folderId
        else throw new HttpError(400, '分类不存在')
      }
      const messages = data.messages as { id: string; role: string; createdAt: number; parentId?: string | null; selectedChildId?: string }[]
      if (messages.some((message) => typeof message.id !== 'string' || !['user', 'assistant'].includes(message.role) || !Number.isFinite(message.createdAt))) throw new HttpError(400, '消息格式不正确')
      const now = Date.now()
      db.exec('BEGIN IMMEDIATE')
      try {
        const chat = db.prepare('SELECT revision,created_at FROM chat_sessions WHERE id=? AND user_id=?').get(chatId, user.id) as { revision: number; created_at: number } | undefined
        if (chat && chat.revision !== revision) throw new HttpError(409, '会话已在另一设备更新，请刷新后重试', 'revision_conflict')
        if (!chat) db.prepare('INSERT INTO chat_sessions(id,user_id,folder_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(chatId, user.id, folderValue ?? null, now, now)
        const title = cleanText(requireString(data.title ?? '新对话', '标题', 200), 100)
        const rootMessageId = typeof data.rootMessageId === 'string' ? data.rootMessageId : null
        if (folderValue === undefined) {
          db.prepare('UPDATE chat_sessions SET title=?,root_message_id=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?').run(title, rootMessageId, now, chatId, user.id)
        } else {
          db.prepare('UPDATE chat_sessions SET title=?,root_message_id=?,folder_id=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?').run(title, rootMessageId, folderValue, now, chatId, user.id)
        }
        db.prepare('DELETE FROM chat_messages WHERE user_id=? AND session_id=?').run(user.id, chatId)
        const insert = db.prepare('INSERT INTO chat_messages VALUES(?,?,?,?,?,?,?,?)')
        for (const message of messages) insert.run(user.id, chatId, message.id, message.parentId ?? null, message.selectedChildId ?? null, message.role, JSON.stringify(message), message.createdAt)
        db.exec('COMMIT')
        return { revision: revision + 1 }
      } catch (error) { db.exec('ROLLBACK'); throw error }
    } catch (error) { return sendError(reply, error) }
  })
  app.patch('/api/chats/:id', async (request) => {
    const user = currentUser(request)
    const { id: chatId } = request.params as { id: string }
    const title = cleanText(requireString(body(request).title, '标题', 100), 100)
    const result = db.prepare('UPDATE chat_sessions SET title=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?').run(title, Date.now(), chatId, user.id)
    if (!result.changes) throw new HttpError(404, '会话不存在')
    return { ok: true }
  })
  app.delete('/api/chats/:id', async (request) => {
    const user = currentUser(request)
    db.prepare('DELETE FROM chat_sessions WHERE id=? AND user_id=?').run((request.params as { id: string }).id, user.id)
    return { ok: true }
  })
  app.post('/api/files', async (request, reply) => {
    try {
      const user = currentUser(request)
      const usage = db.prepare('SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM attachments WHERE user_id=?').get(user.id) as { count: number; bytes: number }
      if (usage.count >= 100 || usage.bytes >= 500 * 1024 * 1024) throw new HttpError(429, '附件空间已满，请删除旧附件后重试')
      const file = await request.file({ limits: { fileSize: 32 * 1024 * 1024, files: 1 } })
      if (!file) throw new HttpError(400, '请选择文件')
      const name = cleanText(file.filename, 200)
      const mime = file.mimetype.toLowerCase()
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      const imageExts = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
      const textExts = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'log', 'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'sql', 'css', 'html', 'vue'])
      const isImage = imageExts.has(ext) && mime.startsWith('image/')
      const isPdf = ext === 'pdf'
      const isDocx = ext === 'docx'
      if (!isImage && !isPdf && !isDocx && !textExts.has(ext)) throw new HttpError(400, '当前支持图片、PDF、DOCX、文本、代码、Markdown、CSV 和 JSON 文件')
      const buffer = await file.toBuffer()
      if (!buffer.length) throw new HttpError(400, '不能上传空文件')
      if (isImage) {
        const signatures: Record<string, number[]> = { jpg: [255, 216, 255], jpeg: [255, 216, 255], png: [137, 80, 78, 71], gif: [71, 73, 70, 56], webp: [82, 73, 70, 70] }
        if (!signatures[ext].every((byte, index) => buffer[index] === byte)) throw new HttpError(400, '图片内容与格式不符')
      } else if (isPdf) {
        if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'PDF 文件内容无效')
      } else if (isDocx) {
        if (!buffer.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) throw new HttpError(400, 'DOCX 文件内容无效')
      } else if (buffer.includes(0)) throw new HttpError(400, '这不是可读取的文本文件')
      const fileId = id()
      const storageName = `${fileId}.${isImage ? ext : isPdf ? 'pdf' : isDocx ? 'docx' : 'txt'}`
      await writeFile(path.join(attachmentDir, storageName), new Uint8Array(buffer), { flag: 'wx' })
      db.prepare(`INSERT INTO attachments(id,user_id,name,storage_name,mime_type,size,is_image,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(fileId, user.id, name, storageName, isImage ? mime : isPdf ? 'application/pdf' : isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain', buffer.length, isImage ? 1 : 0, Date.now())
      return { id: fileId, name, size: buffer.length, isImage, mimeType: isImage ? mime : isPdf ? 'application/pdf' : isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain' }
    } catch (error) { return sendError(reply, error) }
  })
  app.get('/api/files/:id', async (request, reply) => {
    const user = currentUser(request)
    const file = db.prepare('SELECT * FROM attachments WHERE id=? AND user_id=?').get((request.params as { id: string }).id, user.id) as { name: string; storage_name: string; mime_type: string } | undefined
    if (!file) throw new HttpError(404, '附件不存在')
    const info = await stat(path.join(attachmentDir, file.storage_name))
    reply.header('Content-Type', file.mime_type)
    reply.header('Content-Length', info.size)
    reply.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    reply.header('X-Content-Type-Options', 'nosniff')
    return reply.send(createReadStream(path.join(attachmentDir, file.storage_name)))
  })
  app.delete('/api/files/:id', async (request) => {
    const user = currentUser(request)
    const file = db.prepare('SELECT storage_name FROM attachments WHERE id=? AND user_id=?').get((request.params as { id: string }).id, user.id) as { storage_name: string } | undefined
    if (file) {
      db.prepare('DELETE FROM attachments WHERE id=? AND user_id=?').run((request.params as { id: string }).id, user.id)
      await unlink(path.join(attachmentDir, file.storage_name)).catch(() => undefined)
    }
    return { ok: true }
  })
  app.post('/api/chat/stream', async (request, reply) => {
    const user = currentUser(request)
    const data = body(request)
    const model = modelRow(requireString(data.modelId, '模型', 100), user)
    const chatId = requireString(data.sessionId, '会话', 100)
    const requestId = requireString(data.requestId, '请求', 100)
    const prompt = requireString(data.prompt, '消息', 50000)
    const ownedChat = db.prepare('SELECT id FROM chat_sessions WHERE id=? AND user_id=?').get(chatId, user.id)
    if (!ownedChat) {
      const now = Date.now()
      db.prepare('INSERT INTO chat_sessions(id,user_id,created_at,updated_at) VALUES(?,?,?,?)').run(chatId, user.id, now, now)
    }
    const attachmentIds = Array.isArray(data.attachmentIds) ? data.attachmentIds.slice(0, 10) as string[] : []
    const capabilities = normalizeCapabilities(model)
    const search = data.search === true
    if (search && model.search_mode === 'none') throw new HttpError(400, '当前模型未启用联网搜索', 'search_unavailable')
    const parts = await attachmentContent(user.id, attachmentIds, capabilities)
    const contentParts: Exclude<import('./providers/shared.js').InputContent, string> = typeof parts === 'string' ? [] : parts
    const messages: { role: 'user' | 'assistant'; content: import('./providers/shared.js').InputContent }[] = []
    const history = Array.isArray(data.history) ? data.history.slice(-30) : []
    let historyChars = 0
    for (const item of history) {
      if (!item || typeof item !== 'object') continue
      const message = item as { role?: unknown; content?: unknown }
      if (!['user', 'assistant'].includes(String(message.role)) || typeof message.content !== 'string') continue
      const content = message.content.slice(0, 20000)
      historyChars += content.length
      if (historyChars > 120000) break
      messages.push({ role: message.role as 'user' | 'assistant', content })
    }
    messages.push({ role: 'user', content: [...contentParts, { type: 'text' as const, text: prompt }] })
    const inputTokens = estimateInputTokens(JSON.stringify(messages)) + contentParts.filter((part) => part.type === 'image').length * 1024
    reserve(user, requestId, model.id, inputTokens, model.multiplier)
    const maxTokens = maxOutputFor(user, inputTokens, model.multiplier)
    let usage = { input: inputTokens, output: 0, estimated: true }
    let failed: string | undefined
    reply.hijack()
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const abort = new AbortController()
    request.raw.on('aborted', () => abort.abort())
    reply.raw.on('close', () => { if (!reply.raw.writableEnded) abort.abort() })
    reply.raw.write(event('request', { requestId }))
    try {
      const provider = { id: model.provider_id, name: model.provider_name, type: model.type, base_url: model.base_url, key: decrypt(model.api_key_encrypted) }
      const stream = model.type === 'openai'
        ? streamOpenAI(provider, { model: model.upstream_id, messages, maxTokens, thinking: data.thinking === true, searchMode: search ? model.search_mode as SearchMode : 'none', signal: abort.signal, usage })
        : streamAnthropic(provider, { model: model.upstream_id, messages, maxTokens, thinking: data.thinking === true, searchMode: search ? model.search_mode as SearchMode : 'none', signal: abort.signal, usage })
      while (true) {
        const next = await stream.next()
        if (next.done) { usage = next.value; break }
        if (!reply.raw.write(next.value)) await new Promise<void>((resolve) => reply.raw.once('drain', resolve))
      }
    } catch (error) {
      failed = abort.signal.aborted ? '用户停止生成' : error instanceof Error ? error.message : '上游服务错误'
      request.log.error({ err: error }, 'chat stream failed')
      if (!abort.signal.aborted && !reply.raw.writableEnded) {
        const searchFailed = search && search !== undefined
        reply.raw.write(event('stream_error', searchFailed
          ? { error: '联网搜索请求失败。请关闭搜索后重试，或检查该供应商是否支持此搜索方式。', code: 'search_unavailable' }
          : { error: '模型服务暂时不可用，请稍后重试', code: 'provider_error' }))
      }
    } finally {
      settle(requestId, usage, failed)
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  })
  registerAdmin(app)
}
const providerFrom = (data: Record<string, unknown>) => ({
  id: id(), name: cleanText(requireString(data.name, '名称', 80), 80), type: requireString(data.type, '类型', 20) as 'openai' | 'anthropic',
  base_url: requireString(data.baseUrl, 'API 地址', 500).replace(/\/$/, ''), key: requireString(data.apiKey, 'API 密钥', 1000),
})
const registerAdmin = (app: FastifyInstance) => {
  app.get('/api/admin/overview', async (request) => {
    adminUser(request)
    return {
      users: (db.prepare('SELECT COUNT(*) count FROM users').get() as { count: number }).count,
      models: (db.prepare('SELECT COUNT(*) count FROM models WHERE enabled=1').get() as { count: number }).count,
      todayTokens: (db.prepare('SELECT COALESCE(SUM(input_tokens+output_tokens),0) count FROM usage_ledger WHERE day=?').get(beijingDay()) as { count: number }).count,
      todayCharged: (db.prepare('SELECT COALESCE(SUM(charged),0) count FROM usage_ledger WHERE day=?').get(beijingDay()) as { count: number }).count,
      todaySearches: (db.prepare('SELECT COALESCE(SUM(search_requests),0) count FROM usage_ledger WHERE day=?').get(beijingDay()) as { count: number }).count,
    }
  })
  app.get('/api/admin/users', async (request) => {
    adminUser(request)
    const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as UserRow[]
    return { users: users.map(publicUser) }
  })
  app.post('/api/admin/users', async (request, reply) => {
    try {
      adminUser(request)
      const data = body(request)
      const name = username(data.username)
      const nameForDisplay = displayName(data.displayName, name)
      const hash = hashPassword(password(data.password))
      const role = data.role === undefined ? 'user' : data.role
      if (!['user', 'vip', 'admin'].includes(String(role))) throw new HttpError(400, '用户角色不正确')
      let dailyQuota: number | null = null
      if (data.dailyQuota !== undefined && data.dailyQuota !== null) {
        dailyQuota = clampInteger(data.dailyQuota, 0, 1000000000)
        if (dailyQuota === null) throw new HttpError(400, '每日积分必须是非负整数')
      }
      const unlimited = data.unlimited === true ? 1 : 0
      const disabled = data.disabled === true ? 1 : 0
      const userId = id()
      try {
        db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,daily_quota,unlimited,disabled,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(userId, name, nameForDisplay, hash, String(role), dailyQuota, unlimited, disabled, Date.now())
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new HttpError(409, '用户名已被使用')
        throw error
      }
      const created = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as UserRow
      return reply.code(201).send({ user: publicUser(created) })
    } catch (error) { return sendError(reply, error) }
  })
  app.patch('/api/admin/users/:id', async (request) => {
    const admin = adminUser(request)
    const data = body(request)
    const target = db.prepare('SELECT * FROM users WHERE id=?').get((request.params as { id: string }).id) as UserRow | undefined
    if (!target) throw new HttpError(404, '用户不存在')
    const role = ['user', 'vip', 'admin'].includes(String(data.role)) ? String(data.role) : target.role
    if (target.id === admin.id && role !== 'admin') throw new HttpError(400, '不能移除自己的管理员角色')
    const dailyQuota = data.dailyQuota === null ? null : clampInteger(data.dailyQuota, 0, 1000000000) ?? target.daily_quota
    const unlimited = typeof data.unlimited === 'boolean' ? Number(data.unlimited) : target.unlimited
    const disabled = typeof data.disabled === 'boolean' ? Number(data.disabled) : target.disabled
    if (target.id === admin.id && disabled) throw new HttpError(400, '不能停用自己的账号')
    db.prepare('UPDATE users SET role=?,daily_quota=?,unlimited=?,disabled=? WHERE id=?').run(role, dailyQuota, unlimited, disabled, target.id)
    if (role !== target.role || disabled) db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(target.id)
    return { ok: true }
  })
  app.get('/api/admin/providers', async (request) => {
    adminUser(request)
    return { providers: db.prepare(`SELECT p.id,p.name,p.type,p.base_url baseUrl,p.enabled,p.created_at createdAt,
        (SELECT COUNT(*) FROM models m WHERE m.provider_id=p.id) modelCount
      FROM providers p ORDER BY p.created_at DESC`).all() }
  })
  app.post('/api/admin/providers', async (request, reply) => {
    try {
      adminUser(request)
      const provider = providerFrom(body(request))
      if (!['openai', 'anthropic'].includes(provider.type)) throw new HttpError(400, '不支持的供应商类型')
      const url = new URL(provider.base_url)
      if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new HttpError(400, 'API 地址应使用 HTTPS')
      db.prepare('INSERT INTO providers VALUES(?,?,?,?,?,1,?)').run(provider.id, provider.name, provider.type, provider.base_url, encrypt(provider.key), Date.now())
      return { id: provider.id }
    } catch (error) { return sendError(reply, error) }
  })
  app.delete('/api/admin/providers/:id', async (request) => {
    adminUser(request)
    db.prepare('DELETE FROM providers WHERE id=?').run((request.params as { id: string }).id)
    return { ok: true }
  })
  app.post('/api/admin/providers/:id/discover', async (request, reply) => {
    try {
      adminUser(request)
      const provider = db.prepare('SELECT * FROM providers WHERE id=?').get((request.params as { id: string }).id) as { type: 'openai' | 'anthropic'; base_url: string; api_key_encrypted: string; id: string; name: string } | undefined
      if (!provider) throw new HttpError(404, '供应商不存在')
      const value = { ...provider, key: decrypt(provider.api_key_encrypted) }
      const models: ProviderModel[] = provider.type === 'openai' ? await listOpenAIModels(value) : await listAnthropicModels(value)
      return { models }
    } catch (error) { return sendError(reply, new HttpError(502, '获取模型失败，请检查接口地址、密钥和模型列表权限')) }
  })
  app.post('/api/admin/providers/:id/import', async (request, reply) => {
    try {
      adminUser(request)
      const providerId = (request.params as { id: string }).id
      const data = body(request)
      if (!Array.isArray(data.models)) throw new HttpError(400, '请选择模型')
      const insert = db.prepare(`INSERT INTO models(id,provider_id,upstream_id,display_name) VALUES(?,?,?,?)
        ON CONFLICT(provider_id,upstream_id) DO NOTHING`)
      for (const value of data.models.slice(0, 100)) {
        const item = value as { id?: unknown; name?: unknown }
        const upstream = requireString(item.id, '模型 ID', 200)
        insert.run(id(), providerId, upstream, cleanText(typeof item.name === 'string' ? item.name : upstream, 100))
      }
      return { ok: true }
    } catch (error) { return sendError(reply, error) }
  })
  app.get('/api/admin/models', async (request) => {
    adminUser(request)
    const models = db.prepare(`SELECT m.id,m.provider_id providerId,m.upstream_id upstreamId,m.display_name name,
      m.premium,m.multiplier,m.enabled,m.capabilities,m.search_mode searchMode,p.name provider,p.type providerType
      FROM models m JOIN providers p ON p.id=m.provider_id ORDER BY m.display_name`).all() as {
        premium: number; enabled: number; capabilities: string
      }[]
    return { models: models.map((model) => ({ ...model, premium: Boolean(model.premium), enabled: Boolean(model.enabled), capabilities: parse(model.capabilities) })) }
  })
  app.patch('/api/admin/models/:id', async (request) => {
    adminUser(request)
    const data = body(request)
    const model = db.prepare(`SELECT m.*,p.type providerType FROM models m JOIN providers p ON p.id=m.provider_id
      WHERE m.id=?`).get((request.params as { id: string }).id) as {
        display_name: string; upstream_id: string; premium: number; multiplier: number; enabled: number;
        capabilities: string; search_mode: string; providerType: 'openai' | 'anthropic'
      } | undefined
    if (!model) throw new HttpError(404, '模型不存在')
    const searchMode = isSearchMode(data.searchMode) ? data.searchMode : model.search_mode as SearchMode
    const allowed = model.providerType === 'openai' ? ['none', 'openai'] : ['none', 'anthropic', 'deepseek']
    if (!allowed.includes(searchMode)) throw new HttpError(400, '该联网方式与供应商类型不兼容')
    const multiplier = typeof data.multiplier === 'number' && Number.isFinite(data.multiplier) && data.multiplier > 0 && data.multiplier <= 1000 ? data.multiplier : model.multiplier
    const capabilities = typeof data.capabilities === 'object' && data.capabilities ? data.capabilities as Partial<ModelCapabilities> : parse<Partial<ModelCapabilities>>(model.capabilities)
    db.prepare('UPDATE models SET display_name=?,upstream_id=?,premium=?,multiplier=?,enabled=?,capabilities=?,search_mode=? WHERE id=?').run(
      cleanText(typeof data.name === 'string' ? data.name : model.display_name, 100),
      typeof data.upstreamId === 'string' ? requireString(data.upstreamId, '模型 ID', 200) : model.upstream_id,
      typeof data.premium === 'boolean' ? Number(data.premium) : model.premium, multiplier,
      typeof data.enabled === 'boolean' ? Number(data.enabled) : model.enabled, JSON.stringify({
        vision: capabilities.vision === true, files: capabilities.files === true,
        thinking: capabilities.thinking === true, search: searchMode !== 'none',
      }), searchMode, (request.params as { id: string }).id)
    return { ok: true }
  })
  app.delete('/api/admin/models/:id', async (request) => {
    adminUser(request)
    db.prepare('DELETE FROM models WHERE id=?').run((request.params as { id: string }).id)
    return { ok: true }
  })
  app.get('/api/admin/usage', async (request) => {
    adminUser(request)
    return { usage: db.prepare(`SELECT l.request_id requestId,u.username,u.display_name displayName,l.day,l.input_tokens inputTokens,
      l.output_tokens outputTokens,l.search_requests searchRequests,l.multiplier,l.charged,l.status,l.estimated,l.created_at createdAt,m.display_name model
      FROM usage_ledger l JOIN users u ON u.id=l.user_id LEFT JOIN models m ON m.id=l.model_id
      ORDER BY l.created_at DESC LIMIT 200`).all() }
  })
}
