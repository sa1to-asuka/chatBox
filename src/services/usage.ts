import { request } from './auth.js'

export type UsageRecord = {
  requestId: string
  model: string
  day: string
  inputTokens: number
  outputTokens: number
  searchRequests: number
  multiplier: number
  charged: number
  status: string
  estimated: boolean
  createdAt: number
}
export type UsageData = {
  today: {
    day: string
    allowance: number
    used: number
    reserved: number
    remaining: number | null
    unlimited: boolean
    resetAt: number
  }
  byModel: { modelId: string; model: string; inputTokens: number; outputTokens: number; charged: number; searchRequests: number; requests: number }[]
  trend: { day: string; tokens: number; charged: number; searches: number }[]
  recent: UsageRecord[]
}
export const loadUsage = () => request<UsageData>('/api/usage/me')
