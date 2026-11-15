import { create } from 'zustand'
import { request, setUser } from './auth.js'
import type { PublicModel, PublicUser } from '../../shared/types.js'
export const useModels = create<{ models: PublicModel[]; selected: string; loaded: boolean; error: string }>(() => ({
  models: [], selected: '', loaded: false, error: '',
}))
export const loadModels = async () => {
  useModels.setState({ error: '' })
  try {
    const { models } = await request<{ models: PublicModel[] }>('/api/models')
    const saved = localStorage.getItem('chat:selected-model')
    const selected = models.find((model) => model.id === saved)?.id ?? models[0]?.id ?? ''
    useModels.setState({ models, loaded: true, selected })
  } catch (error) {
    useModels.setState({ loaded: false, error: error instanceof Error ? error.message : '模型加载失败' })
  }
}
export const resetModels = () => useModels.setState({ models: [], selected: '', loaded: false, error: '' })
export const selectModel = (selected: string) => {
  localStorage.setItem('chat:selected-model', selected)
  useModels.setState({ selected })
}
export const refreshQuota = async () => {
  const { user } = await request<{ user: PublicUser | null }>('/api/auth/me')
  if (user) {setUser(user)}
}
