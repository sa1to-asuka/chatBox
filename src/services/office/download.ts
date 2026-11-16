const MIME_BY_EXTENSION: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  svg: 'image/svg+xml;charset=utf-8',
  html: 'text/html;charset=utf-8',
}

/** 用 Blob + 临时 a 标签触发下载；移动端浏览器同样支持 download 属性。 */
export const downloadBlob = (blob: Blob, filename: string) => {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  const mime = MIME_BY_EXTENSION[extension]
  // pptxgenjs 等库返回的 Blob 可能标记为 application/zip；浏览器会因此给
  // .pptx 文件名再补一个 .zip。按扩展名强制正确的 MIME，避免 .pptx.zip。
  const typed = mime && blob.type !== mime ? new Blob([blob], { type: mime }) : blob
  const url = URL.createObjectURL(typed)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
