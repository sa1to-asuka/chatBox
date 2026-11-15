import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { attachmentDir, db } from './db.js'
import type { InputContent } from './providers/shared.js'
import { HttpError } from './http.js'

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const textExtensions = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'log', 'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh', 'sql', 'css', 'html', 'vue'])
const extension = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
export const attachmentContent = async (userId: string, ids: string[], capabilities: { vision: boolean; files: boolean }): Promise<InputContent> => {
  const result: Exclude<InputContent, string> = []
  let extractedChars = 0
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const file = db.prepare('SELECT * FROM attachments WHERE id=? AND user_id=?').get(id, userId) as { name: string; storage_name: string; mime_type: string; is_image: number; size: number } | undefined
    if (!file) throw new HttpError(400, '附件不存在或无权访问')
    const filePath = path.join(attachmentDir, file.storage_name)
    const ext = extension(file.name)
    if (file.is_image) {
      if (!capabilities.vision || !imageTypes.has(file.mime_type)) throw new HttpError(400, '当前模型不支持该图片，请切换视觉模型')
      const data = await readFile(filePath)
      result.push({ type: 'text', text: `图片附件「${file.name}」：` })
      result.push({ type: 'image', mimeType: file.mime_type, data: data.toString('base64') })
    } else if (ext === 'pdf' || ext === 'docx') {
      let text = ''
      try {
        if (ext === 'pdf') {
          const { getDocumentProxy, extractText } = await import('unpdf')
          const pdf = await getDocumentProxy(new Uint8Array(await readFile(filePath)))
          if (pdf.numPages > 300) throw new HttpError(400, `PDF「${file.name}」超过 300 页，请拆分后上传`)
          const extracted = await extractText(pdf, { mergePages: true })
          text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
        } else {
          const mammoth = await import('mammoth')
          text = (await mammoth.extractRawText({ buffer: await readFile(filePath) })).value
        }
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new HttpError(400, `无法读取附件「${file.name}」，请确认文件未加密或损坏`)
      }
      text = text.trim()
      if (!text) throw new HttpError(400, `附件「${file.name}」没有可提取的文字`)
      if (text.length > 80000) throw new HttpError(400, `附件「${file.name}」文字过多，请拆分后上传`)
      extractedChars += text.length
      if (extractedChars > 120000) throw new HttpError(400, '文档总文字量过大，请减少附件')
      result.push({ type: 'document', name: file.name, text })
    } else if (textExtensions.has(ext)) {
      const data = await readFile(filePath, 'utf8')
      if (data.length > 80000) throw new HttpError(400, `附件「${file.name}」文本过长，请拆分后上传`)
      extractedChars += data.length
      if (extractedChars > 120000) throw new HttpError(400, '文档总文字量过大，请减少附件')
      result.push({ type: 'document', name: file.name, text: data })
    } else {
      throw new HttpError(400, `附件「${file.name}」格式不受支持`)
    }
  }
  return result
}
