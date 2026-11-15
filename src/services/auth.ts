import { create } from 'zustand'
import type { PublicUser } from '../../shared/types.js'

export type AuthState = { status: 'loading' | 'anonymous' | 'authenticated'; user: PublicUser | null; error: string }
export const useAuth = create<AuthState>(() => ({ status: 'loading', user: null, error: '' }))
export const request = async <T>(url: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  if (response.status === 401 && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/register')) {
    useAuth.setState({ status: 'anonymous', user: null, error: '' })
  }
  const data = await response.json() as { error?: string }
  if (!response.ok) {throw new Error(data.error ?? '请求失败，请稍后重试')}
  return data as T
}
export const refreshUser = async () => {
  try {
    const result = await request<{ user: PublicUser | null }>('/api/auth/me')
    if (result.user) {useAuth.setState({ status: 'authenticated', user: result.user, error: '' })}
    else {useAuth.setState({ status: 'anonymous', user: null, error: '' })}
  } catch {
    useAuth.setState({ status: 'anonymous', user: null, error: '' })
  }
}
export const login = async (mode: 'login' | 'register', username: string, displayName: string, password: string) => {
  const result = await request<{ user: PublicUser }>(`/api/auth/${mode}`, {
    method: 'POST', body: JSON.stringify({ username, displayName, password }),
  })
  useAuth.setState({ status: 'authenticated', user: result.user, error: '' })
}
export const logout = async () => {
  await request('/api/auth/logout', { method: 'POST' })
  useAuth.setState({ status: 'anonymous', user: null, error: '' })
}
export const setUser = (user: PublicUser) => useAuth.setState({ user })
