const MAX_DIMENSION = 2400

/** 把 SVG 字符串栅格化为 PNG；用于“保存图片”，不依赖服务器。 */
export const svgToPngBlob = async (svg: string, pixelRatio = 2): Promise<Blob> => {
  let source = svg.trim()
  if (!source) {throw new Error('SVG 内容为空')}
  if (!/xmlns=/.test(source)) {
    source = source.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (doc.querySelector('parsererror')) {throw new Error('SVG 解析失败')}
  const root = doc.documentElement
  const viewBox = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const widthAttr = root.getAttribute('width') ?? ''
  const heightAttr = root.getAttribute('height') ?? ''
  const attrWidth = widthAttr.includes('%') ? Number.NaN : Number.parseFloat(widthAttr)
  const attrHeight = heightAttr.includes('%') ? Number.NaN : Number.parseFloat(heightAttr)
  let width = Number.isFinite(attrWidth) && attrWidth > 0 ? attrWidth : viewBox[2]
  let height = Number.isFinite(attrHeight) && attrHeight > 0 ? attrHeight : viewBox[3]
  if (!Number.isFinite(width) || !width || !Number.isFinite(height) || !height) {
    width = 1024
    height = 768
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale * pixelRatio))
  canvas.height = Math.max(1, Math.round(height * scale * pixelRatio))
  const context = canvas.getContext('2d')
  if (!context) {throw new Error('无法创建画布')}
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('SVG 渲染失败'))
      image.src = url
    })
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 生成失败')), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
