import { renderText, t, useLanguage } from './i18n';
import { useEffect, useState } from 'react';
import { Handle, Position, useEdges, useNodes, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { ChevronRight, CircleAlert, CircleCheck, Link2, LoaderCircle, Pencil, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import NodeSettings from './NodeSettings';
import { createValueNodeData, valuesObjectPort, type CanvasNode, type ConstantValue, type NodeData } from './types';

export default function ValueNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const language = useLanguage();
  const nodes = useNodes<CanvasNode>();
  const edges = useEdges();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const updateNodeInternals = useUpdateNodeInternals();
  const objectOutput = valuesObjectPort(data.values);
  const groups = new Map<string, { input?: string; entries: { item: ConstantValue; index: number }[] }>();
  data.inputs.forEach((port) => groups.set(`input:${port.name}`, { input: port.name, entries: [] }));
  data.values.forEach((item, index) => {
    const key = item.source ? `input:${item.source.input}` : 'local';
    let group = groups.get(key);
    if (!group) {
      group = { input: item.source?.input, entries: [] };
      groups.set(key, group);
    }
    group.entries.push({ item, index });
  });
  const update = (patch: Partial<NodeData>) => data.onChange(id, patch);
  const updateValues = (values: ConstantValue[]) => {
    const updated = createValueNodeData(values, data.title, data.inputs);
    update({ values, outputs: updated.outputs, status: 'changed', result: null, error: null });
  };
  const status = {
    ready: <><span className="status-dot" /> {t('Bereit')}</>,
    changed: <><span className="status-dot" /> {t('Geändert')}</>,
    running: <LoaderCircle className="spin" size={13} />,
    success: <><CircleCheck size={13} /> {t('Erfolgreich')}</>,
    error: <><CircleAlert size={13} /> {t('Fehlgeschlagen')}</>,
  }[data.status];

  useEffect(() => {
    updateNodeInternals(id);
  }, [data.inputs, data.outputs, expanded, id, updateNodeInternals]);

  return (
    <article className={`code-node value-node ${selected ? 'selected' : ''} status-${data.status}`}>
      <header className="node-header">
        <span className="node-mark">123</span>
        <span className="node-title node-title-display" title={t('Zum Verschieben ziehen')}>{data.title || t('Werte')}</span>
        <NodeSettings id={id} data={data} />
      </header>
      <div className="value-entries nodrag">
        {[...groups].map(([key, group]) => {
          const connection = group.input !== undefined ? edges.find((edge) =>
            edge.target === id && edge.targetHandle === `input:${group.input}`,
          ) : undefined;
          const sourceNode = connection && nodes.find((node) => node.id === connection.source);
          const sourceOutput = connection?.sourceHandle?.replace(/^output:/, '') ?? group.input;
          const heading = group.input !== undefined
            ? `${sourceNode?.data.title || sourceNode?.id || t('Eingang')} → ${sourceOutput}`
            : t('Lokale Konstanten');
          return (
          <details className="value-group" key={key} open={expanded[key] ?? true}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setExpanded((previous) => (previous[key] ?? true) === open ? previous : { ...previous, [key]: open });
            }}>
            <summary className="value-group-heading"
              title={group.input !== undefined ? `${heading}\n${t('Eingang')}: ${group.input}` : heading}>
              {group.input !== undefined && <Handle id={`input:${group.input}`}
                className="value-group-input" type="target" position={Position.Left}
                onClick={(event) => event.stopPropagation()} />}
              <ChevronRight className="value-group-chevron" size={12} aria-hidden="true" />
              {group.input !== undefined ? <Link2 size={12} aria-hidden="true" /> : <Pencil size={12} aria-hidden="true" />}
              <span className="value-group-title">{heading}</span>
              <span className="value-group-count">{group.entries.length}</span>
              {!(expanded[key] ?? true) && group.entries.map(({ item }) => {
                const output = data.outputs.find((port) => port.name === item.name.trim());
                return output && <Handle key={output.name} id={`output:${output.name}`}
                  className="output-handle value-collapsed-handle" type="source" position={Position.Right}
                  isConnectable={false} />;
              })}
            </summary>
            <div className="value-group-content">
        {group.entries.map(({ item, index }) => {
          const output = data.outputs.find((port) => port.name === item.name.trim());
          return (
          <div className="value-item" key={index}>
          <div className="value-entry">
            <input
              className="value-name nodrag"
              aria-label={t('Name der Konstante {0}', index + 1)}
              placeholder="Name"
              value={item.name}
              onChange={(event) => updateValues(data.values.map((entry, itemIndex) =>
                itemIndex === index ? { ...entry, name: event.target.value } : entry,
              ))}
            />
            <input
              className="value-input nodrag"
              aria-label={t('Wert der Konstante {0}', item.name || index + 1)}
              placeholder={t('Wert')}
              value={item.value}
              onChange={(event) => updateValues(data.values.map((entry, itemIndex) =>
                itemIndex === index ? { ...entry, value: event.target.value, ...(entry.source ? { override: true } : {}) } : entry,
              ))}
            />
            {item.source && <button className={`icon-button compact nodrag${item.override ? ' value-override-active' : ''}`} disabled={!item.override}
              aria-label={t('Eingangswert wiederherstellen')}
              title={item.override ? `${t('Manuell überschrieben')} — ${t('Eingangswert wiederherstellen')}` : t('Eingangswert wiederherstellen')}
              onClick={() => updateValues(data.values.map((entry, itemIndex) =>
                itemIndex === index ? { ...entry, override: false } : entry,
              ))}><RotateCcw size={12} /></button>}
            <button
              className="icon-button compact nodrag"
              aria-label={t('Konstante {0} löschen', item.name || index + 1)}
              onClick={() => updateValues(data.values.filter((_, itemIndex) => itemIndex !== index))}
            >
              <Trash2 size={12} />
            </button>
            {output && (
              <div className="value-output" title={t('Ausgang {0}: {1}', item.name, output.type)}>
                <span className="value-output-name">{item.name}</span>
                <span className="value-output-type">{output.type}</span>
                {(expanded[key] ?? true) && <Handle
                  id={`output:${output.name}`}
                  className="output-handle"
                  type="source"
                  position={Position.Right}
                />}
              </div>
            )}
          </div>
          </div>
          );
        })}
            </div>
          </details>
          );
        })}
        <button
          className="text-button add-value-button nodrag"
          onClick={() => {
            const names = new Set(data.values.map((item) => item.name.trim()));
            let suffix = data.values.length ? data.values.length + 1 : 1;
            const prefix = language === 'en' ? 'value' : 'wert';
            let name = suffix === 1 ? prefix : `${prefix}${suffix}`;
            while (names.has(name)) name = `${prefix}${++suffix}`;
            updateValues([...data.values, { name, value: '' }]);
          }}
        >
          <Plus size={12} /> {t('Konstante hinzufügen')}
        </button>
        <p className="value-help">{t('Zahlen und true/false werden erkannt, alles andere ist Text.')}</p>
        <p className="value-help">{t('Ziehe einen Ausgang auf diese Node. Eingangswerte werden bei jeder Ausführung aktualisiert; bearbeitete Werte überschreiben den Eingang.')}</p>
      </div>
      <div className="output-port" title={t('Alle Werte als Objekt')}>
        <span>{objectOutput.name}</span><span className="port-type">object</span>
        <Handle id={`output:${objectOutput.name}`} className="output-handle" type="source" position={Position.Right} />
      </div>
      {data.error && <div className="node-error" title={renderText(data.error)}>{renderText(data.error)}</div>}
      <div className="node-footer">
        <span>{data.outputs.length} {t('Ausgänge')}</span>
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
