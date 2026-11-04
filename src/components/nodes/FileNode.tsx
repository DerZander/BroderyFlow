import { LocalizedError, msg, renderText, t, useLanguage } from '../../lib/i18n';
import { useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { FileInput, Play } from 'lucide-react';
import NodeSettings from './NodeSettings';
import { parseImportedFile, type ImportedFile } from '../../lib/files';
import type { CanvasNode } from '../../lib/types';

export default function FileNode({ id, data, selected }: NodeProps<CanvasNode>) {
  useLanguage();
  const [loading, setLoading] = useState(false);
  const readFile = async (file: File) => {
    setLoading(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (extension !== 'json' && extension !== 'csv') {
        throw new LocalizedError('Bitte eine JSON- oder CSV-Datei auswählen.');
      }
      const imported: ImportedFile = { name: file.name, format: extension, content: await file.text() };
      parseImportedFile(imported);
      data.onChange(id, { file: imported, status: 'changed', error: null, result: null });
    } catch (error) {
      data.onChange(id, {
        error: msg('Datei konnte nicht geladen werden: {0}', error instanceof LocalizedError
          ? error.localizedMessage : error instanceof Error ? error.message : String(error)),
        status: 'error',
      });
    } finally {
      setLoading(false);
    }
  };
  const status = {
    ready: t('Bereit'), changed: t('Geändert'), running: t('Läuft'), success: t('Erfolgreich'), error: t('Fehlgeschlagen'),
  }[data.status];

  return (
    <article className={`code-node file-node ${selected ? 'selected' : ''} status-${data.status}`}>
      <header className="node-header">
        <span className="node-mark"><FileInput size={14} /></span>
        <span className="node-title node-title-display">{data.title || t('Datei')}</span>
        <NodeSettings id={id} data={data} />
      </header>
      <div className="file-entries nodrag">
        <label className="file-picker">
          {t('JSON- oder CSV-Datei auswählen')}
          <input
            className="visually-hidden"
            type="file"
            accept=".json,.csv,application/json,text/csv"
            disabled={loading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void readFile(file);
            }}
          />
        </label>
        <p className="file-name">{loading ? t('Datei wird gelesen…') : data.file?.name || t('Noch keine Datei geladen')}</p>
        <p className="value-help">{t('CSV: erste Zeile als Spaltennamen, Werte bleiben Text. Trennzeichen werden automatisch erkannt.')}</p>
      </div>
      {data.outputs.map((port) => (
        <div className="output-port" key={port.name}>
          <span>{port.name}</span><span className="port-type">{port.type}</span>
          <Handle id={`output:${port.name}`} type="source" position={Position.Right} />
        </div>
      ))}
      {data.error && <div className="node-error">{renderText(data.error)}</div>}
      <div className="node-footer">
        <span>{data.file?.format.toUpperCase() || 'JSON / CSV'}</span>
        <span className={`node-status ${data.status}`} role="status">{status}</span>
        <button className="node-run-button nodrag nopan" disabled={loading}
          aria-label={t('Verbundene Nodes ab {0} ausführen', data.title)}
          onClick={() => data.onRun(id)}><Play size={12} fill="currentColor" /></button>
      </div>
    </article>
  );
}
