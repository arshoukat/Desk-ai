export type ExportFormat = 'csv' | 'xlsx' | 'docx'

export interface TableExportPayload {
  format: 'csv' | 'xlsx'
  filename: string
  columns: string[]
  rows: string[][]
}

export interface DocxExportPayload {
  format: 'docx'
  filename: string
  title: string
  sections: { heading: string; body: string }[]
}

export type ExportPayload = TableExportPayload | DocxExportPayload
