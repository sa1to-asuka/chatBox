import { request } from './auth.js'

export type ShareInfo = { id: string; createdAt: number } | null
export const getShare = async (chatId: string) =>
  (await request<{ share: ShareInfo }>(`/api/chats/${encodeURIComponent(chatId)}/shares`)).share
export const createShare = (chatId: string) =>
  request<{ id: string; token: string; createdAt: number }>(`/api/chats/${encodeURIComponent(chatId)}/shares`, { method: 'POST' })
export const revokeShare = (shareId: string) =>
  request(`/api/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' })
export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`
export const downloadExport = (chatId: string, format: 'md' | 'json') => {
  const anchor = document.createElement('a')
  anchor.href = `/api/chats/${encodeURIComponent(chatId)}/export?format=${format}`
  anchor.download = ''
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}
