import { t, type LocalizedText } from './i18n';
import type { Edge, Node } from '@xyflow/react';
import { inferPorts } from './ports';
import type { ImportedFile } from './files';
import { defaultViewSettings, type ViewSettings } from './visualization';

export const VALUE_TYPES = ['number', 'string', 'boolean', 'object', 'any'] as const;
export type ValueType = (typeof VALUE_TYPES)[number];
export type NodeStatus = 'ready' | 'changed' | 'running' | 'success' | 'error';

export interface Port {
  name: string;
  type: ValueType;
  defaultValue?: string;
}

export interface ConstantValue {
  name: string;
  value: string;
  source?: { input: string; path: string[] };
  override?: boolean;
}

export interface NodeLog {
  id: string;
  kind: 'debug' | 'show';
  label?: string;
  value: string;
}

export interface NodeData extends Record<string, unknown> {
  title: string;
  color?: string;
  code: string;
  values: ConstantValue[];
  file?: ImportedFile;
  view?: ViewSettings;
  inputs: Port[];
  outputs: Port[];
  status: NodeStatus;
  result: Record<string, unknown> | null;
  logs: NodeLog[];
  error: LocalizedText | null;
  onChange: (id: string, patch: Partial<NodeData>) => void;
  onRemoveLog: (id: string, logId: string) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: (id: string) => void;
}

export type CanvasNode = Node<NodeData, 'code' | 'value' | 'condition' | 'show' | 'debug' | 'file' | 'view' | 'collector'>;
export type CanvasEdge = Edge;

export interface ProjectNode {
  id: string;
  type: 'code' | 'value' | 'condition' | 'show' | 'debug' | 'file' | 'view' | 'collector';
  title: string;
  color?: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  code: string;
  inputs: Port[];
  outputs: Port[];
  values?: ConstantValue[];
  file?: ImportedFile;
  view?: ViewSettings;
}

export interface ProjectFile {
  version: 1;
  name: string;
  nodes: ProjectNode[];
  edges: CanvasEdge[];
}

export const DEFAULT_CODE = '';

export function normalizeCode(code: string): string {
  const match = code.match(/^\s*(?:async\s+)?function\s+run\s*\(\s*inputs\s*\)\s*\{([\s\S]*)\}\s*;?\s*$/);
  if (!match) return code;

  const lines = match[1].split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const indentation = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(indentation)).join('\n');
}

export function createNodeData(
  overrides: Partial<Pick<NodeData, 'title' | 'code' | 'inputs' | 'outputs' | 'values'>> = {},
): NodeData {
  const code = overrides.code ?? DEFAULT_CODE;
  const inputs = overrides.inputs ?? [];
  const inferred = inferPorts(code, inputs);
  return {
    title: overrides.title ?? '',
    code,
    values: overrides.values ?? [],
    inputs: inferred?.inputs ?? inputs,
    outputs: inferred?.outputs ?? overrides.outputs ?? [],
    status: 'ready',
    result: null,
    logs: [],
    error: null,
    onChange: () => undefined,
    onRemoveLog: () => undefined,
    onRun: () => undefined,
    onDelete: () => undefined,
    onClear: () => undefined,
  };
}

export function inferConstantType(value: string): ValueType {
  const trimmed = value.trim();
  if (trimmed === 'true' || trimmed === 'false') return 'boolean';
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return 'number';
  return 'string';
}

export function constantValue(value: string): string | number | boolean {
  const type = inferConstantType(value);
  if (type === 'boolean') return value.trim() === 'true';
  if (type === 'number') return Number(value.trim());
  return value;
}

export function createValueNodeData(
  values: ConstantValue[] = [],
  title = t('Werte'),
  inputs: Port[] = [],
): NodeData {
  const outputs: Port[] = [];
  const names = new Set<string>();
  for (const item of values) {
    const name = item.name.trim();
    if (!name || names.has(name)) continue;
    names.add(name);
    outputs.push({ name, type: item.source ? 'any' : inferConstantType(item.value) });
  }
  outputs.push(valuesObjectPort(values));
  return {
    ...createNodeData({ title, outputs, values }),
    inputs,
    outputs,
  };
}

export function valuesObjectPort(values: ConstantValue[]): Port {
  const names = new Set(values.map((item) => item.name.trim()));
  let name = 'allValues';
  let suffix = 2;
  while (names.has(name)) name = `allValues${suffix++}`;
  return { name, type: 'object' };
}

export function createConditionNodeData(
  expression = '',
  title = t('Bedingung'),
  previousInputs: Port[] = [],
): NodeData {
  const inferred = inferPorts(`return { result: (${expression}) };`, previousInputs);
  const outputs: Port[] = [
    { name: 'true', type: 'boolean' },
    { name: 'false', type: 'boolean' },
  ];
  return {
    ...createNodeData({ title, code: expression, inputs: inferred?.inputs ?? previousInputs, outputs }),
    code: expression,
    inputs: inferred?.inputs ?? previousInputs,
    outputs,
  };
}

export function createDisplayNodeData(title: string, inputs: Port[] = []): NodeData {
  return { ...createNodeData({ title }), inputs, outputs: [] };
}

export function createFileNodeData(title: string, file?: ImportedFile, outputName = 'data'): NodeData {
  return {
    ...createNodeData({ title }),
    file,
    outputs: [{ name: outputName, type: 'any' }],
  };
}

export function createViewNodeData(title: string, view: ViewSettings = defaultViewSettings): NodeData {
  return {
    ...createNodeData({ title }),
    inputs: [{ name: 'data', type: 'any' }],
    outputs: [],
    view: { ...view },
  };
}

export function createCollectorNodeData(title: string, inputs: Port[] = []): NodeData {
  return {
    ...createNodeData({ title }),
    inputs,
    outputs: [{ name: 'data', type: 'object' }],
  };
}

export function isValueType(value: unknown, type: ValueType): boolean {
  if (value === undefined) return false;
  if (type === 'any') return true;
  if (value === null) return false;
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return typeof value === 'object';
  }
}
