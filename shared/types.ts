export type Role = 'user' | 'vip' | 'admin'
export type ProviderType = 'openai' | 'anthropic'
export type SearchMode = 'none' | 'openai' | 'anthropic' | 'deepseek'
export const SEARCH_MODES: readonly SearchMode[] = ['none', 'openai', 'anthropic', 'deepseek']
export const isSearchMode = (value: unknown): value is SearchMode =>
  typeof value === 'string' && (SEARCH_MODES as readonly string[]).includes(value)
export type ModelCapabilities = { vision: boolean; files: boolean; thinking: boolean; search: boolean; tools: boolean }
export type PublicModel = {
  id: string
  name: string
  upstreamId: string
  provider: string
  premium: boolean
  multiplier: number
  capabilities: ModelCapabilities
}
export type Folder = {
  id: string
  name: string
  position: number
  sessionCount: number
}
export type PublicUser = {
  id: string
  username: string
  displayName: string
  role: Role
  disabled: boolean
  unlimited: boolean
  dailyQuota: number
  quotaUsed: number
  quotaReserved: number
}
export type ProviderModel = { id: string; name: string }
export type ChatUsage = { input: number; output: number; estimated: boolean; searches?: number }

export const json = <T>(value: T): string => JSON.stringify(value)
export const parse = <T>(value: string): T => JSON.parse(value) as T
export const beijingDay = (time = Date.now()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(time)
export const clampInteger = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value : null

/** Next midnight in Asia/Shanghai, expressed as a UTC epoch timestamp. */
export const beijingResetAt = (time = Date.now()): number => {
  const shifted = new Date(time + 8 * 3600_000)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1) - 8 * 3600_000
}
