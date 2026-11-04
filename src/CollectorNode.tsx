import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Braces, Play, Trash2 } from 'lucide-react';
import NodeSettings from './NodeSettings';
import { renderText, t, useLanguage } from './i18n';
import type { CanvasNode } from './types';

export default function CollectorNode({ id, data, selected }: NodeProps<CanvasNode>) {
  useLanguage();
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [data.inputs, id, updateNodeInternals]);
  const status = {
    ready: t('Bereit'), changed: t('Geändert'), running: t('Läuft'), success: t('Erfolgreich'), error: t('Fehlgeschlagen'),
  }[data.status];

  return (
    <article className={`code-node collector-node ${selected ? 'selected' : ''} status-${data.status}`}>
      <header className="node-header">
        <span className="node-mark"><Braces size={14} /></span>
        <span className="node-title node-title-display" title={t('Zum Verschieben ziehen')}>{data.title}</span>
        <NodeSettings id={id} data={data} />
        <button className="icon-button nodrag nopan" type="button"
          aria-label={t('Node löschen')} title={t('Node löschen')}
          onClick={() => data.onDelete(id)}><Trash2 size={14} /></button>
      </header>
      {data.inputs.map((port) => (
        <div className="input-port" key={port.name}>
          <Handle id={`input:${port.name}`} type="target" position={Position.Left} />
          <span className="port-type">{port.type}</span><span>{port.name}</span>
        </div>
      ))}
      <p className="view-hint">{t('Ziehe Ausgänge auf diese Node. Jeder Eingang wird zu einem Schlüssel im Objekt data.')}</p>
      <div className="output-port">
        <span>data</span><span className="port-type">object</span>
        <Handle id="output:data" type="source" position={Position.Right} />
      </div>
      {data.error && <div className="node-error" role="alert">{renderText(data.error)}</div>}
      <div className="node-footer">
        <span>{data.inputs.length} {t('Eingänge')}</span>
        <span className={`node-status ${data.status}`} role="status">{status}</span>
        <button className="node-run-button nodrag nopan" aria-label={t('Verbundene Nodes ausführen')}
          title={t('Verbundene Nodes ausführen')} onClick={() => data.onRun(id)}><Play size={12} fill="currentColor" /></button>
      </div>
    </article>
  );
}
