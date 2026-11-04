import { renderText, t, useLanguage } from '../../lib/i18n';
import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { CircleAlert, CircleCheck, LoaderCircle, Play } from 'lucide-react';
import NodeSettings from './NodeSettings';
import { inferPorts } from '../../lib/ports';
import type { CanvasNode, NodeData } from '../../lib/types';

export default function ConditionNode({ id, data, selected }: NodeProps<CanvasNode>) {
  useLanguage();
  const updateNodeInternals = useUpdateNodeInternals();
  const update = (patch: Partial<NodeData>) => data.onChange(id, patch);
  const status = {
    ready: <><span className="status-dot" /> {t('Bereit')}</>,
    changed: <><span className="status-dot" /> {t('Geändert')}</>,
    running: <LoaderCircle className="spin" size={13} />,
    success: <><CircleCheck size={13} /> {t('Erfolgreich')}</>,
    error: <><CircleAlert size={13} /> {t('Fehlgeschlagen')}</>,
  }[data.status];

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.inputs, id, updateNodeInternals]);

  return (
    <article className={`code-node condition-node ${selected ? 'selected' : ''} status-${data.status}`}>
      <header className="node-header">
        <span className="node-mark">IF</span>
        <span className="node-title node-title-display" title={t('Zum Verschieben ziehen')}>{data.title || t('Bedingung')}</span>
        <NodeSettings id={id} data={data} />
      </header>
      {data.inputs.map((port) => (
        <div className="input-port" key={`input-${port.name}`}>
          <Handle id={`input:${port.name}`} type="target" position={Position.Left} />
          <span className="port-type">{port.type}</span><span>{port.name}</span>
          {port.defaultValue && (
            <input
              className="input-value nodrag"
              aria-label={t('Wert für {0}', port.name)}
              value={port.defaultValue}
              onChange={(event) => update({
                inputs: data.inputs.map((item) => item.name === port.name ? { ...item, defaultValue: event.target.value } : item),
              })}
            />
          )}
        </div>
      ))}
      <div className="condition-editor nodrag">
        <label htmlFor={`condition-${id}`}>{t('Bedingung (JavaScript)')}</label>
        <input
          id={`condition-${id}`}
          className="condition-input nodrag"
          aria-label={t('JavaScript-Bedingung')}
          placeholder={t('inputs.wert > 10')}
          value={data.code}
          onChange={(event) => {
            const expression = event.target.value;
            const ports = inferPorts(`return { result: (${expression}) };`, data.inputs);
            update({ code: expression, ...(ports ? { inputs: ports.inputs } : {}) });
          }}
        />
      </div>
      {data.error && <div className="node-error" title={renderText(data.error)}>{renderText(data.error)}</div>}
      {data.outputs.map((port) => (
        <div className={`output-port condition-output ${port.name}`} key={`output-${port.name}`}>
          <span className={`condition-badge ${port.name}`}>{port.name === 'true' ? 'TRUE' : 'FALSE'}</span>
          <span className="port-type">boolean</span>
          <Handle id={`output:${port.name}`} className="output-handle" type="source" position={Position.Right} />
        </div>
      ))}
      <div className="node-footer">
        <span>{data.inputs.length} {t('Eingänge · 2 Ausgänge')}</span>
        <span className={`node-status ${data.status}`} role="status">
          {status}{data.status === 'running' && ` ${t('Läuft')}`}
        </span>
        <button
          className="node-run-button nodrag nopan"
          aria-label={t('Verbundene Nodes ab {0} ausführen', data.title || t('dieser Node'))}
          title={t('Verbundene Nodes ausführen')}
          onClick={() => data.onRun(id)}
        >
          <Play size={12} fill="currentColor" />
        </button>
      </div>
    </article>
  );
}
