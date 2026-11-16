import { create } from 'zustand'

type PluginMarketState = {
  open: boolean
  pluginId: string | null
  manage: boolean
  openMarket: (pluginId?: string | null, manage?: boolean) => void
  closeMarket: () => void
}

export const usePluginMarket = create<PluginMarketState>((set) => ({
  open: false,
  pluginId: null,
  manage: false,
  openMarket: (pluginId = null, manage = false) => set({ open: true, pluginId, manage }),
  closeMarket: () => set({ open: false, pluginId: null, manage: false }),
}))

export const openPluginMarket = (pluginId: string | null = null, manage = false) =>
  usePluginMarket.getState().openMarket(pluginId, manage)

export const closePluginMarket = () => usePluginMarket.getState().closeMarket()
