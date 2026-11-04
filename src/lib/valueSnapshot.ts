import { LocalizedError } from './i18n';
import type { ConstantValue } from './types';
import { constantValue, valuesObjectPort } from './types';
import { collectInputs } from './collector';

export function valuesInput(value: unknown): unknown {
  if (typeof value !== 'string' || !/^[\[{]/.test(value.trim())) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new LocalizedError('Der Eingang enthält ungültigen JSON-Text.');
  }
}

export function valueSnapshots(
  outputName: string,
  result: Record<string, unknown> | null,
  values: ConstantValue[],
  inputName?: string,
): ConstantValue[] {
  if (!result || !Object.prototype.hasOwnProperty.call(result, outputName)) {
    throw new LocalizedError('Bitte zuerst die Quell-Node ausführen, um einen Wert zu übernehmen.');
  }
  const names = new Set(values.map((item) => item.name.trim()));
  const snapshots: ConstantValue[] = [];
  const ancestors = new Set<object>();
  const append = (path: string, value: string, keys: string[]) => {
    const base = path.trim() || outputName.trim() || 'value';
    let name = base;
    let suffix = 2;
    while (names.has(name)) name = `${base}${suffix++}`;
    names.add(name);
    snapshots.push({ name, value, ...(inputName ? { source: { input: inputName, path: keys }, override: false } : {}) });
  };
  const visit = (value: unknown, path: string, keys: string[]) => {
    if (value === null) {
      append(path, 'null', keys);
    } else if (typeof value === 'string' || typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))) {
      append(path, String(value), keys);
    } else if (typeof value === 'object') {
      if (ancestors.has(value)) {
        throw new LocalizedError('Das Objekt enthält zyklische Referenzen und kann nicht als Konstanten übernommen werden.');
      }
      if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) {
        throw new LocalizedError('Der Wert bei „{0}“ kann nicht als Konstante übernommen werden.', path || outputName);
      }
      const entries = Array.isArray(value)
        ? Array.from(value, (item, index) => [`[${index}]`, item] as const)
        : Object.entries(value);
      if (!entries.length) {
        append(path, Array.isArray(value) ? '[]' : '{}', keys);
        return;
      }
      ancestors.add(value);
      for (const [key, item] of entries) {
        const nextPath = Array.isArray(value) ? `${path}${key}` : path ? `${path}.${key}` : key;
        visit(item, nextPath, [...keys, Array.isArray(value) ? key.slice(1, -1) : key]);
      }
      ancestors.delete(value);
    } else {
      throw new LocalizedError('Der Wert bei „{0}“ kann nicht als Konstante übernommen werden.', path || outputName);
    }
  };
  const value = valuesInput(result[outputName]);
  visit(value, typeof value === 'object' && value !== null ? '' : outputName, []);
  return snapshots;
}

export function resolveValues(values: ConstantValue[], inputs: Record<string, unknown>): {
  values: ConstantValue[];
  result: Record<string, unknown>;
} {
  const resolved = values.filter((item) => !item.source);
  const resultEntries: [string, unknown][] = resolved.map((item) => [item.name.trim(), constantValue(item.value)]);
  for (const [input, incoming] of Object.entries(inputs)) {
    const inputValue = valuesInput(incoming);
    const previous = values.filter((item) => item.source?.input === input);
    const reserved = [...resolved, ...values.filter((item) => item.source && item.source.input !== input)];
    const snapshots = valueSnapshots(input, { [input]: incoming }, reserved, input);
    for (const snapshot of snapshots) {
      const old = previous.find((item) => JSON.stringify(item.source?.path) === JSON.stringify(snapshot.source?.path));
      const item = old ? {
        ...snapshot, name: old.name, override: old.override ?? false,
        value: old.override ? old.value : snapshot.value,
      } : snapshot;
      if (resolved.some((entry) => entry.name.trim() === item.name.trim())) {
        throw new LocalizedError('Konstantennamen müssen eindeutig sein.');
      }
      let raw: unknown = inputValue;
      for (const key of snapshot.source?.path ?? []) {
        if (typeof raw !== 'object' || raw === null || !Object.prototype.hasOwnProperty.call(raw, key)) {
          throw new LocalizedError('Der Wert bei „{0}“ kann nicht als Konstante übernommen werden.', item.name);
        }
        raw = Reflect.get(raw, key);
      }
      resolved.push(item);
      resultEntries.push([item.name.trim(), item.override ? constantValue(item.value) : raw]);
    }
  }
  const object = Object.fromEntries(resultEntries);
  return {
    values: resolved,
    result: { ...object, [valuesObjectPort(resolved).name]: collectInputs(object) },
  };
}
