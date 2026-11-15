import type { Session, SessionSummary } from './types.js'
export type StoredFile = { id: string; blob: Blob }
const json = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, options)
  const data = await response.json() as { error?: string }
  if (!response.ok) {throw new Error(data.error ?? '同步失败')}
  return data as T
}
export const createRemoteSession = async (session: Session) => {
  await json('/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: session.id }) })
}
export const loadSessionSummaries = async (): Promise<SessionSummary[]> =>
  (await json<{ sessions: SessionSummary[] }>('/api/chats')).sessions
export const loadSession = async (id: string): Promise<Session | undefined> =>
  (await json<{ session: Session }>(`/api/chats/${encodeURIComponent(id)}`)).session
export const saveSession = async (session: Session, _files: StoredFile[] = [], folderId?: string | null): Promise<void> => {
  void _files
  const result = await json<{ revision: number }>(`/api/chats/${encodeURIComponent(session.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...session, revision: session.revision ?? 0, ...(folderId !== undefined ? { folderId } : {}) }),
  })
  session.revision = result.revision
}
export const renameSession = async (id: string, title: string): Promise<void> => {
  await json(`/api/chats/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
}
export const saveSessionMeta = async (
  id: string,
  patch: { pinned?: boolean; folderId?: string | null },
): Promise<{ pinned: boolean; pinnedAt: number | null; folderId: string | null }> =>
  json(`/api/chats/${encodeURIComponent(id)}/meta`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  })
export const deleteSession = async (id: string): Promise<void> => {
  await json(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export const saveFiles = async (_files: StoredFile[]): Promise<void> => { void _files }
export const loadFile = async (id: string): Promise<Blob | undefined> => {
  const response = await fetch(`/api/files/${encodeURIComponent(id)}`)
  return response.ok ? response.blob() : undefined
}
export const clearStaging = async (): Promise<void> => undefined
export const addStagingSession = async (_session: Session): Promise<void> => { void _session }
export const saveStagingFiles = async (_files: StoredFile[]): Promise<void> => { void _files }
export const updateStagingFileTypes = async (_types: ReadonlyMap<string, string>): Promise<void> => { void _types }
export const commitStaging = async (): Promise<SessionSummary[]> => loadSessionSummaries()
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[sync] ${action} failed`, error)
}
