import { LocalizedError } from './i18n';

export type ViewMode = 'table' | 'json' | 'chart';
export interface ViewSettings {
  mode: ViewMode;
  chart: 'bar' | 'line';
  x: string;
  y: string;
}

export const defaultViewSettings: ViewSettings = { mode: 'table', chart: 'bar', x: '', y: '' };

export function isViewSettings(value: unknown): value is ViewSettings {
  return typeof value === 'object' && value !== null &&
    'mode' in value && (value.mode === 'table' || value.mode === 'json' || value.mode === 'chart') &&
    'chart' in value && (value.chart === 'bar' || value.chart === 'line') &&
    'x' in value && typeof value.x === 'string' && 'y' in value && typeof value.y === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function tableData(value: unknown): { columns: string[]; rows: Record<string, unknown>[] } {
  const items = Array.isArray(value) ? value : [value];
  const rows = items.map((item) => isRecord(item) ? item : { value: item });
  return { columns: [...new Set(rows.flatMap((row) => Object.keys(row)))], rows };
}

export function formatValue(value: unknown, pretty = false): string {
  if (typeof value === 'string' && !pretty) return value;
  if (typeof value === 'bigint') return pretty ? JSON.stringify(`${value}n`) : `${value}n`;
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, (_, item: unknown) => typeof item === 'bigint' ? `${item}n` : item, pretty ? 2 : undefined) ?? String(value);
  } catch {
    throw new LocalizedError('Die Daten enthalten zyklische Referenzen und können nicht dargestellt werden.');
  }
}

function numericValue(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function chartColumns(columns: string[], rows: Record<string, unknown>[]): string[] {
  return columns.filter((column) => rows.length > 0 && rows.every((row) => numericValue(row[column]) !== null));
}

export function chartPoints(rows: Record<string, unknown>[], x: string, y: string): { label: string; value: number }[] {
  if (!y) throw new LocalizedError('Bitte eine numerische Spalte für die Y-Achse auswählen.');
  return rows.map((row, index) => {
    if (x && !Object.prototype.hasOwnProperty.call(row, x)) {
      throw new LocalizedError('Zeile {0}: Die Spalte „{1}“ fehlt.', index + 1, x);
    }
    const value = numericValue(row[y]);
    if (value === null) throw new LocalizedError('Zeile {0}: „{1}“ enthält keinen gültigen Zahlenwert.', index + 1, y);
    return { label: x ? formatValue(row[x]) : String(index + 1), value };
  });
}
