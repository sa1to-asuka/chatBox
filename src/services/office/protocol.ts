export type OfficeKind = 'xlsx' | 'docx' | 'pptx'

export const officeKind = (infostring: string): OfficeKind | null => {
  const value = infostring.trim().toLowerCase()
  return value === 'xlsx' || value === 'docx' || value === 'pptx' ? value : null
}

/** 解析代码块 info 里的 filename="…" sheet="…" 等参数。 */
export const parseMeta = (meta: string | undefined): Record<string, string> => {
  const result: Record<string, string> = {}
  if (!meta) {return result}
  const pattern = /([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(meta))) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? ''
  }
  return result
}

export const safeFilename = (value: string | undefined, fallback: string): string => {
  const cleaned = (value ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80)
  return cleaned || fallback
}

export const defaultFilename = (kind: OfficeKind): string => {
  const date = new Date()
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return `Chatbox-${stamp}.${kind}`
}

export const ensureExtension = (name: string, kind: OfficeKind): string =>
  name.toLowerCase().endsWith(`.${kind}`) ? name : `${name}.${kind}`

export const formatBytes = (size: number): string => {
  if (size < 1024) {return `${size} B`}
  if (size < 1024 * 1024) {return `${(size / 1024).toFixed(1)} KB`}
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export const sanitizeSheetName = (value: string | undefined): string => {
  const cleaned = (value ?? '').replace(/[\\/?*[\]:]/g, '').trim().slice(0, 31)
  return cleaned || 'Sheet1'
}
