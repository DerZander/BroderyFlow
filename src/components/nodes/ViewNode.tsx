import { useEffect, useMemo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChartNoAxesCombined, Copy, Play, Trash2 } from 'lucide-react';
import NodeSettings from './NodeSettings';
import { LocalizedError, msg, renderText, t, useLanguage, type LocalizedText } from '../../lib/i18n';
import { chartColumns, chartPoints, defaultViewSettings, formatValue, tableData, type ViewSettings } from '../../lib/visualization';
import type { CanvasNode } from '../../lib/types';

const pageSize = 100;

function Chart({ points, kind }: { points: { label: string; value: number }[]; kind: 'bar' | 'line' }) {
  const low = Math.min(0, ...points.map((point) => point.value));
  const high = Math.max(0, ...points.map((point) => point.value));
  const scale = Math.max(Math.abs(low), Math.abs(high)) || 1;
  const bottom = low / scale;
  const top = high / scale;
  const range = top - bottom || 1;
  const y = (value: number) => 172 - ((value / scale - bottom) / range) * 148;
  const step = 320 / Math.max(points.length, 1);
  const x = (index: number) => 60 + step * (index + 0.5);
  const zero = y(0);
  return (
    <svg className="view-chart" viewBox="0 0 400 225" role="img" aria-label={t('Diagramm')}>
      <title>{t('Diagramm')}</title>
      <line x1="60" x2="380" y1={zero} y2={zero} className="chart-axis" />
      <text x="54" y="24" textAnchor="end">{high.toLocaleString(undefined, { maximumSignificantDigits: 4 })}</text>
      <text x="54" y="175" textAnchor="end">{low.toLocaleString(undefined, { maximumSignificantDigits: 4 })}</text>
      {kind === 'line' && <polyline
        fill="none" stroke="currentColor" strokeWidth="2"
        points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')}
      />}
      {points.map((point, index) => (
        <g key={index}>
          <title>{point.label}: {point.value}</title>
          {kind === 'bar'
            ? <rect x={x(index) - step * .35} y={Math.min(zero, y(point.value))}
              width={step * .7} height={Math.max(1, Math.abs(zero - y(point.value)))} fill="currentColor" />
            : <circle cx={x(index)} cy={y(point.value)} r="3" fill="currentColor" />}
          {(index % Math.max(1, Math.ceil(points.length / 8)) === 0) && (
            <text x={x(index)} y="193" textAnchor="end" transform={`rotate(-30 ${x(index)} 193)`}>
              {point.label.length > 14 ? `${point.label.slice(0, 13)}…` : point.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export default function ViewNode({ id, data, selected }: NodeProps<CanvasNode>) {
  useLanguage();
  const settings = data.view ?? defaultViewSettings;
  const hasData = data.result !== null && 'data' in data.result;
  const value = data.result?.data;
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [copyError, setCopyError] = useState<LocalizedText | null>(null);
  const prepared = useMemo<{
    columns: string[];
    rows: Record<string, unknown>[];
    json: string;
    error: LocalizedText | null;
  }>(() => {
    try {
      if (!hasData) return { columns: [], rows: [], json: '', error: null };
      return { ...tableData(value), json: formatValue(value, true), error: null };
    } catch (error) {
      return { columns: [], rows: [], json: '', error: error instanceof LocalizedError
        ? error.localizedMessage : String(error) };
    }
  }, [hasData, value]);
  useEffect(() => {
    setCopyState('idle');
    setCopyError(null);
  }, [prepared.json]);
  const copyJson = async () => {
    setCopyState('copying');
    setCopyError(null);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new LocalizedError('Kopieren ist hier nicht verfügbar. Verwende HTTPS oder localhost oder kopiere den markierten Text manuell.');
      }
      await navigator.clipboard.writeText(prepared.json);
      setCopyState('copied');
    } catch (error) {
      setCopyState('idle');
      setCopyError(msg('Kopieren fehlgeschlagen: {0}', error instanceof LocalizedError
        ? error.localizedMessage : error instanceof Error ? error.message : String(error)));
    }
  };
  const numeric = chartColumns(prepared.columns, prepared.rows);
  const yColumn = settings.y || numeric[0] || '';
  const xColumn = settings.x || prepared.columns.find((column) => !numeric.includes(column)) || '';
  let chartError: LocalizedText | null = null;
  let points: { label: string; value: number }[] = [];
  if (hasData && settings.mode === 'chart' && prepared.rows.length > 0 && !prepared.error) {
    try {
      points = chartPoints(prepared.rows, xColumn, yColumn);
    } catch (error) {
      chartError = error instanceof LocalizedError ? error.localizedMessage : String(error);
    }
  }
  const updateView = (patch: Partial<ViewSettings>) => data.onChange(id, { view: { ...settings, ...patch } });
  const status = {
    ready: t('Bereit'), changed: t('Geändert'), running: t('Läuft'), success: t('Erfolgreich'), error: t('Fehlgeschlagen'),
  }[data.status];
  const error = data.error || prepared.error || chartError;

  return (
    <article className={`code-node view-node ${selected ? 'selected' : ''} status-${data.status}`}>
      <header className="node-header">
        <span className="node-mark"><ChartNoAxesCombined size={14} /></span>
        <span className="node-title node-title-display" title={t('Zum Verschieben ziehen')}>{data.title}</span>
        <NodeSettings id={id} data={data} />
        <button className="icon-button nodrag nopan" type="button"
          aria-label={t('Node löschen')} title={t('Node löschen')}
          onClick={() => data.onDelete(id)}><Trash2 size={14} /></button>
      </header>
      <div className="input-port">
        <Handle id="input:data" type="target" position={Position.Left} />
        <span className="port-type">any</span><span>data</span>
      </div>
      <div className="view-settings nodrag">
        <label>{t('Ansicht')}
          <select aria-label={t('Ansicht')} value={settings.mode} onChange={(event) => {
            const mode = event.target.value;
            if (mode === 'table' || mode === 'json' || mode === 'chart') updateView({ mode });
          }}>
            <option value="table">{t('Tabelle')}</option>
            <option value="json">JSON</option>
            <option value="chart">{t('Diagramm')}</option>
          </select>
        </label>
        {settings.mode === 'chart' && <>
          <label>{t('Diagrammtyp')}
            <select aria-label={t('Diagrammtyp')} value={settings.chart} onChange={(event) => {
              const chart = event.target.value;
              if (chart === 'bar' || chart === 'line') updateView({ chart });
            }}>
              <option value="bar">{t('Balken')}</option><option value="line">{t('Linie')}</option>
            </select>
          </label>
          <label>{t('X-Achse')}
            <select aria-label={t('X-Achse')} value={settings.x} onChange={(event) => updateView({ x: event.target.value })}>
              <option value="">{t('Automatisch')}</option>
              {prepared.columns.map((column) => <option value={column} key={column}>{column}</option>)}
              {settings.x && !prepared.columns.includes(settings.x) && <option value={settings.x}>{settings.x}</option>}
            </select>
          </label>
          <label>{t('Y-Achse')}
            <select aria-label={t('Y-Achse')} value={settings.y} onChange={(event) => updateView({ y: event.target.value })}>
              <option value="">{t('Automatisch')}</option>
              {prepared.columns.map((column) => <option value={column} key={column}>{column}</option>)}
              {settings.y && !prepared.columns.includes(settings.y) && <option value={settings.y}>{settings.y}</option>}
            </select>
          </label>
        </>}
      </div>
      {error && <div className="node-error" role="alert">{renderText(error)}</div>}
      {copyError && settings.mode === 'json' && <div className="node-error" role="alert">{renderText(copyError)}</div>}
      {!hasData && <p className="view-hint">{t('Verbinde Daten mit dem Eingang und führe die Node aus.')}</p>}
      {hasData && !error && (
        <div className="view-content nodrag nowheel">
          {settings.mode === 'json' ? <>
            <div className="view-json-toolbar">
              <button className="toolbar-button" type="button" disabled={copyState === 'copying'}
                aria-label={t('Gesamtes JSON kopieren')} title={t('Gesamtes JSON kopieren')}
                onClick={() => void copyJson()}>
                <Copy size={12} /> {copyState === 'copied' ? t('Kopiert') : t('Kopieren')}
              </button>
              <span className="visually-hidden" role="status">{copyState === 'copied' ? t('Kopiert') : ''}</span>
            </div>
            <pre className="view-json nodrag nopan" tabIndex={0} aria-label={t('JSON-Inhalt')}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.stopPropagation()}>{prepared.json}</pre>
          </> : prepared.rows.length === 0
            ? <p className="view-hint">{t('Keine Zeilen vorhanden.')}</p>
            : settings.mode === 'chart' ? <Chart points={points.slice(0, pageSize)} kind={settings.chart} />
              : <table>
                <thead><tr>{prepared.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>{prepared.rows.slice(0, pageSize).map((row, index) => (
                  <tr key={index}>{prepared.columns.map((column) => <td key={column}>{formatValue(row[column])}</td>)}</tr>
                ))}</tbody>
              </table>}
        </div>
      )}
      {hasData && settings.mode !== 'json' && prepared.rows.length > pageSize &&
        <p className="view-hint">{t('Vorschau: erste {0} von {1} Zeilen.', pageSize, prepared.rows.length)}</p>}
      <div className="node-footer">
        <span>{hasData ? t('{0} Zeilen', prepared.rows.length) : t('Ansicht')}</span>
        <span className={`node-status ${data.status}`} role="status">{status}</span>
        <button className="node-run-button nodrag nopan" aria-label={t('Verbundene Nodes ausführen')}
          title={t('Verbundene Nodes ausführen')} onClick={() => data.onRun(id)}><Play size={12} fill="currentColor" /></button>
      </div>
    </article>
  );
}
