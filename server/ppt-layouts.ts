export type PptSlideLayout =
  | 'title'
  | 'section'
  | 'bullets'
  | 'kpis'
  | 'table'
  | 'quote'
  | 'chart'
  | 'closing'

export type PptKpi = { value: string; label: string }
export type PptChartItem = { label: string; value: number }
export type PptTable = { headers: string[]; rows: string[][] }

export type PptSlideSpec = {
  layout?: string
  title?: string
  subtitle?: string
  kicker?: string
  number?: string
  bullets?: string[]
  kpis?: PptKpi[]
  table?: PptTable
  quote?: string
  author?: string
  chart?: PptChartItem[]
  notes?: string
}

export type PptDeckSpec = {
  title?: string
  subtitle?: string
  slides?: PptSlideSpec[]
}

export type PptSvgSlide = { name: string; svg: string; notes: string }

const W = 1280
const H = 720
const M = 88
const CW = W - M * 2
const FONT = 'Microsoft YaHei'
const C = {
  ink: '#173B2B',
  green: '#2B5D45',
  gold: '#C9A45C',
  paper: '#F7F9F6',
  card: '#FFFFFF',
  soft: '#E8EEE7',
  text: '#1E2C24',
  muted: '#6B7A70',
  line: '#D5DDD5',
  white: '#FFFFFF',
  pale: '#C9D8CC',
}

const esc = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`

const text = (
  x: number,
  y: number,
  value: string,
  size: number,
  color: string,
  weight?: 'bold',
  opacity?: number
): string => {
  const extra = `${weight ? ` font-weight="${weight}"` : ''}${opacity !== undefined ? ` opacity="${opacity}"` : ''}`
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${color}"${extra}>${esc(value)}</text>`
}

const units = (value: string): number => {
  let total = 0
  for (const char of value) {
    if (/[⺀-鿿＀-￯　-〿]/.test(char)) total += 1
    else if (char === ' ') total += 0.32
    else if (/[A-Z0-9]/.test(char)) total += 0.62
    else total += 0.53
  }
  return total
}

const wrap = (value: string, maxUnits: number, maxLines = 3): string[] => {
  const result: string[] = []
  for (const paragraph of value.replace(/\r\n/g, '\n').split('\n')) {
    const clean = paragraph.trim()
    if (!clean) continue
    let line = ''
    let lineUnits = 0
    for (const char of clean) {
      const charUnits = units(char)
      if (line && lineUnits + charUnits > maxUnits) {
        result.push(line)
        line = char
        lineUnits = charUnits
      } else {
        line += char
        lineUnits += charUnits
      }
      if (result.length >= maxLines) break
    }
    if (result.length >= maxLines) break
    if (line) result.push(line)
  }
  return result.length ? result.slice(0, maxLines) : ['']
}

const lines = (
  x: number,
  y: number,
  value: string,
  size: number,
  color: string,
  maxUnits: number,
  lineHeight: number,
  weight?: 'bold'
): string => wrap(value, maxUnits).map((line, index) =>
  text(x, y + index * lineHeight, line, size, color, weight)
).join('')

const footer = (index: number, total: number, deckTitle: string, dark = false): string => {
  const color = dark ? C.pale : C.muted
  const line = dark ? '#2B5D45' : C.line
  return [
    `<line x1="${M}" y1="664" x2="${W - M}" y2="664" stroke="${line}" stroke-width="1"/>`,
    text(M, 694, `CHATBOX · ${deckTitle}`, 11, color),
    text(W - M - 58, 694, `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, 11, color),
  ].join('')
}

const accent = (x: number, y: number, width = 96, color = C.gold): string =>
  `<rect x="${x}" y="${y}" width="${width}" height="7" rx="3.5" fill="${color}"/>`

const heading = (slide: PptSlideSpec): { kicker: string; title: string } => ({
  kicker: slide.kicker?.trim() || '',
  title: slide.title?.trim() || 'Untitled',
})

const titleSlide = (slide: PptSlideSpec, deck: PptDeckSpec, _index: number, _total: number): string => {
  const title = slide.title?.trim() || deck.title?.trim() || 'Presentation'
  const subtitle = slide.subtitle?.trim() || deck.subtitle?.trim() || ''
  return svg([
    `<rect width="${W}" height="${H}" fill="${C.ink}"/>`,
    `<circle cx="1090" cy="120" r="270" fill="${C.green}" opacity="0.5"/>`,
    `<circle cx="1200" cy="610" r="150" fill="${C.gold}" opacity="0.12"/>`,
    accent(M, 238),
    lines(M, 326, title, 62, C.white, 17, 74, 'bold'),
    subtitle ? lines(M, 470, subtitle, 24, C.pale, 36, 34) : '',
    `<line x1="${M}" y1="604" x2="${W - M}" y2="604" stroke="${C.green}" stroke-width="1"/>`,
    text(M, 638, 'CHATBOX · AI PRESENTATION', 12, C.gold),
    text(W - M - 66, 638, new Date().toLocaleDateString('zh-CN'), 12, C.pale),
  ].join(''))
}

const sectionSlide = (slide: PptSlideSpec, deck: PptDeckSpec, index: number, total: number): string => {
  const { title } = heading(slide)
  const number = slide.number?.trim() || String(index).padStart(2, '0')
  return svg([
    `<rect width="${W}" height="${H}" fill="${C.ink}"/>`,
    `<circle cx="1130" cy="600" r="210" fill="${C.green}" opacity="0.35"/>`,
    text(M, 330, number, 190, C.green, 'bold', 0.5),
    accent(M, 370),
    lines(M, 450, title, 52, C.white, 18, 62, 'bold'),
    slide.subtitle ? lines(M, 530, slide.subtitle, 24, C.pale, 40, 34) : '',
    footer(index, total, deck.title || title, true),
  ].join(''))
}

const bulletsSlide = (slide: PptSlideSpec, deck: PptDeckSpec, index: number, total: number): string => {
  const { kicker, title } = heading(slide)
  const bullets = (slide.bullets ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
  const list = bullets.length ? bullets : ['补充要点']
  const twoColumns = list.length > 3
  const columns = twoColumns ? 2 : 1
  const rows = Math.ceil(list.length / columns)
  const gap = 16
  const cardWidth = twoColumns ? (CW - gap) / 2 : CW
  const cardHeight = twoColumns ? (rows >= 3 ? 128 : 170) : 116
  const body: string[] = [
    `<rect width="${W}" height="${H}" fill="${C.paper}"/>`,
    kicker ? text(M, 78, kicker.toUpperCase(), 13, C.gold, 'bold') : '',
    lines(M, 136, title, 38, C.ink, 28, 48, 'bold'),
    accent(M, 166),
  ]
  list.forEach((item, itemIndex) => {
    const col = itemIndex % columns
    const row = Math.floor(itemIndex / columns)
    const x = M + col * (cardWidth + gap)
    const y = 220 + row * (cardHeight + gap)
    const [lead, ...rest] = item.split(/[：:]/)
    const bodyText = rest.length ? rest.join('：').trim() : item
    const hasLead = rest.length > 0 && lead.trim().length <= 16
    const textX = x + 58
    const textWidth = cardWidth - 86
    const textUnits = Math.floor(textWidth / 18)
    body.push(`<rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="14" fill="${C.card}" stroke="${C.line}" stroke-width="1"/>`)
    body.push(`<circle cx="${x + 28}" cy="${y + 28}" r="17" fill="${C.green}"/>`)
    body.push(text(x + 28 - (String(itemIndex + 1).length * 4), y + 33, String(itemIndex + 1), 14, C.white, 'bold'))
    if (hasLead) {
      body.push(text(textX, y + 38, lead.trim(), 19, C.ink, 'bold'))
      body.push(lines(textX, y + 66, bodyText, 17, C.muted, textUnits, 24))
    } else {
      body.push(lines(textX, y + 42, bodyText, 18, C.text, textUnits, 26))
    }
  })
  body.push(footer(index, total, deck.title || title))
  return svg(body.join(''))
}

const kpisSlide = (slide: PptSlideSpec, deck: PptDeckSpec, index: number, total: number): string => {
  const { kicker, title } = heading(slide)
  const kpis = (slide.kpis ?? []).map((item) => ({
    value: String(item.value ?? '').trim(),
    label: String(item.label ?? '').trim(),
  })).filter((item) => item.value || item.label).slice(0, 4)
  const list = kpis.length ? kpis : [{ value: '—', label: '指标' }]
  const gap = 18
  const width = (CW - gap * (list.length - 1)) / list.length
  const body: string[] = [
    `<rect width="${W}" height="${H}" fill="${C.paper}"/>`,
    kicker ? text(M, 78, kicker.toUpperCase(), 13, C.gold, 'bold') : '',
    lines(M, 136, title, 38, C.ink, 28, 48, 'bold'),
    accent(M, 166),
  ]
  list.forEach((item, itemIndex) => {
    const x = M + itemIndex * (width + gap)
    const center = x + width / 2
    const valueSize = item.value.length > 7 ? 38 : 52
    const valueWidth = units(item.value) * valueSize
    body.push(`<rect x="${x}" y="224" width="${width}" height="300" rx="16" fill="${C.card}" stroke="${C.line}" stroke-width="1"/>`)
    body.push(`<rect x="${x}" y="224" width="${width}" height="7" rx="3.5" fill="${C.gold}"/>`)
    body.push(text(center - valueWidth / 2, 374, item.value || '—', valueSize, C.green, 'bold'))
    body.push(lines(center - Math.min(width - 40, units(item.label) * 18) / 2, 430, item.label, 17, C.muted, Math.floor((width - 40) / 17), 26))
    body.push(`<line x1="${x + 28}" y1="466" x2="${x + width - 28}" y2="466" stroke="${C.line}" stroke-width="1"/>`)
  })
  body.push(footer(index, total, deck.title || title))
  return svg(body.join(''))
}

const tableSlide = (slide: PptSlideSpec, deck: PptDeckSpec, index: number, total: number): string => {
  const { kicker, title } = heading(slide)
  const table = slide.table
  const headers = (table?.headers ?? []).map(String).slice(0, 6)
  const rows = (table?.rows ?? []).map((row) => row.map(String)).slice(0, 8)
  if (!headers.length || !rows.length) return bulletsSlide({ ...slide, layout: 'bullets' }, deck, index, total)
  const colWidth = CW / headers.length
  const headerHeight = 56
  const rowHeight = 48
  const body: string[] = [
    `<rect width="${W}" height="${H}" fill="${C.paper}"/>`,
    kicker ? text(M, 78, kicker.toUpperCase(), 13, C.gold, 'bold') : '',
    lines(M, 128, title, 36, C.ink, 28, 46, 'bold'),
    accent(M, 156),
    `<rect x="${M}" y="204" width="${CW}" height="${headerHeight}" rx="8" fill="${C.ink}"/>`,
  ]
  headers.forEach((header, column) => {
    body.push(lines(M + column * colWidth + 16, 238, header, 16, C.white, Math.floor((colWidth - 32) / 16), 20, 'bold'))
  })
  rows.forEach((row, rowIndex) => {
    const y = 204 + headerHeight + rowIndex * rowHeight
    body.push(`<rect x="${M}" y="${y}" width="${CW}" height="${rowHeight}" fill="${rowIndex % 2 === 0 ? C.card : C.soft}"/>`)
    row.slice(0, headers.length).forEach((cell, column) => {
      body.push(lines(M + column * colWidth + 16, y + 30, cell, 15, C.text, Math.floor((colWidth - 32) / 15), 19))
    })
  })
  body.push(footer(index, total, deck.title || title))
  return svg(body.join(''))
}

const quoteSlide = (slide: PptSlideSpec, deck: PptDeckSpec, index: number, total: number): string => {
  const quote = slide.quote?.trim() || slide.title?.trim() || ''
  const author = slide.author?.trim() || ''
  return svg([
    `<rect width="${W}" height="${H}" fill="${C.ink}"/>`,
    `<circle cx="1110" cy="580" r="230" fill="${C.green}" opacity="0.3"/>`,
    text(M, 250, '“', 170, C.gold, 'bold', 0.8),
    lines(M, 360, quote, 38, C.white, 28, 58, 'bold'),
    author ? text(M, 580, `— ${author}`, 20, C.pale) : '',
    accent(M, 620),
    footer(index, total, deck.title || quote, true),
  ].join(''))
}

const chartSlide = (slide: PptSlideSpec, deck: PptDeckSpec, index: number, total: number): string => {
  const { kicker, title } = heading(slide)
  const items = (slide.chart ?? []).map((item) => ({
    label: String(item.label ?? '').trim(),
    value: Number(item.value) || 0,
  })).slice(0, 8)
  if (!items.length) return kpisSlide(slide, deck, index, total)
  const max = Math.max(...items.map((item) => Math.abs(item.value)), 1)
  const chartX = 120
  const chartY = 220
  const chartW = 1040
  const chartH = 340
  const gap = 26
  const barW = Math.min(110, (chartW - gap * (items.length - 1)) / items.length)
  const body: string[] = [
    `<rect width="${W}" height="${H}" fill="${C.paper}"/>`,
    kicker ? text(M, 78, kicker.toUpperCase(), 13, C.gold, 'bold') : '',
    lines(M, 136, title, 38, C.ink, 28, 48, 'bold'),
    accent(M, 166),
    `<line x1="${chartX}" y1="${chartY + chartH}" x2="${chartX + chartW}" y2="${chartY + chartH}" stroke="${C.line}" stroke-width="1"/>`,
  ]
  for (let lineIndex = 1; lineIndex <= 3; lineIndex++) {
    const y = chartY + chartH - (chartH / 4) * lineIndex
    body.push(`<line x1="${chartX}" y1="${y}" x2="${chartX + chartW}" y2="${y}" stroke="${C.line}" stroke-width="0.6" opacity="0.6"/>`)
  }
  items.forEach((item, itemIndex) => {
    const height = Math.max(8, (Math.abs(item.value) / max) * (chartH - 24))
    const x = chartX + itemIndex * (barW + gap) + (chartW - (barW * items.length + gap * (items.length - 1))) / 2
    const y = chartY + chartH - height
    body.push(`<rect x="${x}" y="${y}" width="${barW}" height="${height}" rx="8" fill="${itemIndex % 2 === 0 ? C.green : C.gold}"/>`)
    body.push(text(x + barW / 2 - units(String(item.value)) * 9, y - 12, String(item.value), 18, C.ink, 'bold'))
    body.push(lines(x + barW / 2 - Math.min(barW, units(item.label) * 12) / 2, chartY + chartH + 28, item.label, 12, C.muted, Math.floor(barW / 12), 17))
  })
  body.push(footer(index, total, deck.title || title))
  return svg(body.join(''))
}

const closingSlide = (slide: PptSlideSpec, deck: PptDeckSpec, index: number, total: number): string => {
  const title = slide.title?.trim() || '谢谢'
  const subtitle = slide.subtitle?.trim() || 'Thanks for watching'
  return svg([
    `<rect width="${W}" height="${H}" fill="${C.ink}"/>`,
    `<circle cx="1110" cy="150" r="240" fill="${C.green}" opacity="0.45"/>`,
    `<circle cx="180" cy="620" r="180" fill="${C.gold}" opacity="0.1"/>`,
    accent(M, 286),
    lines(M, 380, title, 64, C.white, 18, 76, 'bold'),
    lines(M, 480, subtitle, 24, C.pale, 40, 34),
    text(M, 640, 'CHATBOX', 12, C.gold),
    footer(index, total, deck.title || title, true),
  ].join(''))
}

const fallbackDeck = (content: string, title: string): PptDeckSpec => {
  const clean = content.replace(/\r\n/g, '\n').trim()
  const blocks = clean.split(/\n(?=#{1,3}\s)/).map((block) => block.trim()).filter(Boolean)
  const slides: PptSlideSpec[] = [{ layout: 'title', title, subtitle: '由 Chatbox 文件 Agent 生成' }]
  for (const block of blocks.slice(0, 8)) {
    const headingMatch = /^#{1,3}\s+(.+)$/m.exec(block)
    const blockTitle = headingMatch?.[1]?.trim() || '要点'
    const bullets = block
      .split('\n')
      .filter((line) => line.trim() && !/^#{1,3}\s/.test(line.trim()))
      .map((line) => line.replace(/^\s*[-*+]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 5)
    slides.push({ layout: 'bullets', title: blockTitle, bullets: bullets.length ? bullets : [blockTitle] })
  }
  if (slides.length === 1) {
    const bullets = clean.split(/\n|。|；/).map((line) => line.trim()).filter(Boolean).slice(0, 5)
    slides.push({ layout: 'bullets', title: '核心内容', bullets: bullets.length ? bullets : ['请补充内容'] })
  }
  slides.push({ layout: 'closing', title: '谢谢', subtitle: 'Chatbox · 让表达更清晰' })
  return { title, subtitle: '由 Chatbox 文件 Agent 生成', slides }
}

const normalize = (value: unknown): PptDeckSpec => {
  const deck = (value && typeof value === 'object' ? value : {}) as PptDeckSpec
  const rawSlides = Array.isArray(deck.slides) ? deck.slides.slice(0, 12) : []
  const slides: PptSlideSpec[] = rawSlides.map((raw) => {
    const slide = (raw && typeof raw === 'object' ? raw : {}) as PptSlideSpec
    const layout = ['title', 'section', 'bullets', 'kpis', 'table', 'quote', 'chart', 'closing'].includes(String(slide.layout))
      ? String(slide.layout) as PptSlideLayout
      : 'bullets'
    const bullets = Array.isArray(slide.bullets)
      ? slide.bullets.map(String).filter((item) => item.trim()).slice(0, 6)
      : []
    const kpis = Array.isArray(slide.kpis)
      ? slide.kpis.slice(0, 4).map((item) => ({
        value: String(item?.value ?? ''),
        label: String(item?.label ?? ''),
      }))
      : []
    const chart = Array.isArray(slide.chart)
      ? slide.chart.slice(0, 8).map((item) => ({
        label: String(item?.label ?? ''),
        value: Number(item?.value) || 0,
      }))
      : []
    const table = slide.table && typeof slide.table === 'object'
      ? {
        headers: Array.isArray(slide.table.headers) ? slide.table.headers.map(String).slice(0, 6) : [],
        rows: Array.isArray(slide.table.rows)
          ? slide.table.rows.slice(0, 8).map((row) => (Array.isArray(row) ? row.map(String) : []))
          : [],
      }
      : undefined
    return {
      layout,
      title: typeof slide.title === 'string' ? slide.title : '',
      subtitle: typeof slide.subtitle === 'string' ? slide.subtitle : '',
      kicker: typeof slide.kicker === 'string' ? slide.kicker : '',
      number: typeof slide.number === 'string' ? slide.number : '',
      bullets,
      kpis,
      chart,
      table,
      quote: typeof slide.quote === 'string' ? slide.quote : '',
      author: typeof slide.author === 'string' ? slide.author : '',
      notes: typeof slide.notes === 'string' ? slide.notes : '',
    }
  })
  if (!slides.length) return { title: deck.title, subtitle: deck.subtitle, slides: [] }
  if (slides[0].layout !== 'title') {
    slides.unshift({ layout: 'title', title: deck.title || slides[0].title || 'Presentation', subtitle: deck.subtitle || '' })
  }
  return { title: deck.title, subtitle: deck.subtitle, slides }
}

export const parsePptDeck = (content: string, fallbackTitle: string): PptDeckSpec => {
  const raw = content.trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return normalize(JSON.parse(raw.slice(start, end + 1)))
    } catch {
      // 模型没有返回合法 JSON 时，按 Markdown 结构生成兜底 deck。
    }
  }
  return fallbackDeck(raw, fallbackTitle)
}

export const buildPptSvgSlides = (deck: PptDeckSpec): PptSvgSlide[] => {
  const slides = deck.slides?.length ? deck.slides : [{ layout: 'title', title: deck.title }]
  const total = slides.length
  return slides.map((slide, index) => {
    const layout = (slide.layout ?? 'bullets') as PptSlideLayout
    const args = [slide, deck, index, total] as const
    let body: string
    switch (layout) {
      case 'title':
        body = titleSlide(...args)
        break
      case 'section':
        body = sectionSlide(...args)
        break
      case 'kpis':
        body = kpisSlide(...args)
        break
      case 'table':
        body = tableSlide(...args)
        break
      case 'quote':
        body = quoteSlide(...args)
        break
      case 'chart':
        body = chartSlide(...args)
        break
      case 'closing':
        body = closingSlide(...args)
        break
      default:
        body = bulletsSlide(...args)
    }
    return {
      name: `slide_${String(index + 1).padStart(2, '0')}`,
      svg: body,
      notes: slide.notes?.trim() || '',
    }
  })
}
