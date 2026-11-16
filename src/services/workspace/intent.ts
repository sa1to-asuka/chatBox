import type { WorkspaceOutputFormat } from './api.js'

const FORMATS: { format: WorkspaceOutputFormat; pattern: RegExp }[] = [
  { format: 'pptx', pattern: /pptx?|幻灯片|演示文稿|演示/i },
  { format: 'xlsx', pattern: /xlsx?|excel|表格|数据表/i },
  { format: 'pdf', pattern: /pdf/i },
  { format: 'docx', pattern: /docx?|word|文档|报告|文稿/i },
]

const detectFormat = (value: string): WorkspaceOutputFormat | null =>
  FORMATS.find((item) => item.pattern.test(value))?.format ?? null

// 目标格式通常出现在动词之后：“把 PDF 转成 Word”应识别 Word，而不是源文件 PDF。
const VERB = /(生成|整理|转换|转成|做成|制作|导出|总结成|改写|翻译成|输出为|做一个|做个|做|弄成|弄个|搞成)/

/**
 * 判断一条带附件的中文指令是否要求产出文件；返回目标格式。
 * 没有“生成/整理/转成…”等动词时不触发，避免把普通问答误判成文件任务。
 */
export const detectFileTaskFormat = (text: string): WorkspaceOutputFormat | null => {
  const value = text.trim()
  const match = VERB.exec(value)
  if (!match) {return null}
  const after = value.slice(match.index + match[0].length, match.index + match[0].length + 30)
  return detectFormat(after) ?? detectFormat(value)
}

export const isWorkspaceSource = (name: string): boolean =>
  /\.(pdf|docx|pptx|xlsx|csv|txt|md|markdown)$/i.test(name)
