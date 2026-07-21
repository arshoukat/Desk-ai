import type { ExportFormat, ExportPayload, TableExportPayload, DocxExportPayload } from '../types/export'

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function isTablePayload(p: ExportPayload): p is TableExportPayload {
  return p.format === 'csv' || p.format === 'xlsx'
}

function isDocxPayload(p: ExportPayload): p is DocxExportPayload {
  return p.format === 'docx'
}

export function exportToCsv(payload: TableExportPayload): Blob {
  const lines = [
    payload.columns.map(escapeCsvCell).join(','),
    ...payload.rows.map((row) => row.map(escapeCsvCell).join(',')),
  ]
  const bom = '\uFEFF'
  return new Blob([bom + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
}

export async function exportToXlsx(payload: TableExportPayload): Promise<Blob> {
  const XLSX = await import('xlsx')
  const data = [payload.columns, ...payload.rows]
  const sheet = XLSX.utils.aoa_to_sheet(data)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
  const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export async function exportToDocx(payload: DocxExportPayload): Promise<Blob> {
  const docx = await import('docx')
  const children = [
    new docx.Paragraph({
      text: payload.title,
      heading: docx.HeadingLevel.HEADING_1,
    }),
    ...payload.sections.flatMap((section) => [
      new docx.Paragraph({
        text: section.heading,
        heading: docx.HeadingLevel.HEADING_2,
      }),
      new docx.Paragraph({ text: section.body }),
    ]),
  ]

  const doc = new docx.Document({ sections: [{ children }] })
  return docx.Packer.toBlob(doc)
}

export async function buildFile(payload: ExportPayload): Promise<Blob> {
  if (isTablePayload(payload)) {
    if (payload.format === 'csv') return exportToCsv(payload)
    return exportToXlsx(payload)
  }
  if (isDocxPayload(payload)) {
    return exportToDocx(payload)
  }
  throw new Error('Unsupported export format')
}

export function downloadBlob(blob: Blob, filename: string): void {
  let ext = '.docx'
  if (payloadExt(blob) === 'csv') ext = '.csv'
  if (payloadExt(blob) === 'xlsx') ext = '.xlsx'

  const base = filename.replace(/\.(csv|xlsx|docx)$/i, '')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${base}${ext}`
  a.click()
  URL.revokeObjectURL(url)
}

function payloadExt(blob: Blob): ExportFormat {
  if (blob.type.includes('csv')) return 'csv'
  if (blob.type.includes('spreadsheet')) return 'xlsx'
  return 'docx'
}

export function formatLabel(format: ExportFormat): string {
  switch (format) {
    case 'csv':
      return 'CSV'
    case 'xlsx':
      return 'Excel (.xlsx)'
    case 'docx':
      return 'Word (.docx)'
  }
}
