import { BadRequestException } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export const MAX_IMPORT_ROWS = 200_000;
export const MAX_IMPORT_COLUMNS = 100;

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
  /**
   * Cells ("row:col", 0-based data row) that Excel stored as numbers with 16 or more digits.
   * Excel keeps only 15 significant digits, so such BO IDs may already be corrupted.
   */
  lossyNumericCells: Set<string>;
}

export async function parseRegisterFile(buf: Buffer, type: 'xlsx' | 'text'): Promise<ParsedSheet> {
  const sheet = type === 'xlsx' ? await parseXlsx(buf) : parseCsvText(buf);
  if (sheet.headers.length === 0) throw new BadRequestException('The file has no header row');
  if (sheet.headers.length > MAX_IMPORT_COLUMNS) throw new BadRequestException(`The file has more than ${MAX_IMPORT_COLUMNS} columns`);
  const seen = new Set<string>();
  for (const h of sheet.headers) {
    if (!h) throw new BadRequestException('Every column needs a header name');
    if (seen.has(h)) throw new BadRequestException(`Duplicate column header "${h}"`);
    seen.add(h);
  }
  if (sheet.rows.length === 0) throw new BadRequestException('The file has a header row but no data rows');
  if (sheet.rows.length > MAX_IMPORT_ROWS) throw new BadRequestException(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString()} rows`);
  return sheet;
}

function parseCsvText(buf: Buffer): ParsedSheet {
  let records: string[][];
  try {
    records = parseCsv(buf, { bom: true, relax_column_count: true, skip_empty_lines: true, trim: true }) as string[][];
  } catch (e) {
    throw new BadRequestException(`Could not read the CSV file: ${e instanceof Error ? e.message.split('\n')[0] : 'invalid format'}`);
  }
  const [headerRow = [], ...rows] = records;
  return {
    headers: headerRow.map((h) => String(h).trim()),
    rows: rows.filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => r.map((c) => String(c ?? '').trim())),
    lossyNumericCells: new Set(),
  };
}

async function parseXlsx(buf: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('Could not read the Excel file. Save it as .xlsx and try again.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new BadRequestException('The workbook has no worksheets');

  const headerRow = ws.getRow(1);
  const width = Math.min(headerRow.cellCount, MAX_IMPORT_COLUMNS + 1);
  const headers: string[] = [];
  for (let c = 1; c <= width; c++) headers.push(cellText(headerRow.getCell(c).value).trim());
  while (headers.length && headers[headers.length - 1] === '') headers.pop();

  const rows: string[][] = [];
  const lossyNumericCells = new Set<string>();
  const last = Math.min(ws.rowCount, MAX_IMPORT_ROWS + 2);
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    const values: string[] = [];
    for (let c = 1; c <= headers.length; c++) {
      const v = row.getCell(c).value;
      if (typeof v === 'number' && Math.abs(v) >= 1e15) lossyNumericCells.add(`${rows.length}:${c - 1}`);
      values.push(cellText(v).trim());
    }
    if (values.some((v) => v !== '')) rows.push(values);
  }
  return { headers, rows, lossyNumericCells };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? BigInt(Math.round(v)).toString() : String(v);
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text);
  }
  return '';
}
