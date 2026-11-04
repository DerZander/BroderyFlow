import { renderText, t, useLanguage } from './i18n';
import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { autocompletion, closeCompletion, startCompletion, type CompletionContext } from '@codemirror/autocomplete';
import { keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { Handle, NodeResizeControl, Position, useConnection, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, LoaderCircle, Play, X } from 'lucide-react';
import NodeSettings from './NodeSettings';
import { inferPorts, returnVariableChanges } from './ports';
import type { CanvasNode, NodeData } from './types';

export function inputDropIndex(element: Element, clientY: number): number {
  const rows = [...element.querySelectorAll('.input-port')];
  const index = rows.findIndex((row) => {
    const bounds = row.getBoundingClientRect();
    return clientY < bounds.top + bounds.height / 2;
  });
  return index < 0 ? rows.length : index;
}

function inputVariableCompletion(context: CompletionContext) {
  const match = context.matchBefore(/inputs\.[\w$]*/);
  if (!match || !context.explicit) return null;

  const input = match.text.match(/^inputs\.([\w$]+)$/);
  if (!input) return null;

  const name = input[1];
  return {
    from: match.from,
    to: match.to,
    filter: false,
    options: [{
      label: t('{0} als Variable anlegen', name),
      detail: `const ${name} = inputs.${name}`,
      type: 'variable',
      apply: `const ${name} = inputs.${name};`,
    }],
  };
}

function returnVariableCompletion(context: CompletionContext) {
  if (!context.explicit) return null;
  const match = context.matchBefore(/[\w$]+/);
  if (!match) return null;
  const code = context.state.doc.toString();
  const addChanges = returnVariableChanges(code, context.pos);
  const onlyChanges = returnVariableChanges(code, context.pos, 'only');
  if (!onlyChanges) return null;
  return {
    from: match.from,
    filter: false,
    options: [{
      label: t('{0} zu return hinzufügen', match.text),
      detail: t('Vorhandene Ausgänge behalten'),
      boost: 99,
      type: 'variable',
      apply: (view: import('@codemirror/view').EditorView) => {
        if (addChanges) view.dispatch({ changes: addChanges, userEvent: 'input.complete' });
        closeCompletion(view);
      },
    }, {
      label: t('Nur {0} zurückgeben', match.text),
      detail: `return { ${match.text} }`,
      boost: 98,
      type: 'variable',
      apply: (view: import('@codemirror/view').EditorView) => {
        view.dispatch({ changes: onlyChanges, userEvent: 'input.complete' });
        closeCompletion(view);
      },
    }],
  };
}

export default function CodeNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const language = useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const connection = useConnection();
  const updateNodeInternals = useUpdateNodeInternals();
  const update = (patch: Partial<NodeData>) => data.onChange(id, patch);
  const status = {
    ready: <><span className="status-dot" /> {t('Bereit')}</>,
    changed: <><span className="status-dot" /> {t('Geändert')}</>,
    running: <><LoaderCircle className="spin" size={13} /> {t('Läuft')}</>,
    success: <><CircleCheck size={13} /> {t('Erfolgreich')}</>,
    error: <><CircleAlert size={13} /> {t('Fehlgeschlagen')}</>,
  }[data.status];

  useEffect(() => {
    updateNodeInternals(id);
  }, [collapsed, data.inputs, data.outputs, id, updateNodeInternals]);

  useEffect(() => {
    if (!connection.inProgress || connection.fromHandle.type !== 'source' || connection.fromNode.id === id || collapsed) {
      setInsertionIndex(null);
      return;
    }
    const move = (event: MouseEvent | TouchEvent) => {
      const pointer = 'touches' in event ? event.touches[0] : event;
      if (!pointer) return;
      const target = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest('.react-flow__node');
      setInsertionIndex(target?.getAttribute('data-id') === id &&
        !document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest('.react-flow__handle')
        ? inputDropIndex(target, pointer.clientY) : null);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('touchmove', move);
    };
  }, [collapsed, connection.inProgress, connection.fromNode?.id, connection.fromHandle?.type, id]);

  return (
    <article className={`code-node ${collapsed ? 'collapsed' : ''} ${selected ? 'selected' : ''} status-${data.status}`}>
      {selected && !collapsed && (
        <NodeResizeControl
          className="code-resize-grip"
          position="bottom-right"
          minWidth={370}
          minHeight={(collapsed ? 100 : 240) + (data.inputs.length + data.outputs.length) * 24}
        >
          <span className="code-resize-grip-lines" aria-hidden="true" />
        </NodeResizeControl>
      )}
      <header className="node-header">
        <span className="node-mark">{'{ }'}</span>
        <span className="node-title node-title-display" title={t('Zum Verschieben ziehen')}>{data.title || t('Node-Titel')}</span>
        <NodeSettings id={id} data={data} />
        <button className="icon-button nodrag" aria-label={collapsed ? t('Code anzeigen') : t('Code einklappen')} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
      </header>
      <div className="code-input-list">
      {insertionIndex !== null && <div className="input-insertion-marker" style={{ top: insertionIndex * 24 }} />}
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
      </div>
      {!collapsed && (
        <div className="code-node-body nowheel">
          <div className="node-code nodrag nowheel">
            <CodeMirror
              value={data.code}
              height="100%"
              extensions={[
                javascript(),
                EditorState.phrases.of(language === 'de' ? {
                  'Completions': 'Vorschläge',
                  'Go to line': 'Gehe zu Zeile',
                  'go': 'Los',
                  'Find': 'Suchen',
                  'Replace': 'Ersetzen',
                  'next': 'Weiter',
                  'previous': 'Zurück',
                  'all': 'Alle',
                  'match case': 'Groß-/Kleinschreibung',
                  'regexp': 'Regulärer Ausdruck',
                  'by word': 'Ganzes Wort',
                  'replace': 'Ersetzen',
                  'replace all': 'Alle ersetzen',
                  'close': 'Schließen',
                  'current match': 'Aktueller Treffer',
                  'on line': 'in Zeile',
                  'replaced match on line $': 'Treffer in Zeile $ ersetzt',
                  'replaced $ matches': '$ Treffer ersetzt',
                } : {}),
                javascriptLanguage.data.of({ autocomplete: inputVariableCompletion }),
                javascriptLanguage.data.of({ autocomplete: returnVariableCompletion }),
                autocompletion({ activateOnTyping: false }),
                keymap.of([{ key: 'Ctrl-Space', run: startCompletion }]),
              ]}
              basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
              onChange={(code) => {
                const ports = inferPorts(code, data.inputs);
                update({ code, ...(ports ?? {}) });
              }}
              aria-label={t('JavaScript-Code')}
            />
          </div>
          {(data.error || data.logs.length > 0) && (
            <section className="code-node-messages nodrag nowheel" aria-label={t('Debug- und Ergebnisausgaben')}>
          {data.error && <div className="node-error" title={renderText(data.error)}>{renderText(data.error)}</div>}
          {data.logs.length > 0 && (
            <div className="node-logs">
              {data.logs.map((log) => (
                <div className={`node-log ${log.kind}`} key={log.id}>
                  <div className="node-log-header">
                    <span className="node-log-heading">{log.kind === 'debug' ? 'DEBUG' : 'RESULT'}</span>
                    <button
                      className="node-log-delete nodrag nopan"
                      aria-label={t('{0}-Nachricht löschen', log.kind === 'debug' ? 'Debug' : t('Ergebnis'))}
                      title={t('Nachricht löschen')}
                      onClick={() => data.onRemoveLog(id, log.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="node-log-value">
                    {log.kind === 'debug' && <strong>{log.label}: </strong>}
                    <pre>{log.value}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}
            </section>
          )}
        </div>
      )}
      {data.outputs.map((port) => (
        <div className="output-port" key={`output-${port.name}`}>
          <span>{port.name}</span><span className="port-type">{port.type}</span>
          <Handle id={`output:${port.name}`} className="output-handle" type="source" position={Position.Right} />
        </div>
      ))}
      <div className="node-footer">
        <span>{data.inputs.length} {t('Eingänge ·')} {data.outputs.length} {t('Ausgänge')}</span>
        <span className={`node-status ${data.status}`} role="status">{status}</span>
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
