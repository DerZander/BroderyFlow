import { LocalizedError } from './i18n';

type PathPart = string | number;
interface PathNode {
  children: Map<PathPart, PathNode>;
  assigned: boolean;
  value?: unknown;
}

function parsePath(name: string): PathPart[] {
  const first = /^[^.[\]]+/.exec(name);
  if (!first) throw new LocalizedError('Ungültiger Collector-Pfad: „{0}“.', name);
  const parts: PathPart[] = [first[0]];
  let rest = name.slice(first[0].length);
  while (rest) {
    const property = /^\.(?<key>[^.[\]]+)/.exec(rest);
    const index = /^\[(0|[1-9]\d*)\]/.exec(rest);
    if (property) {
      parts.push(property[1]);
      rest = rest.slice(property[0].length);
    } else if (index && Number(index[1]) < 4_294_967_295) {
      parts.push(Number(index[1]));
      rest = rest.slice(index[0].length);
    } else {
      throw new LocalizedError('Ungültiger Collector-Pfad: „{0}“.', name);
    }
  }
  return parts;
}

export function collectInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const root: PathNode = { children: new Map(), assigned: false };
  for (const [name, value] of Object.entries(inputs)) {
    let node = root;
    for (const part of parsePath(name)) {
      const firstKey = node.children.keys().next();
      if (node.assigned || (!firstKey.done && typeof firstKey.value !== typeof part)) {
        throw new LocalizedError('Widersprüchliche Collector-Pfade bei „{0}“.', name);
      }
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map(), assigned: false };
        node.children.set(part, child);
      }
      node = child;
    }
    if (node.assigned || node.children.size) {
      throw new LocalizedError('Widersprüchliche Collector-Pfade bei „{0}“.', name);
    }
    node.assigned = true;
    node.value = value;
  }
  const materialize = (node: PathNode): unknown => {
    if (node.assigned) return node.value;
    const entries = [...node.children].map(([key, child]) => [key, materialize(child)] as const);
    if (typeof entries[0]?.[0] === 'number') {
      return entries.sort(([a], [b]) => Number(a) - Number(b)).map(([, value]) => value);
    }
    return Object.fromEntries(entries);
  };
  return Object.fromEntries([...root.children].map(([key, child]) => [key, materialize(child)]));
}
