import { db } from './db.js'
import { cleanText, HttpError, requireString } from './http.js'
import { detectAutoSkillCommand } from '../shared/auto-skills.js'

export type PluginScope = 'conversation' | 'message'

export type PluginRow = {
  id: string
  seed_key: string | null
  name: string
  command: string
  icon: string
  category: string
  description: string
  prompt: string
  scope: PluginScope
  enabled: number
  default_enabled: number
  featured: number
  auto: number
  builtin: number
  sort_order: number
  created_at: number
}

export type PublicPlugin = {
  id: string
  name: string
  command: string
  icon: string
  category: string
  description: string
  scope: PluginScope
  featured: boolean
  builtin: boolean
  auto: boolean
  enabled: boolean
  sortOrder: number
}

export type AdminPlugin = PublicPlugin & {
  prompt: string
  defaultEnabled: boolean
  globalEnabled: boolean
}

export const PLUGIN_COMMAND_PATTERN = /^[a-z][a-z0-9-]{0,23}$/
export const RESERVED_PLUGIN_COMMANDS = new Set(['clear', 'compact', 'skills', 'plugins', 'help'])
export const PLUGIN_CATEGORIES = ['study', 'writing', 'office', 'code', 'general'] as const
export const PLUGIN_ICONS = ['sparkles', 'target', 'book', 'pen', 'translate', 'code', 'list', 'slides', 'doc', 'table', 'puzzle', 'compress'] as const

export const toPublicPlugin = (row: PluginRow & { user_enabled?: number }): PublicPlugin => ({
  id: row.id,
  name: row.name,
  command: row.command,
  icon: row.icon,
  category: row.category,
  description: row.description,
  scope: row.scope,
  featured: row.featured === 1,
  builtin: row.builtin === 1,
  auto: row.auto === 1,
  enabled: (row.user_enabled ?? row.default_enabled) === 1,
  sortOrder: row.sort_order,
})

export const toAdminPlugin = (row: PluginRow): AdminPlugin => ({
  ...toPublicPlugin({ ...row, user_enabled: row.enabled }),
  prompt: row.prompt,
  defaultEnabled: row.default_enabled === 1,
  globalEnabled: row.enabled === 1,
})

export const listPluginsForUser = (userId: string): PublicPlugin[] => {
  const rows = db.prepare(`SELECT p.*,COALESCE(up.enabled,p.default_enabled) user_enabled
    FROM plugins p LEFT JOIN user_plugins up ON up.plugin_id=p.id AND up.user_id=?
    WHERE p.enabled=1 ORDER BY p.featured DESC,p.sort_order,p.name`).all(userId) as (PluginRow & { user_enabled: number })[]
  return rows.map(toPublicPlugin)
}

export const listAllPlugins = (): AdminPlugin[] => {
  const rows = db.prepare('SELECT * FROM plugins ORDER BY builtin DESC,sort_order,name').all() as PluginRow[]
  return rows.map(toAdminPlugin)
}

export const getPlugin = (pluginId: string): PluginRow | undefined =>
  db.prepare('SELECT * FROM plugins WHERE id=?').get(pluginId) as PluginRow | undefined

/**
 * 用户没有手动选插件时，按提示词自动匹配一个技能。
 * 只匹配管理员标记为 auto 且用户已启用的插件；显式 `/命令` 不参与。
 */
export const detectAutoPlugin = (userId: string, prompt: string): PluginRow | null => {
  const command = detectAutoSkillCommand(prompt)
  if (!command) return null
  const row = db.prepare(`SELECT p.* FROM plugins p
    LEFT JOIN user_plugins up ON up.plugin_id=p.id AND up.user_id=?
    WHERE p.command=? AND p.auto=1 AND p.enabled=1 AND COALESCE(up.enabled,p.default_enabled)=1`)
    .get(userId, command) as PluginRow | undefined
  return row ?? null
}

/** 服务端生效条件：全局启用 + 用户未停用；用于流式请求与压缩之外的提示词注入。 */
export const getEnabledPluginForUser = (userId: string, pluginId: string | null | undefined): PluginRow | null => {
  if (!pluginId) return null
  const row = db.prepare(`SELECT p.* FROM plugins p
    LEFT JOIN user_plugins up ON up.plugin_id=p.id AND up.user_id=?
    WHERE p.id=? AND p.enabled=1 AND COALESCE(up.enabled,p.default_enabled)=1`).get(userId, pluginId) as PluginRow | undefined
  return row ?? null
}

export const setUserPluginEnabled = (userId: string, pluginId: string, enabled: boolean): boolean => {
  const plugin = db.prepare('SELECT id FROM plugins WHERE id=? AND enabled=1').get(pluginId)
  if (!plugin) throw new HttpError(404, '插件不存在或已停用')
  db.prepare(`INSERT INTO user_plugins(user_id,plugin_id,enabled) VALUES(?,?,?)
    ON CONFLICT(user_id,plugin_id) DO UPDATE SET enabled=excluded.enabled`)
    .run(userId, pluginId, enabled ? 1 : 0)
  return enabled
}

export const parsePluginCommand = (value: unknown): string => {
  const command = requireString(value, '命令', 40).toLowerCase()
  if (!PLUGIN_COMMAND_PATTERN.test(command)) {
    throw new HttpError(400, '命令只能包含小写字母、数字和短横线，并以字母开头')
  }
  if (RESERVED_PLUGIN_COMMANDS.has(command)) {
    throw new HttpError(400, `命令 /${command} 已被系统占用`)
  }
  return command
}

export const parsePluginCategory = (value: unknown): string => {
  const category = requireString(value, '分类', 20)
  if (!(PLUGIN_CATEGORIES as readonly string[]).includes(category)) {
    throw new HttpError(400, '插件分类不正确')
  }
  return category
}

export const parsePluginIcon = (value: unknown): string => {
  const icon = requireString(value, '图标', 20)
  if (!(PLUGIN_ICONS as readonly string[]).includes(icon)) {
    throw new HttpError(400, '插件图标不正确')
  }
  return icon
}

export const parsePluginScope = (value: unknown): PluginScope => {
  if (value !== 'conversation' && value !== 'message') throw new HttpError(400, '生效范围不正确')
  return value
}

export const parsePluginPrompt = (value: unknown): string => {
  const prompt = cleanText(requireString(value, '提示词', 8000), 8000)
  if (!prompt) throw new HttpError(400, '提示词不能为空')
  return prompt
}
