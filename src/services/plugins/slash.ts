import type { Plugin } from './types.js'

export type LocalCommand = 'clear' | 'compact' | 'skills'

export type SlashCommand =
  | { kind: 'local'; command: LocalCommand }
  | { kind: 'plugin'; plugin: Plugin; rest: string }

/** 输入框里“整段都是 / 加一个不含空白的关键词”时才打开菜单。 */
export const slashQuery = (text: string): string | null => {
  const match = /^\/([^\s]*)$/.exec(text)
  return match ? match[1].toLowerCase() : null
}

const localCommands: Record<string, LocalCommand> = {
  clear: 'clear',
  compact: 'compact',
  skills: 'skills',
  plugins: 'skills',
}

import { detectAutoSkillCommand } from '../../../shared/auto-skills.js'

export const detectAutoPlugin = (plugins: Plugin[], text: string): Plugin | null => {
  const command = detectAutoSkillCommand(text)
  if (!command) {return null}
  return plugins.find((item) => item.enabled && item.auto && item.command === command) ?? null
}

/**
 * 发送时解析 `/command rest`：即使没有点菜单，`/plan 帮我…` 也能识别。
 * 未知命令返回 null，按普通文本发送。
 */
export const parseSlashCommand = (text: string, plugins: Plugin[]): SlashCommand | null => {
  const match = /^\/([a-z0-9_-]+)(?:[ \t]+([\s\S]*))?$/i.exec(text.trim())
  if (!match) {return null}
  const command = match[1].toLowerCase()
  const rest = (match[2] ?? '').trim()
  const local = localCommands[command]
  if (local) {return { kind: 'local', command: local }}
  const plugin = plugins.find((item) => item.enabled && item.command.toLowerCase() === command)
  return plugin ? { kind: 'plugin', plugin, rest } : null
}
