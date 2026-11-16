import { create } from 'zustand'
import { request } from '../auth.js'
import type { Plugin } from './types.js'

type PluginState = {
  plugins: Plugin[]
  loading: boolean
  loaded: boolean
  error: string
  load: () => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
  reset: () => void
}

export const usePlugins = create<PluginState>((set, get) => ({
  plugins: [],
  loading: false,
  loaded: false,
  error: '',
  load: async () => {
    if (get().loading) {return}
    set({ loading: true, error: '' })
    try {
      const data = await request<{ plugins: Plugin[] }>('/api/plugins')
      set({ plugins: data.plugins, loaded: true, loading: false })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '插件加载失败' })
    }
  },
  toggle: async (id, enabled) => {
    const previous = get().plugins
    set({ plugins: previous.map((plugin) => plugin.id === id ? { ...plugin, enabled } : plugin) })
    try {
      await request(`/api/plugins/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
    } catch (error) {
      set({ plugins: previous })
      throw error
    }
  },
  reset: () => set({ plugins: [], loading: false, loaded: false, error: '' }),
}))

export const enabledPlugins = (plugins: Plugin[]) => plugins.filter((plugin) => plugin.enabled)
