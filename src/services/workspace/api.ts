import { request } from '../auth.js'

export type WorkspaceOutputFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf'
export type WorkspaceStepStatus = 'pending' | 'running' | 'done' | 'failed'
export type WorkspaceStep = {
  key: string
  label: string
  status: WorkspaceStepStatus
  detail?: string
}

export type WorkspaceTask = {
  id: string
  title: string
  status: 'queued' | 'processing' | 'done' | 'failed'
  instruction: string
  modelId: string
  sourceName: string
  outputFormat: WorkspaceOutputFormat
  plan: string[]
  steps: WorkspaceStep[]
  outputName: string | null
  outputSize: number | null
  error: string | null
  origin?: 'upload' | 'chat'
  expired?: boolean
  remainingMs?: number
  downloadUrl?: string
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export type WorkspaceTaskList = {
  tasks: WorkspaceTask[]
  retentionDays: number
  nextCursor?: string | null
  total?: number
}

export const createFileTaskFromAttachment = (input: {
  attachmentId: string
  instruction: string
  format: WorkspaceOutputFormat
  modelId: string
}) => request<{ task: WorkspaceTask }>('/api/workspace/tasks/from-attachment', {
  method: 'POST',
  body: JSON.stringify(input),
})

export const getWorkspaceTask = (id: string) =>
  request<{ task: WorkspaceTask }>(`/api/workspace/tasks/${encodeURIComponent(id)}`)

export const retryWorkspaceTask = (id: string) =>
  request<{ task: WorkspaceTask }>(`/api/workspace/tasks/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
  })

export const listWorkspaceTasks = (params: {
  status?: 'done' | 'failed' | 'active'
  format?: WorkspaceOutputFormat
  limit?: number
  cursor?: string
  includeExpired?: boolean
} = {}) => {
  const query = new URLSearchParams()
  if (params.status) {query.set('status', params.status)}
  if (params.format) {query.set('format', params.format)}
  if (params.limit) {query.set('limit', String(params.limit))}
  if (params.cursor) {query.set('cursor', params.cursor)}
  if (params.includeExpired) {query.set('includeExpired', '1')}
  query.set('limit', String(params.limit ?? 20))
  return request<WorkspaceTaskList>(`/api/workspace/tasks?${query.toString()}`)
}

export const deleteWorkspaceTask = (id: string) =>
  request<{ ok: true }>(`/api/workspace/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const workspaceDownloadUrl = (id: string) =>
  `/api/workspace/tasks/${encodeURIComponent(id)}/download`

export const saveWorkspaceArtifact = (input: {
  format: 'docx' | 'xlsx' | 'pptx'
  title: string
  content: string
}) => request<{ task: WorkspaceTask }>('/api/workspace/artifacts', {
  method: 'POST',
  body: JSON.stringify(input),
})
