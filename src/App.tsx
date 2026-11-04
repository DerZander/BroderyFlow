import { LocalizedError, msg, renderText, setLanguage, t, useLanguage, type LocalizedMessage, type LocalizedText } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type NodeTypes,
  type OnConnectEnd,
} from '@xyflow/react';
import { isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { ChevronLeft, ChevronRight, FileJson2, FolderOpen, Moon, Play, Plus, Save, Settings, Sun, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react';
import CodeNode, { inputDropIndex } from './CodeNode';
import ConditionNode from './ConditionNode';
import DisplayNode from './DisplayNode';
import ValueNode from './ValueNode';
import FileNode from './FileNode';
import ViewNode from './ViewNode';
import CollectorNode from './CollectorNode';
import { collectInputs } from './collector';
import { isViewSettings } from './visualization';
import { parseImportedFile } from './files';
import { resolveValues, valueSnapshots } from './valueSnapshot';
import { addInputVariable, inferPorts, isPortType } from './ports';
import { executeCode, type ExecutionLog } from './runner';
import {
  createNodeData,
  createDisplayNodeData,
  createConditionNodeData,
  createValueNodeData,
  createFileNodeData,
  createViewNodeData,
  createCollectorNodeData,
  isValueType,
  normalizeCode,
  type CanvasEdge,
  type CanvasNode,
  type ConstantValue,
  type NodeData,
  type NodeLog,
  type Port,
  type ProjectFile,
  type ValueType,
} from './types';

const nodeTypes: NodeTypes = { code: CodeNode, value: ValueNode, condition: ConditionNode, show: DisplayNode, debug: DisplayNode, file: FileNode, view: ViewNode, collector: CollectorNode };
const nodeId = () => `node-${crypto.randomUUID()}`;
function defaultNodeTitle(type: 'code' | 'value' | 'condition' | 'file' | 'view' | 'collector', nodes: CanvasNode[]): string {
  const prefix = type === 'value' ? 'values' : type;
  const names = new Set(nodes.map((node) => node.data.title));
  let number = nodes.length + 1;
  while (names.has(`node-${prefix}-${number}`)) number++;
  return `node-${prefix}-${number}`;
}
const nodeColors = [
  { name: 'Standard', value: '' },
  { name: 'Blau', value: '#526bc9' },
  { name: 'Grün', value: '#328261' },
  { name: 'Gelb', value: '#a77b23' },
  { name: 'Rot', value: '#ad4d57' },
  { name: 'Lila', value: '#8559b5' },
];
type Theme = 'light' | 'dark';
type WorkflowTab = {
  id: string;
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

type ConnectionLike = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

function initialProject(): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const id = 'node-1';
  return {
    nodes: [{ id, type: 'code', position: { x: 420, y: 150 }, data: createNodeData({ title: 'node-code-1' }) }],
    edges: [],
  };
}

function parseDefault(value: string | undefined, type: ValueType): unknown {
  if (value === undefined || value === '') throw new LocalizedError('Kein Wert vorhanden und kein Standardwert gesetzt.');
  switch (type) {
    case 'any':
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    case 'number': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new LocalizedError('„{0}“ ist keine gültige Zahl.', value);
      return parsed;
    }
    case 'boolean':
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new LocalizedError('„{0}“ ist kein gültiger Boolean (true oder false).', value);
    case 'object': {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new LocalizedError('Der Standardwert für object muss ein JSON-Objekt sein.');
      }
      return parsed;
    }
    case 'string':
      return value;
  }
}

function validatePorts(ports: Port[], nodeTitle: string, direction: LocalizedText): void {
  if (!Array.isArray(ports)) throw new LocalizedError('{0}: Die Liste der {1} ist ungültig.', nodeTitle, direction);
  for (const port of ports) {
    if (
      !port || typeof port !== 'object' || typeof port.name !== 'string' ||
      typeof port.type !== 'string' || (port.defaultValue !== undefined && typeof port.defaultValue !== 'string')
    ) throw new LocalizedError('{0}: Ein Port in den {1} ist ungültig.', nodeTitle, direction);
  }
  const names = ports.map((port) => port.name.trim());
  if (names.some((name) => !name)) throw new LocalizedError('{0}: Alle {1} benötigen einen Namen.', nodeTitle, direction);
  if (new Set(names).size !== names.length) throw new LocalizedError('{0}: {1} dürfen keine doppelten Namen haben.', nodeTitle, direction);
  for (const port of ports) {
    if (!isPortType(port.type)) throw new LocalizedError('{0}: Ungültiger Datentyp am Port „{1}“.', nodeTitle, port.name);
  }
}

function connectionError(connection: ConnectionLike, nodes: CanvasNode[], edges: CanvasEdge[]): LocalizedMessage | null {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return msg('Verbinde einen Ausgang mit einem Eingang.');
  }
  if (connection.source === connection.target) return msg('Eine Node kann nicht mit sich selbst verbunden werden.');
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  const outputName = connection.sourceHandle.replace(/^output:/, '');
  const inputName = connection.targetHandle.replace(/^input:/, '');
  const output = source?.data.outputs.find((port) => port.name === outputName);
  const input = target?.data.inputs.find((port) => port.name === inputName);
  if (!output || !input) return msg('Der ausgewählte Ein- oder Ausgang existiert nicht mehr.');
  if (output.type !== input.type && output.type !== 'any' && input.type !== 'any') {
    return msg('Datentypen stimmen nicht überein: {0} → {1}.', output.type, input.type);
  }
  if (edges.some((edge) => edge.target === connection.target && edge.targetHandle === connection.targetHandle)) {
    return msg('Der Eingang „{0}“ ist bereits verbunden.', input.name);
  }
  return null;
}

function validateProjectFile(value: unknown): ProjectFile {
  if (!value || typeof value !== 'object') throw new LocalizedError('Die Datei enthält kein gültiges BroderyFlow-Projekt.');
  const project = value as Partial<ProjectFile>;
  if (project.version !== 1) throw new LocalizedError('Unbekannte Projektversion „{0}“. Die Datei wurde nicht geändert.', String(project.version));
  if (!Array.isArray(project.nodes) || !Array.isArray(project.edges) || typeof project.name !== 'string') {
    throw new LocalizedError('Das Projekt ist unvollständig oder ungültig.');
  }
  const ids = new Set<string>();
  const nodes = project.nodes.map((node) => {
    if (
      !node || typeof node.id !== 'string' || typeof node.title !== 'string' ||
      typeof node.code !== 'string' || !['code', 'value', 'condition', 'show', 'debug', 'file', 'view', 'collector'].includes(node.type) ||
      !node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) ||
      !Array.isArray(node.inputs) || !Array.isArray(node.outputs)
    ) throw new LocalizedError('Das Projekt enthält eine ungültige Node.');
    if (ids.has(node.id)) throw new LocalizedError('Die Node-ID „{0}“ ist doppelt vorhanden.', node.id);
    ids.add(node.id);
    if ((node.width !== undefined && (!Number.isFinite(node.width) || node.width < 370)) ||
      (node.height !== undefined && (!Number.isFinite(node.height) || node.height < 100))) {
      throw new LocalizedError('Das Projekt enthält eine ungültige Node-Größe.');
    }
    if (node.color !== undefined && !nodeColors.some((color) => color.value === node.color)) {
      throw new LocalizedError('Das Projekt enthält eine ungültige Node-Farbe.');
    }
    if (node.type === 'view') {
      if (node.view !== undefined && !isViewSettings(node.view)) {
        throw new LocalizedError('Das Projekt enthält ungültige Ansichtseinstellungen.');
      }
      const data = createViewNodeData(node.title, node.view);
      return { ...node, code: '', inputs: data.inputs, outputs: [], view: data.view };
    }
    if (node.type === 'collector') {
      validatePorts(node.inputs, node.title, msg('Eingänge'));
      return { ...node, code: '', outputs: createCollectorNodeData(node.title).outputs };
    }
    if (node.type === 'file') {
      if (node.file !== undefined) {
        if (!node.file || typeof node.file.name !== 'string' || typeof node.file.content !== 'string' ||
          !['json', 'csv'].includes(node.file.format)) {
          throw new LocalizedError('{0}: Die gespeicherte Datei ist ungültig.', node.title);
        }
        parseImportedFile(node.file);
      }
      return { ...node, code: '', inputs: [], outputs: createFileNodeData(node.title, undefined, node.outputs[0]?.name === 'daten' ? 'daten' : 'data').outputs };
    }
    if (node.type === 'show' || node.type === 'debug') {
      validatePorts(node.inputs, node.title, msg('Eingänge'));
      return { ...node, code: '', inputs: node.inputs, outputs: [] };
    }
    if (node.type === 'value') {
      validatePorts(node.inputs, node.title, msg('Eingänge'));
      if (!Array.isArray(node.values) || node.values.some((item) =>
        !item || typeof item.name !== 'string' || typeof item.value !== 'string' ||
        (item.override !== undefined && typeof item.override !== 'boolean') ||
        (item.source !== undefined && (!item.source || typeof item.source.input !== 'string' ||
          !Array.isArray(item.source.path) || item.source.path.some((key) => typeof key !== 'string') ||
          !node.inputs.some((port) => port.name === item.source?.input))),
      )) throw new LocalizedError('{0}: Die Konstanten sind ungültig.', node.title);
      const values = node.values as ConstantValue[];
      const outputs = createValueNodeData(values, node.title, node.inputs).outputs;
      return { ...node, code: '', inputs: node.inputs, outputs, values };
    }
    if (node.type === 'condition') {
      const condition = createConditionNodeData(node.code, node.title, node.inputs);
      return { ...node, inputs: condition.inputs, outputs: condition.outputs };
    }
    validatePorts(node.inputs, node.title, msg('Eingänge'));
    validatePorts(node.outputs, node.title, msg('Ausgänge'));
    const code = normalizeCode(node.code);
    const inferred = inferPorts(code, node.inputs);
    return inferred
      ? { ...node, code, inputs: inferred.inputs, outputs: inferred.outputs }
      : { ...node, code };
  });
  const flowNodes = nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: node.type === 'collector' ? createCollectorNodeData(node.title, node.inputs) : node.type === 'view' ? createViewNodeData(node.title, node.view) : node.type === 'file' ? createFileNodeData(node.title, node.file, node.outputs[0]?.name) : node.type === 'value'
      ? createValueNodeData(node.values ?? [], node.title, node.inputs)
      : node.type === 'show' || node.type === 'debug'
        ? createDisplayNodeData(node.title, node.inputs)
        : node.type === 'condition'
        ? createConditionNodeData(node.code, node.title, node.inputs)
        : createNodeData(node),
  }));
  for (const node of nodes) {
    if (node.type === 'value') {
      const names = node.values?.map((item) => item.name.trim()) ?? [];
      if (names.some((name) => !name)) throw new LocalizedError('{0}: Alle Konstanten benötigen einen Namen.', node.title);
      if (new Set(names).size !== names.length) throw new LocalizedError('{0}: Konstantennamen müssen eindeutig sein.', node.title);
    }
  }
  const edges = project.edges as CanvasEdge[];
  const seenInputs = new Set<string>();
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (
      !edge || typeof edge.id !== 'string' || typeof edge.source !== 'string' ||
      typeof edge.target !== 'string' || typeof edge.sourceHandle !== 'string' ||
      typeof edge.targetHandle !== 'string' || !ids.has(edge.source) || !ids.has(edge.target)
    ) {
      throw new LocalizedError('Das Projekt enthält eine Verbindung zu einer unbekannten Node.');
    }
    if (edgeIds.has(edge.id)) throw new LocalizedError('Die Verbindungs-ID „{0}“ ist doppelt vorhanden.', edge.id);
    edgeIds.add(edge.id);
    const error = connectionError(edge, flowNodes, edges.filter((item) => item.id !== edge.id));
    if (error) throw new LocalizedError('Ungültige Verbindung: {0}', error);
    const targetKey = `${edge.target}:${edge.targetHandle}`;
    if (seenInputs.has(targetKey)) throw new LocalizedError('Ein Eingang ist mehrfach verbunden.');
    seenInputs.add(targetKey);
  }
  return { version: 1, name: project.name, nodes, edges };
}

function toProjectFile(name: string, nodes: CanvasNode[], edges: CanvasEdge[]): ProjectFile {
  return {
    version: 1,
    name,
    nodes: nodes.map(({ id, type, position, width, height, data }) => ({
      id,
      type: type ?? 'code',
      title: data.title,
      color: data.color,
      position,
      width,
      height,
      code: type === 'value' ? '' : data.code,
      inputs: data.inputs,
      outputs: data.outputs,
      ...(type === 'value' ? { values: data.values } : {}),
      ...(type === 'file' ? { file: data.file } : {}),
      ...(type === 'view' ? { view: data.view } : {}),
    })),
    edges,
  };
}

function errorText(error: unknown): LocalizedText {
  if (!(error instanceof Error)) return String(error);
  const line = error.stack?.match(/<anonymous>:(\d+):(\d+)/)?.[1];
  const message = error instanceof LocalizedError ? error.localizedMessage : error.message;
  return line ? msg('{0} (Zeile {1})', message, Math.max(1, Number(line) - 1)) : message;
}

export default function App() {
  const language = useLanguage();
  const { screenToFlowPosition, deleteElements } = useReactFlow<CanvasNode, CanvasEdge>();
  const initial = useMemo(initialProject, []);
  const firstWorkflow: WorkflowTab = { id: 'workflow-1', name: t('Mein Workflow'), ...initial };
  const canvasRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState<Theme>(() => localStorage.getItem('noder-theme') === 'light' ? 'light' : 'dark');
  const [confirmDeletion, setConfirmDeletion] = useState(() => localStorage.getItem('noder-confirm-deletion') !== 'false');
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>(initial.edges);
  const [projectName, setProjectName] = useState(t('Mein Workflow'));
  const [workflows, setWorkflows] = useState<WorkflowTab[]>([firstWorkflow]);
  const [activeWorkflowId, setActiveWorkflowId] = useState(firstWorkflow.id);
  const [sidebarTab, setSidebarTab] = useState<'nodes' | 'documentation'>('nodes');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notice, setNotice] = useState<LocalizedText>(msg('Verbinde Ports desselben Datentyps. JavaScript läuft getrennt in einem Web Worker.'));
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    position: { x: number; y: number };
    output?: { source: string; handle: string; name: string };
    nodeId?: string;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWorkflows((current) => current.map((workflow) => workflow.id === activeWorkflowId
      ? { ...workflow, name: projectName, nodes, edges }
      : workflow));
  }, [activeWorkflowId, edges, nodes, projectName]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const updated = current.map((node) => {
        if (node.type === 'value') {
          const inputs = node.data.inputs.filter((port) =>
            edges.some((edge) => edge.target === node.id && edge.targetHandle === `input:${port.name}`),
          );
          if (inputs.length === node.data.inputs.length) return node;
          changed = true;
          const values = node.data.values.map((item) => item.source && !inputs.some((port) => port.name === item.source?.input)
            ? { name: item.name, value: item.value } : item);
          return {
            ...node,
            data: {
              ...node.data, inputs, values,
              outputs: createValueNodeData(values, node.data.title, inputs).outputs,
              status: 'changed' as const, result: null, error: null,
            },
          };
        }
        if (node.type !== 'show' && node.type !== 'debug' && node.type !== 'collector') return node;
        const inputs = node.data.inputs.filter((port) =>
          edges.some((edge) => edge.target === node.id && edge.targetHandle === `input:${port.name}`),
        );
        if (inputs.length === node.data.inputs.length) return node;
        changed = true;
        return { ...node, data: { ...node.data, inputs } };
      });
      return changed ? updated : current;
    });
  }, [edges, nodes, setNodes]);

  const [deleteRequest, setDeleteRequest] = useState<CanvasNode[] | null>(null);
  const deleteResolver = useRef<((accepted: boolean) => void) | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  const resolveDelete = (accepted: boolean) => {
    const resolve = deleteResolver.current;
    deleteResolver.current = null;
    deleteDialog.current?.close();
    setDeleteRequest(null);
    resolve?.(accepted);
  };

  useEffect(() => {
    if (deleteRequest) deleteDialog.current?.showModal();
  }, [deleteRequest]);

  useEffect(() => () => {
    deleteResolver.current?.(false);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [contextMenu]);

  useEffect(() => {
    localStorage.setItem('noder-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('noder-confirm-deletion', String(confirmDeletion));
  }, [confirmDeletion]);

  useEffect(() => {
    const disableSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', disableSaveShortcut, true);
    return () => window.removeEventListener('keydown', disableSaveShortcut, true);
  }, []);

  const appendLog = useCallback((id: string, log: ExecutionLog) => {
    const nodeLog: NodeLog = log;
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, logs: [...node.data.logs, nodeLog] } }
      : node));
  }, [setNodes]);

  const removeLog = useCallback((id: string, logId: string) => {
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, logs: node.data.logs.filter((log) => log.id !== logId) } }
      : node));
  }, [setNodes]);

  const updateNode = useCallback((id: string, patch: Partial<NodeData>) => {
    const existing = nodes.find((node) => node.id === id);
    if (existing && (patch.inputs || patch.outputs)) {
      const changes = [
        { key: 'inputs' as const, handle: 'targetHandle' as const, prefix: 'input:', endpoint: 'target' as const },
        { key: 'outputs' as const, handle: 'sourceHandle' as const, prefix: 'output:', endpoint: 'source' as const },
      ];
      setEdges((currentEdges) => currentEdges.flatMap((edge) => {
        if (edge.source !== id && edge.target !== id) return [edge];
        const updated = { ...edge };
        for (const change of changes) {
          if (edge[change.endpoint] !== id) continue;
          const ports = patch[change.key] ?? existing.data[change.key];
          const name = updated[change.handle]?.replace(change.prefix, '');
          const port = ports.find((item) => item.name === name);
          if (!port) return [];
          updated[change.handle] = `${change.prefix}${port.name}`;
        }
        const source = edge.source === id ? patch.outputs ?? existing.data.outputs : nodes.find((node) => node.id === edge.source)?.data.outputs ?? [];
        const target = edge.target === id ? patch.inputs ?? existing.data.inputs : nodes.find((node) => node.id === edge.target)?.data.inputs ?? [];
        const sourcePort = source.find((port) => `output:${port.name}` === updated.sourceHandle);
        const targetPort = target.find((port) => `input:${port.name}` === updated.targetHandle);
        if (!sourcePort || !targetPort || (sourcePort.type !== targetPort.type && sourcePort.type !== 'any' && targetPort.type !== 'any')) return [];
        return [updated];
      }));
    }
    setNodes((current) => current.map((node) => {
      if (node.id !== id) return node;
      const codeChanged = patch.code !== undefined && patch.code !== node.data.code;
      return {
        ...node,
        data: {
          ...node.data,
          ...patch,
          ...(codeChanged ? { status: 'changed' as const, error: null, result: null } : {}),
        },
      };
    }));
  }, [nodes, setEdges, setNodes]);

  const runWorkflow = useCallback(async (targetNodeId?: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(targetNodeId ? msg('Verbundener Flow wird validiert…') : msg('Validierung läuft…'));
    const ordered: CanvasNode[] = [];
    let activeNodeId: string | null = null;
    try {
      const selectedNode = targetNodeId ? nodes.find((node) => node.id === targetNodeId) : undefined;
      if (targetNodeId && !selectedNode) throw new LocalizedError('Die ausgewählte Node existiert nicht mehr.');

      const includedIds = new Set<string>();
      if (targetNodeId) {
        const includeUpstream = (id: string) => {
          if (includedIds.has(id)) return;
          includedIds.add(id);
          for (const edge of edges) {
            if (edge.target === id) includeUpstream(edge.source);
          }
        };
        includeUpstream(targetNodeId);
      } else {
        nodes.forEach((node) => includedIds.add(node.id));
      }

      const executionNodes = nodes.filter((node) => includedIds.has(node.id));
      const executionEdges = edges.filter((edge) => includedIds.has(edge.source) && includedIds.has(edge.target));
      setNodes((current) => current.map((node) => includedIds.has(node.id) ? {
        ...node,
        data: { ...node.data, status: 'ready', result: null, logs: [], error: null },
      } : node));

      for (const node of executionNodes) {
        validatePorts(node.data.inputs, node.data.title, msg('Eingänge'));
        validatePorts(node.data.outputs, node.data.title, msg('Ausgänge'));
      }
      const incoming = new Map(executionNodes.map((node) => [node.id, 0]));
      for (const edge of executionEdges) {
        const error = connectionError(edge, executionNodes, executionEdges.filter((item) => item.id !== edge.id));
        if (error) throw new LocalizedError(error.key, ...error.values);
        incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
      }
      const queue = executionNodes.filter((node) => incoming.get(node.id) === 0);
      const nodeById = new Map(executionNodes.map((node) => [node.id, node]));
      while (queue.length) {
        const node = queue.shift()!;
        ordered.push(node);
        for (const edge of executionEdges.filter((item) => item.source === node.id)) {
          const nextCount = (incoming.get(edge.target) ?? 0) - 1;
          incoming.set(edge.target, nextCount);
          if (nextCount === 0) {
            const next = nodeById.get(edge.target);
            if (next) queue.push(next);
          }
        }
      }
      if (ordered.length !== executionNodes.length) throw new LocalizedError('Zyklische Verbindung erkannt. Entferne eine Verbindung, um den Workflow auszuführen.');

      const results = new Map<string, Record<string, unknown> | null>();
      const skippedNodes = new Set<string>();
      for (const node of ordered) {
        const incomingEdges = executionEdges.filter((edge) => edge.target === node.id);
        const isInactive = incomingEdges.some((edge) => {
          if (skippedNodes.has(edge.source)) return true;
          const sourceNode = nodeById.get(edge.source);
          if (sourceNode?.type !== 'condition') return false;
          const branch = edge.sourceHandle?.replace(/^output:/, '');
          const decision = results.get(edge.source)?.[branch ?? ''];
          return typeof decision !== 'boolean' || decision !== (branch === 'true');
        });
        if (isInactive) {
          skippedNodes.add(node.id);
          continue;
        }

        activeNodeId = node.id;
        setNodes((current) => current.map((item) => item.id === node.id
          ? { ...item, data: { ...item.data, status: 'running', logs: [], error: null } }
          : item));
        const inputs: Record<string, unknown> = Object.create(null);
        for (const port of node.data.inputs) {
          const edge = executionEdges.find((item) => item.target === node.id && item.targetHandle === `input:${port.name}`);
          const value = edge
            ? results.get(edge.source)?.[edge.sourceHandle?.replace(/^output:/, '') ?? '']
            : parseDefault(port.defaultValue, port.type);
          if (value === undefined) throw new LocalizedError('Eingang „{0}“ hat keinen Wert.', port.name);
          if (!isValueType(value, port.type)) throw new LocalizedError('Eingang „{0}“ erwartet {1}, erhielt {2}.', port.name, port.type, Array.isArray(value) ? 'array' : typeof value);
          inputs[port.name] = value;
        }
        if (node.type === 'value') {
          const names = node.data.values.map((item) => item.name.trim());
          if (names.some((name) => !name)) throw new LocalizedError('Alle Konstanten benötigen einen Namen.');
          if (new Set(names).size !== names.length) throw new LocalizedError('Konstantennamen müssen eindeutig sein.');
        }
        if (node.type === 'condition' && !node.data.code.trim()) {
          throw new LocalizedError('Die Bedingungs-Node benötigt einen JavaScript-Ausdruck.');
        }
        const isDisplay = node.type === 'show' || node.type === 'debug';
        if (isDisplay) {
          for (const [name, value] of Object.entries(inputs)) {
            let displayValue: string;
            try {
              displayValue = JSON.stringify(value, null, 2) ?? String(value);
            } catch {
              displayValue = String(value);
            }
            appendLog(node.id, {
              id: crypto.randomUUID(),
              kind: node.type === 'debug' ? 'debug' : 'show',
              label: name,
              value: displayValue,
            });
          }
        }
        const resolvedValues = node.type === 'value' ? resolveValues(node.data.values, inputs) : null;
        const result = isDisplay ? null : node.type === 'collector'
          ? { data: collectInputs(inputs) }
          : resolvedValues ? resolvedValues.result : node.type === 'view' ? { data: inputs.data } : node.type === 'file'
          ? { [node.data.outputs[0].name]: parseImportedFile(node.data.file) }
          : node.type === 'condition'
            ? await executeCode(
              `const condition = Boolean(${node.data.code});\nreturn { true: condition, false: !condition };`,
              inputs,
              (log) => appendLog(node.id, log),
            )
            : await executeCode(node.data.code, inputs, (log) => appendLog(node.id, log));
        if (result) {
          for (const port of node.type === 'value' && resolvedValues
            ? createValueNodeData(resolvedValues.values, node.data.title, node.data.inputs).outputs
            : node.data.outputs) {
            if (!(port.name in result)) throw new LocalizedError('Ausgang „{0}“ wurde von run(inputs) nicht zurückgegeben.', port.name);
            if (!isValueType(result[port.name], port.type)) throw new LocalizedError('Ausgang „{0}“ muss den Typ {1} haben.', port.name, port.type);
          }
        }
        results.set(node.id, result);
        if (resolvedValues) {
          const names = new Set(createValueNodeData(resolvedValues.values).outputs.map((port) => `output:${port.name}`));
          setEdges((current) => current.filter((edge) => edge.source !== node.id || names.has(edge.sourceHandle ?? '')));
        }
        setNodes((current) => current.map((item) => item.id === node.id
          ? { ...item, data: { ...item.data,
            ...(resolvedValues ? {
              values: resolvedValues.values,
              outputs: createValueNodeData(resolvedValues.values, item.data.title, item.data.inputs).outputs,
            } : {}),
            status: 'success', result: result ?? null, error: null } }
          : item));
      }
      const executedCount = ordered.length - skippedNodes.size;
      setNotice(targetNodeId
        ? msg('Verbundener Flow erfolgreich ausgeführt · {0} {1}.', executedCount, executedCount === 1 ? 'Node' : 'Nodes')
        : msg('Workflow erfolgreich ausgeführt · {0} {1}.', executedCount, executedCount === 1 ? 'Node' : 'Nodes'));
    } catch (error) {
      const message = errorText(error);
      setNotice(msg('Workflow fehlgeschlagen: {0}', message));
      if (activeNodeId) setNodes((current) => current.map((node) => node.id === activeNodeId
        ? { ...node, data: { ...node.data, status: 'error', error: message } }
        : node));
    } finally {
      setBusy(false);
    }
  }, [appendLog, busy, edges, nodes, setEdges, setNodes]);

  useEffect(() => {
    const runSelectedNode = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.key !== 'Enter' || busy) return;
      const selectedNodes = nodes.filter((node) => node.selected);
      if (selectedNodes.length !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      void runWorkflow(selectedNodes[0].id);
    };
    window.addEventListener('keydown', runSelectedNode, true);
    return () => window.removeEventListener('keydown', runSelectedNode, true);
  }, [busy, nodes, runWorkflow]);

  const addNode = () => {
    const id = nodeId();
    const data = createNodeData({ title: defaultNodeTitle('code', nodes) });
    setNodes((current) => [...current, {
      id,
      type: 'code',
      position: { x: 180 + (current.length % 3) * 80, y: 120 + current.length * 70 },
      data,
    }]);
  };

  const addValueNode = () => {
    const id = nodeId();
    const data = createValueNodeData([], defaultNodeTitle('value', nodes));
    setNodes((current) => [...current, {
      id,
      type: 'value',
      position: { x: 220 + (current.length % 3) * 80, y: 150 + current.length * 70 },
      data,
    }]);
  };

  const addConditionNode = () => {
    const id = nodeId();
    const data = createConditionNodeData('', defaultNodeTitle('condition', nodes));
    setNodes((current) => [...current, {
      id,
      type: 'condition',
      position: { x: 260 + (current.length % 3) * 80, y: 180 + current.length * 70 },
      data,
    }]);
  };

  const addDisplayNode = (type: 'show' | 'debug') => {
    const id = nodeId();
    setNodes((current) => [...current, {
      id, type,
      position: { x: 220 + (current.length % 3) * 80, y: 150 + current.length * 70 },
      data: createDisplayNodeData(''),
    }]);
  };

  const addViewNode = () => {
    if (busy) return;
    setNodes((current) => [...current, {
      id: nodeId(), type: 'view', position: { x: 260, y: 180 + current.length * 70 },
      data: createViewNodeData(defaultNodeTitle('view', current)),
    }]);
  };

  const addCollectorNode = () => {
    if (busy) return;
    setNodes((current) => [...current, {
      id: nodeId(), type: 'collector', position: { x: 260, y: 180 + current.length * 70 },
      data: createCollectorNodeData(defaultNodeTitle('collector', current)),
    }]);
  };

  const addFileNode = () => {
    if (busy) return;
    setNodes((current) => [...current, {
      id: nodeId(), type: 'file', position: { x: 260, y: 180 + current.length * 70 },
      data: createFileNodeData(defaultNodeTitle('file', current)),
    }]);
  };

  const addContextNode = (type: 'code' | 'value' | 'show' | 'debug' | 'file' | 'view' | 'collector') => {
    if (!contextMenu || busy) return;
    const id = nodeId();
    const data = type === 'collector' ? createCollectorNodeData(defaultNodeTitle('collector', nodes)) : type === 'view' ? createViewNodeData(defaultNodeTitle('view', nodes)) : type === 'file' ? createFileNodeData(defaultNodeTitle('file', nodes)) : type === 'show' || type === 'debug' ? createDisplayNodeData('') : type === 'value'
      ? createValueNodeData([], defaultNodeTitle('value', nodes))
      : createNodeData({ title: defaultNodeTitle('code', nodes) });
    const pending = contextMenu.output;
    if (pending) {
      const output = nodes.find((node) => node.id === pending.source)?.data.outputs.find((port) => port.name === pending.name);
      if (!output) {
        setNotice(msg('Der ausgewählte Ausgang existiert nicht mehr.'));
        setContextMenu(null);
        return;
      }
      if (type === 'code') {
        const generated = addInputVariable('', output.name);
        const key = generated.variableName === output.name ? generated.variableName : `${JSON.stringify(output.name)}: ${generated.variableName}`;
        const code = `${generated.code}\nreturn { ${key} };`;
        Object.assign(data, createNodeData({ title: defaultNodeTitle('code', nodes), code }));
      } else if (type !== 'view') {
        data.inputs = [{ name: output.name, type: output.type }];
      }
    }
    const newNode: CanvasNode = { id, type, position: contextMenu.position, data };
    if (pending) {
      const connection: Connection = {
        source: pending.source, sourceHandle: pending.handle, target: id, targetHandle: `input:${type === 'view' ? 'data' : pending.name}`,
      };
      const error = connectionError(connection, [...nodes, newNode], edges);
      if (error) {
        setNotice(error);
        return;
      }
      setEdges((current) => addEdge({
        ...connection, animated: true, style: { stroke: '#6f83f7', strokeWidth: 2 },
      }, current));
    }
    setNodes((current) => [...current, newNode]);
    setContextMenu(null);
  };

  const wiredNodes = useMemo(() => nodes.map((node) => ({
    ...node,
    style: { ...node.style, ...(node.data.color ? { '--node-color': node.data.color } : {}) },
    data: {
      ...node.data,
      onChange: updateNode,
      onRemoveLog: removeLog,
      onRun: (id: string) => void runWorkflow(id),
      onClear: (id: string) => {
        if (busy) return;
        const target = nodes.find((item) => item.id === id);
        if (target?.type === 'view') {
          setNodes((current) => current.map((item) => item.id === id
            ? { ...item, data: { ...item.data, result: null, error: null, status: 'ready' } }
            : item));
          return;
        }
        if (target?.type === 'show' || target?.type === 'debug') {
          setNodes((current) => current.map((item) => item.id === id
            ? { ...item, data: { ...item.data, logs: [] } }
            : item));
          return;
        }
        setNodes((current) => current.map((item) => item.id === id ? {
          ...item,
          data: {
            ...item.data, code: '', values: [], file: undefined, inputs: [],
            outputs: item.type === 'value' ? createValueNodeData().outputs : item.type === 'file' || item.type === 'collector' ? item.data.outputs : item.type === 'condition' ? createConditionNodeData().outputs : [],
            logs: [], result: null, error: null, status: 'ready',
          },
        } : item));
        setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
      },
      onDelete: (id: string) => {
        void deleteElements({ nodes: [{ id }] });
      },
    },
  })), [busy, deleteElements, nodes, removeLog, runWorkflow, setNodes, setEdges, updateNode]);

  const beforeDelete = async ({ nodes: deletingNodes, edges: deletingEdges }: { nodes: CanvasNode[]; edges: CanvasEdge[] }) => {
    if (!confirmDeletion) return { nodes: deletingNodes, edges: deletingEdges };
    const nonEmpty = deletingNodes.some((node) =>
      node.type !== 'show' && node.type !== 'debug' && node.type !== 'view' && node.type !== 'collector' && (
        node.data.file || node.data.code.trim() || node.data.values.length || node.data.inputs.length || node.data.logs.length ||
        node.data.error || node.data.result ||
        edges.some((edge) => edge.source === node.id || edge.target === node.id)
      ),
    );
    if (!nonEmpty) return { nodes: deletingNodes, edges: deletingEdges };
    if (deleteResolver.current) return false;
    setContextMenu(null);
    return new Promise<boolean>((resolve) => {
      deleteResolver.current = resolve;
      setDeleteRequest(deletingNodes);
    });
  };

  const handleConnect = useCallback((connection: Connection) => {
    const error = connectionError(connection, nodes, edges);
    if (error) {
      setNotice(error);
      return;
    }
    setEdges((current) => addEdge({
      ...connection,
      animated: true,
      style: { stroke: '#6f83f7', strokeWidth: 2 },
    }, current));
    setNotice(msg('Verbindung erstellt.'));
  }, [edges, nodes, setEdges]);

  const handleConnectEnd: OnConnectEnd = useCallback((event, connectionState) => {
    const { fromNode, fromHandle, toNode, from, pointer } = connectionState;
    if (busy || connectionState.isValid || !fromNode || !fromHandle?.id || fromHandle.type !== 'source' || !pointer) return;
    if (Math.hypot(pointer.x - from.x, pointer.y - from.y) < 20) return;

    const pointerEvent = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!pointerEvent) return;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds || pointerEvent.clientX < bounds.left || pointerEvent.clientX > bounds.right ||
      pointerEvent.clientY < bounds.top || pointerEvent.clientY > bounds.bottom) return;

    const source = nodes.find((node) => node.id === fromNode.id);
    const outputName = fromHandle.id?.replace(/^output:/, '');
    const output = source?.data.outputs.find((port) => port.name === outputName);
    if (!source || !output || !outputName) return;

    const element = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
    const targetId = toNode?.id ?? element?.closest('.react-flow__node')?.getAttribute('data-id');
    if (targetId) {
      const target = nodes.find((node) => node.id === targetId);
      if (!target || target.id === source.id || element?.closest('.react-flow__handle')) return;
      if (target.type === 'value') {
        let inputName = outputName;
        let inputSuffix = 2;
        const occupiedInputs = new Set(edges.filter((edge) => edge.target === target.id)
          .map((edge) => edge.targetHandle));
        while (occupiedInputs.has(`input:${inputName}`)) inputName = `${outputName}${inputSuffix++}`;
        const inputs = target.data.inputs.some((port) => port.name === inputName)
          ? target.data.inputs : [...target.data.inputs, { name: inputName, type: 'any' as const }];
        const connection: Connection = {
          source: source.id, sourceHandle: fromHandle.id, target: target.id, targetHandle: `input:${inputName}`,
        };
        const error = connectionError(connection, nodes.map((node) => node.id === target.id
          ? { ...node, data: { ...node.data, inputs } } : node), edges);
        if (error) {
          setNotice(error);
          return;
        }
        const names = new Set(target.data.values.map((item) => item.name.trim()));
        let name = inputName;
        let suffix = 2;
        while (names.has(name)) name = `${inputName}${suffix++}`;
        let values = target.data.values.some((item) => item.source?.input === inputName)
          ? target.data.values : [...target.data.values, {
            name, value: '', source: { input: inputName, path: [] }, override: false,
          }];
        let previewError: LocalizedText | null = null;
        if (source.data.result && Object.prototype.hasOwnProperty.call(source.data.result, outputName)) {
          try {
            const retained = target.data.values.filter((item) => item.source?.input !== inputName);
            values = [...retained, ...valueSnapshots(outputName, source.data.result, retained, inputName)];
          } catch (error) {
            previewError = errorText(error);
          }
        }
        updateNode(target.id, {
          inputs, values, outputs: createValueNodeData(values, target.data.title, inputs).outputs,
          status: 'changed', result: null, error: previewError,
        });
        setEdges((current) => addEdge({
          ...connection, animated: true, style: { stroke: '#6f83f7', strokeWidth: 2 },
        }, current));
        setNotice(msg('Verbindung erstellt.'));
        return;
      }
      if (target.type === 'view') {
        handleConnect({ source: source.id, sourceHandle: fromHandle.id, target: target.id, targetHandle: 'input:data' });
        return;
      }
      if (target.type === 'collector') {
        let name = outputName;
        let suffix = 2;
        const names = new Set(target.data.inputs.map((port) => port.name));
        while (names.has(name)) name = `${outputName}${suffix++}`;
        const inputs = [...target.data.inputs, { name, type: output.type }];
        const connection: Connection = {
          source: source.id, sourceHandle: fromHandle.id, target: target.id, targetHandle: `input:${name}`,
        };
        const error = connectionError(connection, nodes.map((node) => node.id === target.id
          ? { ...node, data: { ...node.data, inputs } } : node), edges);
        if (error) {
          setNotice(error);
          return;
        }
        updateNode(target.id, { inputs, status: 'changed', result: null, error: null });
        setEdges((current) => addEdge({
          ...connection, animated: true, style: { stroke: '#6f83f7', strokeWidth: 2 },
        }, current));
        setNotice(msg('Verbindung erstellt.'));
        return;
      }
      const isDisplay = target.type === 'show' || target.type === 'debug';
      if (target.type !== 'code' && !isDisplay) {
        setNotice(msg('Automatische Code-Eingänge können nur zu Code-Nodes hinzugefügt werden.'));
        return;
      }
      const targetElement = element?.closest('.react-flow__node');
      const index = targetElement ? inputDropIndex(targetElement, pointerEvent.clientY) : target.data.inputs.length;
      const generated = isDisplay ? { code: '' } : addInputVariable(
        target.data.code, outputName, target.data.inputs[index]?.name,
      );
      const ports = isDisplay ? {
        inputs: target.data.inputs.some((port) => port.name === outputName)
          ? target.data.inputs
          : [...target.data.inputs, { name: outputName, type: output.type }],
        outputs: [],
      } : inferPorts(generated.code, target.data.inputs);
      if (!ports) {
        setNotice(msg('Der Eingang konnte nicht ergänzt werden: Bitte korrigiere zuerst den JavaScript-Code der Ziel-Node.'));
        return;
      }
      const updatedNode: CanvasNode = {
        ...target,
        data: { ...target.data, code: generated.code, ...ports },
      };
      const connection: Connection = {
        source: source.id,
        sourceHandle: fromHandle.id,
        target: target.id,
        targetHandle: `input:${outputName}`,
      };
      const error = connectionError(connection, nodes.map((node) => node.id === target.id ? updatedNode : node), edges);
      if (error) {
        setNotice(error);
        return;
      }
      updateNode(target.id, { code: generated.code, ...ports });
      setEdges((current) => addEdge({
        ...connection,
        animated: true,
        style: { stroke: '#6f83f7', strokeWidth: 2 },
      }, current));
      setNotice(msg('„{0}“ als Eingang ergänzt und verbunden.', outputName));
      return;
    }
    if (!element?.closest('.react-flow__pane')) return;

    const position = screenToFlowPosition({ x: pointerEvent.clientX, y: pointerEvent.clientY });
    setContextMenu({
      x: Math.max(8, Math.min(pointerEvent.clientX, window.innerWidth - 168)),
      y: Math.max(8, Math.min(pointerEvent.clientY, window.innerHeight - 210)),
      position,
      output: { source: source.id, handle: fromHandle.id, name: outputName },
    });
  }, [busy, edges, handleConnect, nodes, screenToFlowPosition, setEdges, setNodes, updateNode]);

  const saveProject = async () => {
    try {
      const project = validateProjectFile(toProjectFile(projectName, nodes, edges));
      const content = JSON.stringify(project, null, 2);
      if (isTauri()) {
        const path = await save({ defaultPath: `${projectName || 'workflow'}.flowweave.json`, filters: [{ name: t('BroderyFlow-Projekt'), extensions: ['json'] }] });
        if (!path) return;
        await writeTextFile(path, content);
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${projectName || 'workflow'}.flowweave.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
      setNotice(msg('Projekt wurde gespeichert.'));
    } catch (error) {
      setNotice(msg('Speichern fehlgeschlagen: {0}', errorText(error)));
    }
  };

  const loadContent = async (content: string) => {
    const project = validateProjectFile(JSON.parse(content));
    const workflow: WorkflowTab = {
      id: nodeId(),
      name: project.name,
      nodes: project.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        width: node.type === 'code' ? node.width : undefined,
        height: node.type === 'code' ? node.height : undefined,
        data: { ...(node.type === 'collector' ? createCollectorNodeData(node.title, node.inputs) : node.type === 'view' ? createViewNodeData(node.title, node.view) : node.type === 'file' ? createFileNodeData(node.title, node.file, node.outputs[0]?.name) : node.type === 'value'
          ? createValueNodeData(node.values ?? [], node.title, node.inputs)
          : node.type === 'show' || node.type === 'debug'
            ? createDisplayNodeData(node.title, node.inputs)
          : node.type === 'condition'
            ? createConditionNodeData(node.code, node.title, node.inputs)
            : createNodeData({ ...node, code: normalizeCode(node.code) })), color: node.color },
      })),
      edges: project.edges,
    };
    setWorkflows((current) => [
      ...current.map((item) => item.id === activeWorkflowId
        ? { ...item, name: projectName, nodes, edges }
        : item),
      workflow,
    ]);
    setActiveWorkflowId(workflow.id);
    setProjectName(project.name);
    setNodes(workflow.nodes);
    setEdges(workflow.edges);
    setContextMenu(null);
    setNotice(msg('Projekt „{0}“ wurde als neuer Workflow geöffnet.', project.name));
  };

  const openProject = async () => {
    if (!isTauri()) {
      fileInput.current?.click();
      return;
    }
    try {
      const path = await open({ multiple: false, filters: [{ name: t('BroderyFlow-Projekt'), extensions: ['json'] }] });
      if (!path || Array.isArray(path)) return;
      await loadContent(await readTextFile(path));
    } catch (error) {
      setNotice(msg('Öffnen fehlgeschlagen: {0}', errorText(error)));
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    try {
      await loadContent(await file.text());
    } catch (error) {
      setNotice(msg('Projekt konnte nicht geöffnet werden: {0}', errorText(error)));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const activateWorkflow = (workflow: WorkflowTab) => {
    if (busy || workflow.id === activeWorkflowId) return;
    setWorkflows((current) => current.map((item) => item.id === activeWorkflowId
      ? { ...item, name: projectName, nodes, edges }
      : item));
    setActiveWorkflowId(workflow.id);
    setProjectName(workflow.name);
    setNodes(workflow.nodes);
    setEdges(workflow.edges);
    setContextMenu(null);
    setNotice(msg('Workflow „{0}“ aktiviert.', workflow.name));
  };

  const createWorkflow = (workflow: WorkflowTab) => {
    setWorkflows((current) => [
      ...current.map((item) => item.id === activeWorkflowId
        ? { ...item, name: projectName, nodes, edges }
        : item),
      workflow,
    ]);
    setActiveWorkflowId(workflow.id);
    setProjectName(workflow.name);
    setNodes(workflow.nodes);
    setEdges(workflow.edges);
    setNotice(msg('Workflow „{0}“ wurde erstellt.', workflow.name));
  };

  const addWorkflow = () => {
    const project = initialProject();
    createWorkflow({
      id: nodeId(),
      name: `Workflow ${workflows.length + 1}`,
      ...project,
    });
  };

  const closeWorkflow = (id: string) => {
    if (busy || workflows.length < 2) return;
    const index = workflows.findIndex((workflow) => workflow.id === id);
    if (index < 0) return;
    const workflow = workflows[index];
    if (!window.confirm(t('Workflow „{0}“ schließen? Nicht gespeicherte Änderungen gehen verloren.', workflow.name))) return;
    const nextWorkflows = workflows.filter((workflow) => workflow.id !== id);
    if (id === activeWorkflowId) {
      const next = nextWorkflows[Math.min(index, nextWorkflows.length - 1)];
      setWorkflows(nextWorkflows.map((workflow) => workflow.id === activeWorkflowId
        ? { ...workflow, name: projectName, nodes, edges }
        : workflow));
      setActiveWorkflowId(next.id);
      setProjectName(next.name);
      setNodes(next.nodes);
      setEdges(next.edges);
    } else {
      setWorkflows(nextWorkflows);
    }
  };

  const isValidConnection = useCallback((connection: Edge | Connection) => (
    !connectionError(connection, nodes, edges)
  ), [edges, nodes]);

  return (
    <main className="app-shell" data-theme={theme}>
      <header className="topbar">
        <div className="brand"><div className="brand-icon"><WorkflowIcon size={19} /></div><span>BroderyFlow</span><span className="brand-version">CANVAS</span></div>
        <div className="project-title"><FileJson2 size={15} /><input aria-label={t('Projektname')} value={projectName} disabled={busy} onChange={(event) => setProjectName(event.target.value)} /></div>
        <div className="toolbar">
          <button className="toolbar-button" disabled={busy} onClick={openProject}><FolderOpen size={15} /> {t('Öffnen')}</button>
          <button className="toolbar-button" disabled={busy} onClick={() => void saveProject()}><Save size={15} /> {t('Speichern')}</button>
          <details className="global-settings">
            <summary className="toolbar-button" aria-label={t('Globale Einstellungen')} title={t('Globale Einstellungen')}><Settings size={15} /></summary>
            <div className="global-settings-panel">
              <strong>{t('Globale Einstellungen')}</strong>
              <label className="language-setting">
                {t('Sprache')}
                <select value={language} onChange={(event) => {
                  if (event.target.value === 'en' || event.target.value === 'de') setLanguage(event.target.value);
                }}>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                </select>
              </label>
              <label>
                <input type="checkbox" checked={confirmDeletion} onChange={(event) => setConfirmDeletion(event.target.checked)} />
                {t('Löschen von Nodes bestätigen')}
              </label>
              <p>{t('Show-/Debug-Nodes und leere Nodes werden weiterhin ohne Nachfrage gelöscht.')}</p>
            </div>
          </details>
          <button
            className="toolbar-button theme-button"
            aria-label={t('Zum {0} Design wechseln', theme === 'dark' ? t('hellen') : t('dunklen'))}
            title={t('Zum {0} Design wechseln', theme === 'dark' ? t('hellen') : t('dunklen'))}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <span className="toolbar-divider" />
          <button className="run-button" disabled={busy} onClick={() => void runWorkflow()}><Play size={14} fill="currentColor" /> {busy ? t('Läuft…') : t('Workflow ausführen')}</button>
        </div>
        <input ref={fileInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={(event) => void handleFile(event.target.files?.[0])} />
      </header>
      <nav className="workflow-tabs" aria-label="Workflows">
        {workflows.map((workflow) => (
          <div className={`workflow-tab ${workflow.id === activeWorkflowId ? 'active' : ''}`} key={workflow.id}>
            <button
              className="workflow-tab-select"
              type="button"
              title={workflow.name}
              aria-current={workflow.id === activeWorkflowId ? 'page' : undefined}
              disabled={busy}
              onClick={() => activateWorkflow(workflow)}
            >
              {workflow.name || t('Unbenannter Workflow')}
            </button>
            <button
              className="workflow-tab-close"
              type="button"
              aria-label={t('Workflow „{0}“ schließen', workflow.name)}
              title={t('Workflow schließen')}
              disabled={busy || workflows.length < 2}
              onClick={() => closeWorkflow(workflow.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="workflow-tab-add" type="button" aria-label={t('Workflow hinzufügen')} title={t('Workflow hinzufügen')} disabled={busy} onClick={addWorkflow}>
          <Plus size={15} />
        </button>
      </nav>
      <section
        ref={canvasRef}
        className={`canvas-wrap ${busy ? 'busy' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
        onContextMenu={(event) => {
          event.preventDefault();
          if (busy) return;
          setContextMenu({
            x: Math.max(8, Math.min(event.clientX, window.innerWidth - 168)),
            y: Math.max(8, Math.min(event.clientY, window.innerHeight - 250)),
            position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            nodeId: event.target instanceof Element
              ? event.target.closest('.react-flow__node')?.getAttribute('data-id') ?? undefined
              : undefined,
          });
        }}
      >
        <div className="canvas-meta"><span className="live-dot" /> {t('ARBEITSFLÄCHE')} <span className="meta-separator">/</span> {nodes.length} NODES · {edges.length} {t('VERBINDUNGEN')}</div>
        <aside className={`node-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`} aria-label={t('Node-Sidebar')}>
          <div className="node-sidebar-header">
            {!sidebarCollapsed && <div className="node-sidebar-tabs" role="tablist" aria-label={t('Sidebar-Tabs')}>
              <button type="button" role="tab" aria-selected={sidebarTab === 'nodes'} className={sidebarTab === 'nodes' ? 'active' : ''}
                onClick={() => setSidebarTab('nodes')}>{t('Nodes')}</button>
              <button type="button" role="tab" aria-selected={sidebarTab === 'documentation'} className={sidebarTab === 'documentation' ? 'active' : ''}
                onClick={() => setSidebarTab('documentation')}>{t('Documentation')}</button>
            </div>}
            <button
              className="sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? t('Sidebar ausklappen') : t('Sidebar einklappen')}
              title={sidebarCollapsed ? t('Sidebar ausklappen') : t('Sidebar einklappen')}
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
          {!sidebarCollapsed && (sidebarTab === 'nodes' ? (
            <div className="node-sidebar-content" role="tabpanel">
              <p>{t('Wähle einen Node aus, um ihn zur Arbeitsfläche hinzuzufügen.')}</p>
              <button className="help-add-node" disabled={busy} onClick={addNode}><Plus size={14} /> {t('Code-Node hinzufügen')}</button>
              <button className="help-add-node" disabled={busy} onClick={addValueNode}><Plus size={14} /> {t('Werteknoten hinzufügen')}</button>
              <button className="help-add-node" disabled={busy} onClick={addConditionNode}><Plus size={14} /> {t('If-/Else-Node hinzufügen')}</button>
              <button className="help-add-node" disabled={busy} onClick={() => addDisplayNode('show')}><Plus size={14} /> {t('Show-Node hinzufügen')}</button>
              <button className="help-add-node" disabled={busy} onClick={() => addDisplayNode('debug')}><Plus size={14} /> {t('Debug-Node hinzufügen')}</button>
              <button className="help-add-node" disabled={busy} onClick={addFileNode}><Plus size={14} /> {t('Datei-Node hinzufügen')}</button>
              <button className="help-add-node" disabled={busy} onClick={addViewNode}><Plus size={14} /> {t('Ansichts-Node hinzufügen')}</button>
              <button className="help-add-node" disabled={busy} onClick={addCollectorNode}><Plus size={14} /> {t('Collector hinzufügen')}</button>
            </div>
          ) : (
            <div className="node-sidebar-content node-documentation" role="tabpanel">
              <h2>{t('Node-Dokumentation')}</h2>
              <section><h3>{t('Code-Node')}</h3><p>{t('Führt JavaScript aus und verarbeitet verbundene Eingänge. Schreibe den Inhalt von run(inputs); gib Ergebnisse als Objekt zurück, zum Beispiel return { result: inputs.value * 2 }.')}</p></section>
              <section><h3>{t('Werteknoten')}</h3><p>{t('Definiert Konstanten und übernimmt verbundene Werte. Jeder Wert wird als eigener Ausgang angeboten; allValues bündelt alle Einträge als Objekt.')}</p></section>
              <section><h3>{t('If-/Else-Node')}</h3><p>{t('Wertet einen JavaScript-Ausdruck aus, zum Beispiel inputs.value > 10, und stellt die booleschen Ausgänge true und false bereit.')}</p></section>
              <section><h3>{t('Show-Node')}</h3><p>{t('Zeigt einen Wert als Ergebnis im Workflow an. Verbinde einen Eingang und verwende show(wert) in einer Code-Node.')}</p></section>
              <section><h3>{t('Debug-Node')}</h3><p>{t('Gibt Namen und Werte im Ausführungsprotokoll aus. Verwende debug(wert) in einer Code-Node, um Zwischenergebnisse zu untersuchen.')}</p></section>
              <section><h3>{t('Datei-Node')}</h3><p>{t('Lädt eine lokale UTF-8-JSON- oder CSV-Datei und gibt deren Inhalt am Ausgang data weiter. CSV-Zeilen werden zu Objekten; Werte bleiben Text.')}</p></section>
              <section><h3>{t('Ansichts-Node')}</h3><p>{t('Visualisiert verbundene Daten als Tabelle, JSON oder Diagramm. Verbinde data und führe den Workflow aus; Ansicht und Diagrammoptionen kannst du danach wechseln.')}</p></section>
              <section><h3>{t('Collector')}</h3><p>{t('Fasst verbundene Eingänge unter ihren Namen zu einem Objekt zusammen und gibt es über data aus. Punkt- und Array-Pfade wie user.name werden unterstützt.')}</p></section>
              <div className="help-tip">{t('Ziehe eine Verbindung vom Ausgang rechts zu einem Eingang links. Nodes lassen sich auch über das Kontextmenü der Arbeitsfläche hinzufügen.')}</div>
            </div>
          ))}
        </aside>
        <ReactFlow
          nodes={wiredNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onBeforeDelete={beforeDelete}
          onConnect={handleConnect}
          onConnectEnd={handleConnectEnd}
          isValidConnection={isValidConnection}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.2}
          maxZoom={1.5}
          deleteKeyCode={busy ? null : ['Backspace', 'Delete']}
          defaultEdgeOptions={{ animated: true }}
          ariaLabelConfig={{
            'controls.ariaLabel': t('Ansichtssteuerung'),
            'controls.zoomIn.ariaLabel': t('Vergrößern'),
            'controls.zoomOut.ariaLabel': t('Verkleinern'),
            'controls.fitView.ariaLabel': t('Ansicht einpassen'),
            'controls.interactive.ariaLabel': t('Interaktivität umschalten'),
            'minimap.ariaLabel': t('Miniaturansicht'),
            'handle.ariaLabel': t('Verbindungspunkt'),
            'node.a11yDescription.default': t('Mit Enter oder Leertaste auswählen, mit den Pfeiltasten verschieben, mit Entf löschen und mit Escape abwählen.'),
            'node.a11yDescription.keyboardDisabled': t('Mit Enter oder Leertaste auswählen, mit Entf löschen und mit Escape abwählen.'),
            'edge.a11yDescription.default': t('Mit Enter oder Leertaste auswählen, mit Entf löschen und mit Escape abwählen.'),
            'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) => {
              const directions: Record<string, string> = { up: 'oben', down: 'unten', left: 'links', right: 'rechts' };
              return t('Node nach {0} verschoben. Neue Position: x {1}, y {2}.', t(directions[direction] ?? direction), x, y);
            },
          }}
        >
          <Background color={theme === 'dark' ? '#272a33' : '#d9deea'} gap={22} size={1} />
          <Controls />
          <MiniMap
            nodeColor={(node) => node.data.status === 'error' ? '#e87979' : node.data.status === 'success' ? '#58cda2' : '#5965b9'}
            maskColor="rgba(13, 15, 20, 0.72)"
          />
        </ReactFlow>
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="canvas-context-menu"
            role="menu"
            aria-label={contextMenu.nodeId ? t('Node-Farbe auswählen') : t('Node hinzufügen')}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.nodeId ? nodeColors.map((color) => (
              <button key={color.name} role="menuitem" onClick={() => {
                if (contextMenu.nodeId) updateNode(contextMenu.nodeId, { color: color.value });
                setContextMenu(null);
              }}>
                <span className="node-color-swatch" style={{ background: color.value || 'var(--surface)' }} />
                {t(color.name)}
              </button>
            )) : <>
            <button role="menuitem" autoFocus onClick={() => addContextNode('code')}><Plus size={14} /> Node</button>
            {!contextMenu.output && <button role="menuitem" onClick={() => addContextNode('value')}><Plus size={14} /> {t('Werte')}</button>}
            {!contextMenu.output && <button role="menuitem" onClick={() => addContextNode('file')}><Plus size={14} /> {t('Datei (JSON / CSV)')}</button>}
            <button role="menuitem" onClick={() => addContextNode('show')}><Plus size={14} /> Show</button>
            <button role="menuitem" onClick={() => addContextNode('debug')}><Plus size={14} /> Debug</button>
            <button role="menuitem" onClick={() => addContextNode('view')}><Plus size={14} /> {t('Ansicht (Tabelle / JSON / Diagramm)')}</button>
            <button role="menuitem" onClick={() => addContextNode('collector')}><Plus size={14} /> Collector</button>
            </>}
          </div>
        )}
      </section>
      <footer className="statusbar"><div className="notice">{renderText(notice)}</div><div className="status-right"><span>JAVASCRIPT</span><span className="meta-separator">·</span><span>{t('LOKALES PROJEKT · V1')}</span></div></footer>
      <dialog
        ref={deleteDialog}
        className="delete-dialog"
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
        onCancel={(event) => {
          event.preventDefault();
          resolveDelete(false);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div className="delete-dialog-icon"><Trash2 size={24} /></div>
        <h2 id="delete-dialog-title">{deleteRequest?.length === 1 ? t('Node löschen?') : t('Nodes löschen?')}</h2>
        <p id="delete-dialog-description">
          {t('Die Inhalte und zugehörigen Verbindungen werden unwiderruflich gelöscht.')}
        </p>
        <ul className="delete-dialog-nodes">
          {deleteRequest?.map((node) => (
            <li key={node.id}>{node.type === 'show' ? 'SHOW' : node.type === 'debug' ? 'DEBUG' : node.data.title || node.id}</li>
          ))}
        </ul>
        <div className="delete-dialog-actions">
          <button className="toolbar-button" autoFocus onClick={() => resolveDelete(false)}>{t('Abbrechen')}</button>
          <button className="delete-confirm-button" onClick={() => resolveDelete(true)}><Trash2 size={14} /> {t('Löschen')}</button>
        </div>
      </dialog>
    </main>
  );
}
