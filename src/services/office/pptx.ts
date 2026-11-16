type PptxSlide = { title?: unknown; bullets?: unknown; notes?: unknown }
type PptxConstructor = typeof import('pptxgenjs').default
type PptxSpec = { title?: unknown; slides?: unknown }

const asText = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback

export const buildPptxBlob = async (json: string): Promise<Blob> => {
  let spec: PptxSpec
  try {
    spec = JSON.parse(json) as PptxSpec
  } catch {
    throw new Error('演示文稿 JSON 格式不正确，请让模型重新生成')
  }
  if (!spec || typeof spec !== 'object') {throw new Error('演示文稿 JSON 格式不正确')}
  const slides: PptxSlide[] = Array.isArray(spec.slides) ? spec.slides.slice(0, 50) as PptxSlide[] : []
  if (slides.length === 0) {throw new Error('演示文稿没有页面')}

  const module = await import('pptxgenjs')
  const Pptx = (module.default ?? module) as unknown as PptxConstructor
  const pptx = new Pptx()
  pptx.layout = 'LAYOUT_16x9'
  pptx.author = 'Chatbox'
  pptx.company = 'Chatbox'
  pptx.subject = asText(spec.title, 'Chatbox 演示文稿')
  pptx.title = asText(spec.title, 'Chatbox 演示文稿')

  const cover = pptx.addSlide()
  cover.background = { color: '173B2B' }
  cover.addText(asText(spec.title, '演示文稿'), {
    x: 0.7, y: 2.0, w: 8.6, h: 1.3, fontSize: 34, bold: true,
    color: 'FFFFFF', fontFace: 'Microsoft YaHei', valign: 'middle',
  })
  cover.addText(new Date().toLocaleDateString('zh-CN'), {
    x: 0.7, y: 3.4, w: 8.6, h: 0.5, fontSize: 14, color: 'C9D8CC', fontFace: 'Microsoft YaHei',
  })

  for (const item of slides) {
    const slide = pptx.addSlide()
    slide.background = { color: 'F7F9F6' }
    slide.addText(asText(item.title, '未命名页面'), {
      x: 0.6, y: 0.4, w: 8.8, h: 0.8, fontSize: 26, bold: true,
      color: '173B2B', fontFace: 'Microsoft YaHei',
    })
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.6, y: 1.3, w: 1.1, h: 0.08, fill: { color: '2B5D45' }, line: { color: '2B5D45' },
    })
    const bullets = Array.isArray(item.bullets)
      ? item.bullets.filter((value): value is string => typeof value === 'string').slice(0, 12)
      : []
    if (bullets.length > 0) {
      slide.addText(bullets.map((text) => ({
        text,
        options: { bullet: { indent: 16 }, breakLine: true },
      })), {
        x: 0.75, y: 1.7, w: 8.5, h: 4.4, fontSize: 18, color: '2C3A32',
        fontFace: 'Microsoft YaHei', valign: 'top', lineSpacingMultiple: 1.25,
      })
    }
    const notes = asText(item.notes).trim()
    if (notes) {slide.addNotes(notes)}
  }

  return await pptx.write({ outputType: 'blob' }) as Blob
}
