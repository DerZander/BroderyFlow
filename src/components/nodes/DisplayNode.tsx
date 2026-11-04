import { renderText, t, useLanguage } from '../../lib/i18n';
import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { CircleAlert, CircleCheck, Eraser, LoaderCircle, Play, Trash2, X } from 'lucide-react';
import type { CanvasNode } from '../../lib/types';

export default function DisplayNode({ id, data, type, selected }: NodeProps<CanvasNode>) {
  useLanguage();
  const updateNodeInternals = useUpdateNodeInternals();
  const debug = type === 'debug';
  const status = {
    ready: <><span className="status-dot" /> {t('Bereit')}</>,
    changed: <><span className="status-dot" /> {t('Geändert')}</>,
    running: <><LoaderCircle className="spin" size={13} /> {t('Läuft')}</>,
    success: <><CircleCheck size={13} /> {t('Erfolgreich')}</>,
    error: <><CircleAlert size={13} /> {t('Fehlgeschlagen')}</>,
  }[data.status];

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.inputs, id, updateNodeInternals]);

  return (
    <article className={`code-node display-node display-${type} ${selected ? 'selected' : ''} status-${data.status}`}>
      <header className="node-header">
        <span className="node-mark">{debug ? 'DBG' : 'OUT'}</span>
        <span className="node-title node-title-display" title={t('Zum Verschieben ziehen')}>{debug ? 'DEBUG' : 'SHOW'}</span>
        <button className="icon-button nodrag nopan" aria-label={t('Node leeren')} title={t('Leeren')}
          onClick={() => data.onClear(id)}><Eraser size={14} /></button>
        <button className="icon-button nodrag nopan" aria-label={t('Node löschen')} title={t('Node löschen')}
          onClick={() => data.onDelete(id)}><Trash2 size={14} /></button>
      </header>
      {data.inputs.map((port) => (
        <div className="input-port" key={port.name}>
          <Handle id={`input:${port.name}`} type="target" position={Position.Left} />
          <span className="port-type">{port.type}</span><span>{port.name}</span>
        </div>
      ))}
      {data.error && <div className="node-error">{renderText(data.error)}</div>}
      {data.logs.length > 0 && (
        <div className="node-logs">
          {data.logs.map((log) => (
            <div className={`node-log ${log.kind}`} key={log.id}>
              <div className="node-log-header">
                <span className="node-log-heading">{debug ? 'DEBUG' : 'RESULT'}</span>
                <button className="node-log-delete nodrag nopan" aria-label={t('Nachricht löschen')}
                  onClick={() => data.onRemoveLog(id, log.id)}><X size={12} /></button>
              </div>
              <div className="node-log-value">
                {debug && <strong>{log.label}: </strong>}
                <pre>{log.value}</pre>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="node-footer">
        <span>{data.inputs.length} {t('Eingänge')}</span>
        <span className={`node-status ${data.status}`} role="status">{status}</span>
        <button className="node-run-button nodrag nopan" aria-label={t('Verbundene Nodes ausführen')} title={t('Verbundene Nodes ausführen')}
          onClick={() => data.onRun(id)}><Play size={12} fill="currentColor" /></button>
      </div>
    </article>
  );
}
