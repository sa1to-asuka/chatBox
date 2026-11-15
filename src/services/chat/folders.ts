import { create } from 'zustand'
import { request } from '../auth.js'
import type { Folder } from '../../../shared/types.js'

const ACTIVE_KEY = 'chat:active-folder'
const readActive = () => {
  try { return localStorage.getItem(ACTIVE_KEY) } catch { return null }
}

type FolderState = {
  folders: Folder[]
  loaded: boolean
  error: string
  activeFolderId: string | null
  collapsed: Record<string, boolean>
}
export const useFolders = create<FolderState>(() => ({
  folders: [], loaded: false, error: '', activeFolderId: readActive(), collapsed: {},
}))

export const loadFolders = async () => {
  try {
    const { folders } = await request<{ folders: Folder[] }>('/api/folders')
    const active = useFolders.getState().activeFolderId
    const activeFolderId = active && folders.some((folder) => folder.id === active) ? active : null
    if (!activeFolderId) {
      try { localStorage.removeItem(ACTIVE_KEY) } catch { /* local preference unavailable */ }
    }
    useFolders.setState((state) => ({
      folders, loaded: true, error: '', activeFolderId,
      collapsed: Object.fromEntries(Object.entries(state.collapsed).filter(([id]) => folders.some((folder) => folder.id === id))),
    }))
  } catch (error) {
    useFolders.setState({ loaded: true, error: error instanceof Error ? error.message : '分类加载失败' })
  }
}
export const setActiveFolder = (activeFolderId: string | null) => {
  try {
    if (activeFolderId) {localStorage.setItem(ACTIVE_KEY, activeFolderId)}
    else {localStorage.removeItem(ACTIVE_KEY)}
  } catch { /* local preference unavailable */ }
  useFolders.setState({ activeFolderId })
}
export const toggleFolder = (id: string) => useFolders.setState((state) => ({
  collapsed: { ...state.collapsed, [id]: !state.collapsed[id] },
}))
export const expandFolder = (id: string) => useFolders.setState((state) => ({
  collapsed: { ...state.collapsed, [id]: false },
}))
export const resetFolders = () => useFolders.setState({ folders: [], loaded: false, error: '', activeFolderId: null, collapsed: {} })
export const createFolder = async (name: string) => {
  const folder = await request<Folder>('/api/folders', { method: 'POST', body: JSON.stringify({ name }) })
  await loadFolders()
  expandFolder(folder.id)
  return folder
}
export const renameFolder = async (id: string, name: string) => {
  await request(`/api/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) })
  await loadFolders()
}
export const deleteFolder = async (id: string) => {
  await request(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (useFolders.getState().activeFolderId === id) {setActiveFolder(null)}
  await loadFolders()
}
