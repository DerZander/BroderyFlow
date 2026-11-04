import { LocalizedError, t } from './i18n';
import Papa from 'papaparse';

export interface ImportedFile {
  name: string;
  format: 'json' | 'csv';
  content: string;
}

export function parseImportedFile(file: ImportedFile | undefined): unknown {
  if (!file) throw new LocalizedError('Bitte zuerst eine JSON- oder CSV-Datei auswählen.');
  const content = file.content.replace(/^\uFEFF/, '');
  if (file.format === 'json') return JSON.parse(content) as unknown;
  const delimiter = Papa.parse<string[]>(content, { preview: 1 }).meta.delimiter;
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    delimiter: delimiter || ',',
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length) {
    throw new Error(parsed.errors.map((error) =>
      `${error.row === undefined ? 'CSV' : t('Datenzeile {0}', error.row + 1)}: ${error.message}`,
    ).join('\n'));
  }
  if (!parsed.meta.fields?.length || parsed.meta.fields.some((field) => !field)) {
    throw new LocalizedError('Die CSV-Datei benötigt eine Kopfzeile mit benannten Spalten.');
  }
  if (parsed.meta.renamedHeaders && Object.keys(parsed.meta.renamedHeaders).length) {
    throw new LocalizedError('Die CSV-Kopfzeile enthält doppelte Spaltennamen.');
  }
  return parsed.data;
}
