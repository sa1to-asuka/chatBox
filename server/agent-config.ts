import { db } from './db.js'
import { decrypt } from './auth.js'
import { getText, setText } from './settings.js'
import type { Provider } from './providers/shared.js'

export type AgentSearchBackend = 'bing' | 'mimo' | 'none'
export type AgentSearchStyle = 'auto' | 'json' | 'native'

export type AgentConfig = {
  enabled: boolean
  searchBackend: AgentSearchBackend
  searchModelId: string | null
  searchStyle: AgentSearchStyle
  presearch: boolean
  maxRounds: number
  maxSearches: number
  maxFiles: number
  deadlineMs: number
}

type SearchModelRow = {
  id: string
  upstream_id: string
  display_name: string
  multiplier: number
  provider_id: string
  provider_name: string
  type: 'openai' | 'anthropic'
  base_url: string
  api_key_encrypted: string
}

export type SearchModel = {
  id: string
  model: string
  type: 'openai' | 'anthropic'
  base_url: string
  key: string
  multiplier: number
}

export type SearchBackend =
  | { kind: 'bing' }
  | {
      kind: 'mimo'
      modelId: string
      model: string
      provider: Provider
      multiplier: number
    }

const clampInt = (value: string, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

const searchBackendValue = (value: string): AgentSearchBackend =>
  value === 'mimo' || value === 'none' ? value : 'bing'

const searchStyleValue = (value: string): AgentSearchStyle =>
  value === 'json' || value === 'native' ? value : 'auto'

export const autoMimoModelId = (): string | null => {
  const row = db.prepare(`SELECT m.id FROM models m JOIN providers p ON p.id=m.provider_id
    WHERE m.enabled=1 AND p.enabled=1
      AND (LOWER(m.upstream_id) LIKE '%mimo%' OR LOWER(m.display_name) LIKE '%mimo%')
      AND LOWER(m.upstream_id) NOT LIKE '%tts%'
      AND LOWER(m.upstream_id) NOT LIKE '%asr%'
      AND LOWER(m.upstream_id) NOT LIKE '%voice%'
    ORDER BY CASE WHEN LOWER(m.upstream_id)='mimo-v2.6-flash' THEN 0 ELSE 1 END,
      m.premium, m.display_name LIMIT 1`).get() as { id: string } | undefined
  return row?.id ?? null
}

export const getAgentConfig = (): AgentConfig => {
  const rawSearchModel = getText('agent_search_model_id', '').trim()
  const searchModelId = rawSearchModel === 'none'
    ? null
    : rawSearchModel || autoMimoModelId()
  return {
    enabled: process.env.AGENT_ENABLED !== '0' && getText('agent_enabled', '1') !== '0',
    searchBackend: searchBackendValue(getText('agent_search_backend', 'bing')),
    searchModelId,
    searchStyle: searchStyleValue(getText('agent_search_style', 'auto')),
    presearch: getText('agent_presearch', '1') !== '0',
    maxRounds: clampInt(getText('agent_max_rounds', '6'), 6, 1, 12),
    maxSearches: clampInt(getText('agent_max_searches', '4'), 4, 1, 8),
    maxFiles: clampInt(getText('agent_max_files', '2'), 2, 1, 3),
    deadlineMs: clampInt(getText('agent_deadline_ms', '150000'), 150_000, 30_000, 300_000),
  }
}

const searchModelRow = (id: string): SearchModelRow | undefined =>
  db.prepare(`SELECT m.id,m.upstream_id,m.display_name,m.multiplier,m.provider_id,
    p.name provider_name,p.type,p.base_url,p.api_key_encrypted
    FROM models m JOIN providers p ON p.id=m.provider_id
    WHERE m.id=? AND m.enabled=1 AND p.enabled=1`).get(id) as SearchModelRow | undefined

export const resolveSearchBackend = (config = getAgentConfig()): SearchBackend | null => {
  if (!config.enabled || config.searchBackend === 'none') return null
  if (config.searchBackend === 'bing') return { kind: 'bing' }
  if (!config.searchModelId) return null
  const row = searchModelRow(config.searchModelId)
  if (!row) return null
  try {
    return {
      kind: 'mimo',
      modelId: row.id,
      model: row.upstream_id,
      multiplier: row.multiplier,
      provider: {
        id: row.provider_id,
        name: row.provider_name,
        type: row.type,
        base_url: row.base_url,
        key: decrypt(row.api_key_encrypted),
      },
    }
  } catch {
    return null
  }
}

export const getSearchModel = (id: string | null): SearchModel | null => {
  if (!id) return null
  const row = searchModelRow(id)
  if (!row) return null
  try {
    return {
      id: row.id,
      model: row.upstream_id,
      type: row.type,
      base_url: row.base_url,
      key: decrypt(row.api_key_encrypted),
      multiplier: row.multiplier,
    }
  } catch {
    return null
  }
}

export const saveAgentSettings = (input: {
  enabled?: boolean
  searchBackend?: AgentSearchBackend
  searchModelId?: string | null
  searchStyle?: AgentSearchStyle
  presearch?: boolean
  maxRounds?: number
  maxSearches?: number
  maxFiles?: number
}): void => {
  if (input.enabled !== undefined) setText('agent_enabled', input.enabled ? '1' : '0')
  if (input.searchBackend) setText('agent_search_backend', input.searchBackend)
  if (input.searchModelId !== undefined) setText('agent_search_model_id', input.searchModelId ?? 'none')
  if (input.searchStyle) setText('agent_search_style', input.searchStyle)
  if (input.presearch !== undefined) setText('agent_presearch', input.presearch ? '1' : '0')
  if (input.maxRounds !== undefined) setText('agent_max_rounds', String(Math.min(12, Math.max(1, input.maxRounds))))
  if (input.maxSearches !== undefined) setText('agent_max_searches', String(Math.min(8, Math.max(1, input.maxSearches))))
  if (input.maxFiles !== undefined) setText('agent_max_files', String(Math.min(3, Math.max(1, input.maxFiles))))
}
