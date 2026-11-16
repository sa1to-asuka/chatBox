import { parseCsv } from './csv.js'
import { sanitizeSheetName } from './protocol.js'

const MAX_CELLS = 20_000

const numeric = (value: string): number | string => {
  const trimmed = value.trim()
  return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(trimmed) ? Number(trimmed) : value
}

export const buildXlsxBlob = async (
  csv: string,
  sheet?: string
): Promise<Blob> => {
  const rows = parseCsv(csv)
  if (rows.length === 0) {throw new Error('表格内容为空')}
  if (rows.reduce((sum, row) => sum + row.length, 0) > MAX_CELLS) {
    throw new Error('表格内容过大，请缩小范围后重试')
  }
  const width = Math.max(...rows.map((row) => row.length))
  const columns = Array.from({ length: width }, (_, index) => {
    const longest = Math.max(...rows.slice(0, 300).map((row) => (row[index] ?? '').length))
    return { width: Math.max(10, Math.min(42, longest + 2)) }
  })
  const data = rows.map((row, rowIndex) => Array.from({ length: width }, (_, index) => {
    const value = row[index] ?? ''
    if (rowIndex === 0) {
      return { value, fontWeight: 'bold' as const, backgroundColor: '#EEF3EC' }
    }
    return numeric(value)
  }))
  const { default: writeExcelFile } = await import('write-excel-file/browser')
  const result = writeExcelFile(data, {
    sheet: sanitizeSheetName(sheet),
    columns,
    stickyRowsCount: 1,
  })
  return await result.toBlob()
}
