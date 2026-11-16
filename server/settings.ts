import { db } from './db.js'
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js'

export const getText = (key: string, fallback: string): string => {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  return row?.value ?? fallback
}

export const setText = (key: string, value: string): void => {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value)
}

export const getSystemPrompt = (): string => getText('system_prompt', DEFAULT_SYSTEM_PROMPT)

export const isSystemPromptEnabled = (): boolean => getText('system_prompt_enabled', '1') !== '0'
