import ExcelJS from 'exceljs';
import { AlignmentType, Document, PageOrientation, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { fmtDate, fmtMoney, fmtNum } from '../shared/calc.ts';
import type { Col, ReportResult } from './reports.ts';

// One report result in, one file out. Every report uses these two functions.

interface Brand { name: string; brandColor: string; address?: string; phone?: string }
const isNum = (c: Col) => c.type === 'money' || c.type === 'num' || c.type === 'pct';
const INR = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';

/** Value as it should sit in an Excel cell (money in rupees, real dates, real numbers). */
function cell(c: Col, v: any) {
  if (v == null || v === '') return null;
  if (c.type === 'money') return typeof v === 'number' ? v / 100 : v;
  if (c.type === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`) : v;
  return v;
}
/** Value as text for Word. */
function text(c: Col | { type?: string }, v: any): string {
  if (v == null || v === '') return '';
  if (typeof v !== 'number') return c.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? fmtDate(String(v)) : String(v);
  if (c.type === 'money') return fmtMoney(v);
  if (c.type === 'pct') return `${fmtNum(v)}%`;
  return fmtNum(v);
}

export async function toXlsx(r: ReportResult, brand: Brand): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = brand.name;
  const ws = wb.addWorksheet(r.title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31));
  const fill = `FF${brand.brandColor.slice(1).toUpperCase()}`;

  ws.addRow([brand.name]).font = { bold: true, size: 14 };
  ws.addRow([r.title]).font = { bold: true, size: 12 };
  ws.addRow([r.subtitle]).font = { color: { argb: 'FF64748B' } };
  for (const s of r.summary ?? []) {
    const row = ws.addRow([s.label, s.type === 'money' && typeof s.value === 'number' ? s.value / 100 : s.value]);
    row.getCell(1).font = { color: { argb: 'FF64748B' } };
    row.getCell(2).font = { bold: true };
    if (s.type === 'money') row.getCell(2).numFmt = INR;
  }
  ws.addRow([]);

  const head = ws.addRow(r.columns.map((c) => c.label));
  head.eachCell((c, i) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    c.alignment = { horizontal: isNum(r.columns[i - 1]) ? 'right' : 'left', vertical: 'middle', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: head.number }];

  const put = (values: Record<string, any>, bold: boolean) => {
    const row = ws.addRow(r.columns.map((c) => cell(c, values[c.key])));
    row.eachCell({ includeEmpty: true }, (x, i) => {
      const c = r.columns[i - 1];
      if (c.type === 'money') x.numFmt = INR;
      if (c.type === 'date') x.numFmt = 'dd-mmm-yyyy';
      if (c.type === 'pct') x.numFmt = '0.0"%"';
      if (bold) x.font = { bold: true };
    });
    return row;
  };
  for (const row of r.rows) put(row, !!row._bold);
  if (r.totals) put(r.totals, true).eachCell({ includeEmpty: true }, (x) => (x.border = { top: { style: 'thin' }, bottom: { style: 'double' } }));

  r.columns.forEach((c, i) => {
    const longest = Math.max(c.label.length, ...r.rows.slice(0, 500).map((row) => text(c, row[c.key]).length));
    ws.getColumn(i + 1).width = Math.min(Math.max(longest + 3, c.type === 'money' ? 14 : 8), 48);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Word tables get slow to build and to open beyond a couple of thousand rows; Excel carries the full list. */
const DOCX_MAX_ROWS = 2000;
export async function toDocx(full: ReportResult, brand: Brand): Promise<Buffer> {
  const cut = full.rows.length > DOCX_MAX_ROWS;
  const r = cut ? { ...full, rows: full.rows.slice(0, DOCX_MAX_ROWS) } : full;
  const wide = r.columns.length > 6;
  // A4 in twentieths of a point, minus 0.5" margins on both sides.
  const pageWidth = (wide ? 16838 : 11906) - 1440;
  const weights = r.columns.map((c) => (isNum(c) || c.type === 'date' ? 2 : 3));
  const unit = pageWidth / weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.floor(w * unit));
  const size = r.columns.length > 9 ? 14 : 17; // half-points
  const head = brand.brandColor.slice(1).toUpperCase();

  const tc = (value: string, i: number, o: { bold?: boolean; fill?: string; color?: string } = {}) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      children: [new Paragraph({ alignment: isNum(r.columns[i]) ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: value, bold: o.bold, color: o.color, size, font: 'Calibri' })] })],
    });
  const rows = [
    new TableRow({ tableHeader: true, children: r.columns.map((c, i) => tc(c.label, i, { bold: true, fill: head, color: 'FFFFFF' })) }),
    ...r.rows.map((row) => new TableRow({ children: r.columns.map((c, i) => tc(text(c, row[c.key]), i, { bold: !!row._bold })) })),
    ...(r.totals ? [new TableRow({ children: r.columns.map((c, i) => tc(text(c, r.totals![c.key]), i, { bold: true, fill: 'F1F5F9' })) })] : []),
  ];
  const line = (t: string, o: { bold?: boolean; size?: number; color?: string } = {}) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: t, font: 'Calibri', ...o })] });

  const doc = new Document({
    creator: brand.name,
    title: r.title,
    sections: [{
      properties: { page: { size: { orientation: wide ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: [
        line(brand.name, { bold: true, size: 32 }),
        line(r.title, { bold: true, size: 26, color: head }),
        line(r.subtitle, { size: 18, color: '64748B' }),
        ...(cut ? [line(`Showing the first ${DOCX_MAX_ROWS.toLocaleString('en-IN')} of ${full.rows.length.toLocaleString('en-IN')} rows. The totals cover every row. Use the Excel file for the full list.`, { size: 18, bold: true })] : []),
        ...(r.summary ?? []).map((s) => line(`${s.label}: ${text(s, s.value)}`, { size: 20 })),
        new Paragraph({ spacing: { after: 120 }, children: [] }),
        new Table({ width: { size: pageWidth, type: WidthType.DXA }, columnWidths: widths, rows }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
