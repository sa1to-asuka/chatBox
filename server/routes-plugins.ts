import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { adminUser, currentUser } from './auth.js'
import { db } from './db.js'
import { body, cleanText, HttpError, requireString, sendError } from './http.js'
import { clampInteger } from '../shared/types.js'
import { estimateInputTokens } from './quota.js'
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js'
import {
  getPlugin,
  listAllPlugins,
  listPluginsForUser,
  parsePluginCategory,
  parsePluginCommand,
  parsePluginIcon,
  parsePluginPrompt,
  parsePluginScope,
  setUserPluginEnabled,
  toAdminPlugin,
} from './plugins.js'
import { getSystemPrompt, isSystemPromptEnabled, setText } from './settings.js'

const promptPayload = () => {
  const prompt = getSystemPrompt()
  return {
    prompt,
    enabled: isSystemPromptEnabled(),
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
    estimatedTokens: estimateInputTokens(prompt),
  }
}

export const registerPluginRoutes = (app: FastifyInstance) => {
  app.get('/api/plugins', async (request) => {
    const user = currentUser(request)
    return { plugins: listPluginsForUser(user.id) }
  })

  app.put('/api/plugins/:id', async (request, reply) => {
    try {
      const user = currentUser(request)
      const enabled = body(request).enabled
      if (typeof enabled !== 'boolean') throw new HttpError(400, '启用状态不正确')
      setUserPluginEnabled(user.id, (request.params as { id: string }).id, enabled)
      return { enabled }
    } catch (error) { return sendError(reply, error) }
  })

  app.get('/api/admin/plugins', async (request) => {
    adminUser(request)
    return { plugins: listAllPlugins() }
  })

  app.post('/api/admin/plugins', async (request, reply) => {
    try {
      adminUser(request)
      const data = body(request)
      const command = parsePluginCommand(data.command)
      if (db.prepare('SELECT id FROM plugins WHERE command=? COLLATE NOCASE').get(command)) {
        throw new HttpError(409, `命令 /${command} 已存在`, 'plugin_command_exists')
      }
      const id = `plugin-${randomUUID()}`
      const sortOrder = data.sortOrder === undefined ? 100 : clampInteger(data.sortOrder, 0, 9999)
      if (sortOrder === null) throw new HttpError(400, '排序值不正确')
      db.prepare(`INSERT INTO plugins
        (id,seed_key,name,command,icon,category,description,prompt,scope,enabled,default_enabled,featured,auto,builtin,sort_order,created_at)
        VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`).run(
        id,
        cleanText(requireString(data.name, '名称', 40), 40),
        command,
        parsePluginIcon(data.icon ?? 'sparkles'),
        parsePluginCategory(data.category ?? 'general'),
        typeof data.description === 'string' ? cleanText(data.description, 200) : '',
        parsePluginPrompt(data.prompt),
        parsePluginScope(data.scope ?? 'conversation'),
        data.enabled === false ? 0 : 1,
        data.defaultEnabled === false ? 0 : 1,
        data.featured === true ? 1 : 0,
        data.auto === true ? 1 : 0,
        sortOrder,
        Date.now()
      )
      return { plugin: toAdminPlugin(getPlugin(id)!) }
    } catch (error) { return sendError(reply, error) }
  })

  app.put('/api/admin/plugins/:id', async (request, reply) => {
    try {
      adminUser(request)
      const pluginId = (request.params as { id: string }).id
      const existing = getPlugin(pluginId)
      if (!existing) throw new HttpError(404, '插件不存在')
      const data = body(request)
      const builtin = existing.builtin === 1
      const name = builtin ? existing.name : cleanText(requireString(data.name ?? existing.name, '名称', 40), 40)
      const command = builtin ? existing.command
        : Object.hasOwn(data, 'command') ? parsePluginCommand(data.command) : existing.command
      if (command !== existing.command) {
        const conflict = db.prepare('SELECT id FROM plugins WHERE command=? COLLATE NOCASE AND id<>?').get(command, pluginId)
        if (conflict) throw new HttpError(409, `命令 /${command} 已存在`, 'plugin_command_exists')
      }
      const scope = builtin ? existing.scope
        : Object.hasOwn(data, 'scope') ? parsePluginScope(data.scope) : existing.scope
      const sortOrder = data.sortOrder === undefined ? existing.sort_order : clampInteger(data.sortOrder, 0, 9999)
      if (sortOrder === null) throw new HttpError(400, '排序值不正确')
      db.prepare(`UPDATE plugins SET name=?,command=?,icon=?,category=?,description=?,prompt=?,scope=?,
        enabled=?,default_enabled=?,featured=?,auto=?,sort_order=? WHERE id=?`).run(
        name,
        command,
        Object.hasOwn(data, 'icon') ? parsePluginIcon(data.icon) : existing.icon,
        Object.hasOwn(data, 'category') ? parsePluginCategory(data.category) : existing.category,
        Object.hasOwn(data, 'description')
          ? cleanText(typeof data.description === 'string' ? data.description : '', 200)
          : existing.description,
        Object.hasOwn(data, 'prompt') ? parsePluginPrompt(data.prompt) : existing.prompt,
        scope,
        typeof data.enabled === 'boolean' ? (data.enabled ? 1 : 0) : existing.enabled,
        typeof data.defaultEnabled === 'boolean' ? (data.defaultEnabled ? 1 : 0) : existing.default_enabled,
        typeof data.featured === 'boolean' ? (data.featured ? 1 : 0) : existing.featured,
        typeof data.auto === 'boolean' ? (data.auto ? 1 : 0) : existing.auto,
        sortOrder,
        pluginId
      )
      return { plugin: toAdminPlugin(getPlugin(pluginId)!) }
    } catch (error) { return sendError(reply, error) }
  })

  app.delete('/api/admin/plugins/:id', async (request, reply) => {
    try {
      adminUser(request)
      const pluginId = (request.params as { id: string }).id
      const existing = getPlugin(pluginId)
      if (!existing) throw new HttpError(404, '插件不存在')
      if (existing.builtin === 1) throw new HttpError(400, '内置插件不能删除，可以停用')
      db.prepare('DELETE FROM plugins WHERE id=?').run(pluginId)
      return { ok: true }
    } catch (error) { return sendError(reply, error) }
  })

  app.get('/api/admin/prompt', async (request) => {
    adminUser(request)
    return promptPayload()
  })

  app.put('/api/admin/prompt', async (request, reply) => {
    try {
      adminUser(request)
      const data = body(request)
      if (Object.hasOwn(data, 'prompt')) {
        setText('system_prompt', cleanText(requireString(data.prompt, '提示词', 12000), 12000))
      }
      if (typeof data.enabled === 'boolean') {
        setText('system_prompt_enabled', data.enabled ? '1' : '0')
      }
      return promptPayload()
    } catch (error) { return sendError(reply, error) }
  })

  app.post('/api/admin/prompt/reset', async (request, reply) => {
    try {
      adminUser(request)
      setText('system_prompt', DEFAULT_SYSTEM_PROMPT)
      return promptPayload()
    } catch (error) { return sendError(reply, error) }
  })
}
