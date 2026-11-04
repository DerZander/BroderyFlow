import { parser } from '@lezer/javascript';
import type { Port, ValueType } from './types';

const knownTypes: ValueType[] = ['number', 'string', 'boolean', 'object'];

export function returnVariableChanges(code: string, position: number, mode: 'add' | 'only' = 'add'): Array<{ from: number; to?: number; insert: string }> | null {
  const tree = parser.parse(code);
  const token = tree.resolveInner(position, -1);
  if (!['VariableName', 'VariableDefinition'].includes(token.name)) return null;
  const name = code.slice(token.from, token.to);
  const statements = children(tree.topNode);
  const declared = statements.some((statement) =>
    statement.name === 'VariableDeclaration' && children(statement).some((part) =>
      part.name === 'VariableDefinition' && code.slice(part.from, part.to) === name,
    ),
  );
  if (!declared) return null;
  for (let parent = token.parent; parent; parent = parent.parent) {
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration'].includes(parent.name)) return null;
  }
  const changes: Array<{ from: number; to?: number; insert: string }> = [];
  let hasReturn = false;
  let unsupported = false;
  const visit = (node: typeof tree.topNode) => {
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration'].includes(node.name)) return;
    if (node.type.isError) unsupported = true;
    if (node.name === 'ReturnStatement') {
      hasReturn = true;
      const object = children(node).find((part) => part.name === 'ObjectExpression');
      if (!object) {
        unsupported = true;
        return;
      }
      const parts = children(object);
      if (mode === 'only') {
        changes.push({ from: object.from, to: object.to, insert: `{ ${name} }` });
        return;
      }
      if (parts.some((part) => objectProperty(part, code)?.name === name)) return;
      const closing = object.lastChild;
      if (!closing || closing.name !== '}') {
        unsupported = true;
        return;
      }
      const previous = closing.prevSibling;
      const separator = previous?.name === '{' || previous?.name === ',' ? '' : ',';
      changes.push({ from: closing.from, insert: `${separator} ${name} ` });
    }
    for (const child of children(node)) visit(child);
  };
  visit(tree.topNode);
  if (unsupported) return null;
  if (!hasReturn) changes.push({ from: code.length, insert: `\nreturn { ${name} };` });
  return changes.length ? changes : null;
}

export function addInputVariable(code: string, name: string, beforeInput?: string): { code: string; variableName: string } {
  const expression = /^[A-Za-z_$][\w$]*$/.test(name) ? `inputs.${name}` : `inputs[${JSON.stringify(name)}]`;
  const reserved = new Set([
    'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
    'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
    'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof',
    'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public',
    'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'yield', 'eval', 'arguments', 'inputs', 'node', 'debug', 'show',
  ]);
  const definitions = new Set<string>();
  let existingVariable: string | undefined;
  let lastInputDeclaration = 0;
  let beforeDeclaration: number | undefined;
  parser.parse(code).iterate({
    enter(node) {
      if (node.name === 'VariableDefinition') definitions.add(code.slice(node.from, node.to));
      if (node.name !== 'VariableDeclaration' || node.node.parent?.name !== 'Script') return;
      const parts = children(node.node);
      const definition = parts.find((part) => part.name === 'VariableDefinition');
      const equals = parts.findIndex((part) => part.name === 'Equals' || part.name === '=');
      const value = parts[equals + 1];
      let containsInput = false;
      const visit = (part: typeof node.node) => {
        if (staticMemberName(part, code)) containsInput = true;
        if (beforeInput !== undefined && staticMemberName(part, code) === beforeInput && beforeDeclaration === undefined) {
          beforeDeclaration = node.from;
        }
        for (const child of children(part)) visit(child);
      };
      visit(node.node);
      if (containsInput) lastInputDeclaration = node.to;
      if (definition && equals >= 0 && value && code.slice(value.from, value.to) === expression) {
        existingVariable = code.slice(definition.from, definition.to);
      }
    },
  });
  if (existingVariable) return { code, variableName: existingVariable };
  const base = /^[A-Za-z_$][\w$]*$/.test(name) && !reserved.has(name) ? name : 'value';
  let variableName = base;
  let suffix = 2;
  while (definitions.has(variableName)) variableName = `${base}${suffix++}`;
  const declaration = `const ${variableName} = ${expression};`;
  if (beforeDeclaration !== undefined) {
    return {
      code: `${code.slice(0, beforeDeclaration)}${declaration}\n${code.slice(beforeDeclaration)}`,
      variableName,
    };
  }
  if (lastInputDeclaration) {
    const before = code.slice(0, lastInputDeclaration);
    const after = code.slice(lastInputDeclaration);
    return {
      code: `${before}\n${declaration}${after && !after.startsWith('\n') && !after.startsWith('\r\n') ? '\n' : ''}${after}`,
      variableName,
    };
  }
  return { code: `${declaration}${code ? `\n${code}` : ''}`, variableName };
}

function children(node: ReturnType<typeof parser.parse>['topNode']): ReturnType<typeof parser.parse>['topNode'][] {
  const result = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function mergeTypes(left: ValueType | undefined, right: ValueType): ValueType {
  return left === undefined || left === right ? right : 'any';
}

function staticMemberName(node: ReturnType<typeof parser.parse>['topNode'], code: string): string | null {
  if (node.name !== 'MemberExpression') return null;
  const parts = children(node);
  if (parts[0]?.name !== 'VariableName' || code.slice(parts[0].from, parts[0].to) !== 'inputs') return null;

  if (parts[1]?.name === '.' && parts[2]?.name === 'PropertyName') {
    return code.slice(parts[2].from, parts[2].to);
  }
  if (parts[1]?.name === '[' && parts[2]?.name === 'String') {
    try {
      return JSON.parse(code.slice(parts[2].from, parts[2].to).replace(/^'([\s\S]*)'$/, '"$1"'));
    } catch {
      return null;
    }
  }
  return null;
}

function objectProperty(
  node: ReturnType<typeof parser.parse>['topNode'],
  code: string,
): { name: string; value: ReturnType<typeof parser.parse>['topNode'] | null } | null {
  if (node.name !== 'Property') return null;
  const parts = children(node);
  const key = parts.find((part) => part.name === 'PropertyDefinition');
  if (!key) return null;
  const rawName = code.slice(key.from, key.to);
  let name = rawName;
  if (rawName.startsWith('"')) {
    try {
      name = JSON.parse(rawName);
    } catch {
      return null;
    }
  } else if (rawName.startsWith("'") && rawName.endsWith("'")) {
    name = rawName.slice(1, -1).replace(/\\(['\\])/g, '$1');
  } else if (!/^[\w$]+$/.test(rawName)) {
    return null;
  }

  const colonIndex = parts.findIndex((part) => part.name === ':');
  return { name, value: colonIndex >= 0 ? parts[colonIndex + 1] ?? null : null };
}

function inferExpressionType(
  node: ReturnType<typeof parser.parse>['topNode'] | null,
  code: string,
  inputTypes: Map<string, ValueType>,
  variables: Map<string, ValueType>,
): ValueType {
  if (!node) return 'any';
  const parts = children(node);

  if (node.name === 'ParenthesizedExpression') {
    return inferExpressionType(parts.find((part) => !['(', ')'].includes(part.name)) ?? null, code, inputTypes, variables);
  }
  if (node.name === 'Number') return 'number';
  if (node.name === 'String' || node.name === 'TemplateString') return 'string';
  if (node.name === 'BooleanLiteral') return 'boolean';
  if (node.name === 'ObjectExpression' || node.name === 'ArrayExpression') return 'object';
  if (node.name === 'VariableName') return variables.get(code.slice(node.from, node.to)) ?? 'any';
  if (node.name === 'MemberExpression') {
    const name = staticMemberName(node, code);
    return name ? inputTypes.get(name) ?? 'any' : 'any';
  }
  if (node.name === 'CallExpression') {
    const callee = parts.find((part) => part.name === 'VariableName');
    const name = callee ? code.slice(callee.from, callee.to) : '';
    if (name === 'Number') return 'number';
    if (name === 'String') return 'string';
    if (name === 'Boolean') return 'boolean';
    return 'any';
  }
  if (node.name === 'UnaryExpression') {
    const operator = parts[0]?.name;
    if (operator === '!') return 'boolean';
    if (['+', '-', '~'].includes(operator ?? '')) return 'number';
    return 'any';
  }
  if (node.name === 'BinaryExpression') {
    const operator = parts.find((part) => ['ArithOp', 'CompareOp', 'LogicOp', 'BitOp', 'in', 'instanceof'].includes(part.name));
    const left = inferExpressionType(parts[0] ?? null, code, inputTypes, variables);
    const right = inferExpressionType(parts[parts.length - 1] ?? null, code, inputTypes, variables);
    const operatorText = operator ? code.slice(operator.from, operator.to) : '';
    if (['==', '===', '!=', '!==', '<', '>', '<=', '>=', 'in', 'instanceof'].includes(operatorText)) return 'boolean';
    if (operatorText === '+' && (left === 'string' || right === 'string')) return 'string';
    if (['+', '-', '*', '/', '%', '**'].includes(operatorText) && left === 'number' && right === 'number') return 'number';
    return 'any';
  }
  if (node.name === 'ConditionalExpression') {
    const consequent = inferExpressionType(parts[2] ?? null, code, inputTypes, variables);
    const alternate = inferExpressionType(parts[4] ?? null, code, inputTypes, variables);
    return consequent === alternate ? consequent : 'any';
  }
  return 'any';
}

export function inferPorts(code: string, previousInputs: Port[] = []): { inputs: Port[]; outputs: Port[] } | null {
  const tree = parser.parse(code);
  let hasSyntaxError = false;
  const inputTypes = new Map<string, ValueType>();
  const variables = new Map<string, ValueType>();
  const outputTypes = new Map<string, ValueType>();

  tree.iterate({
    enter(node) {
      if (node.name === '⚠') hasSyntaxError = true;
    },
  });
  if (hasSyntaxError) return null;

  const visitInputs = (node: ReturnType<typeof parser.parse>['topNode'], hint?: ValueType) => {
    const name = staticMemberName(node, code);
    if (name) {
      inputTypes.set(name, mergeTypes(inputTypes.get(name), hint ?? 'any'));
      return;
    }
    const parts = children(node);
    if (node.name === 'CallExpression') {
      const callee = parts.find((part) => part.name === 'VariableName');
      const functionName = callee ? code.slice(callee.from, callee.to) : '';
      const cast = functionName === 'Number' ? 'number' : functionName === 'String' ? 'string' : functionName === 'Boolean' ? 'boolean' : undefined;
      for (const part of parts) visitInputs(part, cast ?? hint);
      return;
    }
    for (const part of parts) visitInputs(part, hint);
  };

  const collectReturns = (node: ReturnType<typeof parser.parse>['topNode'], functionDepth = 0) => {
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration'].includes(node.name)) {
      for (const part of children(node)) collectReturns(part, functionDepth + 1);
      return;
    }
    const parts = children(node);
    if (node.name === 'VariableDeclaration') {
      const definition = parts.find((part) => part.name === 'VariableDefinition');
      const equals = parts.findIndex((part) => part.name === 'Equals' || part.name === '=');
      const name = definition ? code.slice(definition.from, definition.to) : '';
      const value = equals >= 0 ? parts[equals + 1] : null;
      if (name && value) variables.set(name, inferExpressionType(value, code, inputTypes, variables));
    }
    if (node.name === 'ReturnStatement' && functionDepth === 0) {
      const returned = parts.find((part) => part.name === 'ObjectExpression');
      if (returned) {
        for (const property of children(returned)) {
          const entry = objectProperty(property, code);
          if (!entry) continue;
          const type = entry.value
            ? inferExpressionType(entry.value, code, inputTypes, variables)
            : variables.get(entry.name) ?? 'any';
          outputTypes.set(entry.name, mergeTypes(outputTypes.get(entry.name), type));
        }
      }
    }
    for (const part of parts) collectReturns(part, functionDepth);
  };

  visitInputs(tree.topNode);
  collectReturns(tree.topNode);

  const previous = new Map(previousInputs.map((port) => [port.name, port]));
  const inputs = [...inputTypes].map(([name, type]) => ({
    name,
    type: type === 'any' ? previous.get(name)?.type ?? 'any' : type,
    defaultValue: previous.get(name)?.defaultValue ?? '',
  }));
  const outputs = [...outputTypes].map(([name, type]) => ({ name, type }));
  return { inputs, outputs };
}

export function instrumentDebugCalls(code: string): string {
  const tree = parser.parse(code);
  let hasSyntaxError = false;
  const insertions: Array<{ position: number; text: string }> = [];
  tree.iterate({
    enter(node) {
      if (node.name === '⚠') hasSyntaxError = true;
    },
  });
  if (hasSyntaxError) return code;

  const visit = (node: ReturnType<typeof parser.parse>['topNode']) => {
    const parts = children(node);
    if (node.name === 'CallExpression') {
      const callee = parts.find((part) => part.name === 'VariableName');
      const args = parts.find((part) => part.name === 'ArgList');
      if (callee && args && code.slice(callee.from, callee.to) === 'debug') {
        const arg = children(args).find((part) => !['(', ')', ','].includes(part.name));
        if (arg) insertions.push({ position: arg.from, text: `${JSON.stringify(code.slice(arg.from, arg.to))}, ` });
      }
    }
    for (const part of parts) visit(part);
  };
  visit(tree.topNode);
  return insertions.sort((left, right) => right.position - left.position)
    .reduce((source, insertion) => `${source.slice(0, insertion.position)}${insertion.text}${source.slice(insertion.position)}`, code);
}

export function isPortType(value: unknown): value is ValueType {
  return typeof value === 'string' && (knownTypes.includes(value as ValueType) || value === 'any');
}
