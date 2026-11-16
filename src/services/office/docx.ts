import type { List, ListItem, PhrasingContent, Root, RootContent } from 'mdast'
import { toMdAst } from '../markdown/parse.js'

const MAX_MARKDOWN = 2_000_000

type RunStyle = {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  color?: string
  font?: string
  size?: number
}

/**
 * Markdown → Word。复用页面已有的 mdast 解析器，只映射常用节点；
 * 链接输出为“文字 + URL”，公式和图表按原文文本保留。
 */
export const buildDocxBlob = async (markdown: string): Promise<Blob> => {
  if (markdown.length > MAX_MARKDOWN) {throw new Error('文档内容过大，请缩小范围后重试')}
  const docx = await import('docx')
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    WidthType, BorderStyle, AlignmentType,
  } = docx

  const runs = (nodes: readonly (PhrasingContent | RootContent)[], style: RunStyle = {}) => {
    const result: InstanceType<typeof TextRun>[] = []
    for (const node of nodes) {
      switch (node.type) {
        case 'text':
          result.push(new TextRun({ text: node.value, ...style }))
          break
        case 'strong':
          result.push(...runs(node.children, { ...style, bold: true }))
          break
        case 'emphasis':
          result.push(...runs(node.children, { ...style, italics: true }))
          break
        case 'delete':
          result.push(...runs(node.children, { ...style, strike: true }))
          break
        case 'inlineCode':
          result.push(new TextRun({ text: node.value, font: 'Consolas', ...style }))
          break
        case 'link':
          result.push(...runs(node.children, { ...style, color: '2B5D45' }))
          break
        case 'break':
          result.push(new TextRun({ break: 1 }))
          break
        case 'image':
          result.push(new TextRun({ text: node.alt ?? node.url, ...style }))
          break
        case 'html':
          result.push(new TextRun({ text: node.value, ...style }))
          break
        default:
          break
      }
    }
    return result
  }

  const headingLevel = (depth: number) => [
    HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
  ][Math.min(6, Math.max(1, depth)) - 1]

  const listParagraphs = (node: List, level = 0): (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] =>
    node.children.flatMap((item: ListItem) => {
      const [first, ...rest] = item.children
      const head = new Paragraph({
        children: first?.type === 'paragraph' ? runs(first.children) : [],
        ...(node.ordered
          ? { numbering: { reference: 'chatbox-ordered', level: Math.min(level, 2) } }
          : { bullet: { level: Math.min(level, 4) } }),
        spacing: { after: 60 },
      })
      const nested = rest.flatMap((child) => child.type === 'list'
        ? listParagraphs(child, level + 1)
        : blocks([child]))
      return [head, ...nested]
    })

  const blocks = (nodes: readonly RootContent[]): (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] =>
    nodes.flatMap((node) => {
      switch (node.type) {
        case 'heading':
          return [new Paragraph({
            heading: headingLevel(node.depth),
            children: runs(node.children),
            spacing: { before: 200, after: 100 },
          })]
        case 'paragraph':
          return [new Paragraph({ children: runs(node.children), spacing: { after: 120 } })]
        case 'list':
          return listParagraphs(node)
        case 'code':
          return node.value.split('\n').map((line, index, lines) => new Paragraph({
            children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 20 })],
            shading: { fill: 'F3F5F0' },
            spacing: { after: index === lines.length - 1 ? 160 : 0 },
          }))
        case 'blockquote':
          return node.children.flatMap((child) => child.type === 'paragraph'
            ? [new Paragraph({ children: runs(child.children), indent: { left: 720 }, spacing: { after: 120 } })]
            : blocks([child]))
        case 'table':
          return [new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: node.children.map((row) => new TableRow({
              children: row.children.map((cell) => new TableCell({
                children: [new Paragraph({ children: runs(cell.children) })],
              })),
            })),
          })]
        case 'thematicBreak':
          return [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D5DDD5' } },
          })]
        case 'html':
          return [new Paragraph({ children: [new TextRun({ text: node.value })] })]
        default:
          return 'value' in node && typeof node.value === 'string'
            ? [new Paragraph({ children: [new TextRun({ text: node.value })] })]
            : []
      }
    })

  let root: Root
  try {
    root = toMdAst(markdown, { sources: undefined, disableLink: false })
  } catch {
    root = {
      type: 'root',
      children: markdown.split('\n').map((line) => ({
        type: 'paragraph',
        children: [{ type: 'text', value: line }],
      })),
    } as Root
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 22 } },
      },
    },
    numbering: {
      config: [{
        reference: 'chatbox-ordered',
        levels: [
          { level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START },
          { level: 1, format: 'lowerLetter', text: '%2.', alignment: AlignmentType.START },
          { level: 2, format: 'lowerRoman', text: '%3.', alignment: AlignmentType.START },
        ],
      }],
    },
    sections: [{ children: blocks(root.children) }],
  })
  return await Packer.toBlob(doc)
}
