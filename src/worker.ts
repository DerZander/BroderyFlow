interface RunMessage {
  id: string;
  code: string;
  inputs: Record<string, unknown>;
}

type DebugFunction = (label: string, value: unknown) => unknown;
type ShowFunction = (value: unknown) => unknown;

self.addEventListener('message', async (event: MessageEvent<RunMessage>) => {
  const { id, code, inputs } = event.data;
  const publish = (kind: 'debug' | 'show', label: string | undefined, value: unknown) => {
    let displayValue: string;
    try {
      displayValue = JSON.stringify(value, null, 2) ?? String(value);
    } catch {
      displayValue = String(value);
    }
    self.postMessage({ id, type: 'log', log: { id: crypto.randomUUID(), kind, label, value: displayValue } });
  };
  const debug: DebugFunction = (label, value) => {
    publish('debug', label, value);
    return value;
  };
  const show: ShowFunction = (value) => {
    publish('show', undefined, value);
    return value;
  };
  try {
    const execute = new Function(
      'inputs',
      'node',
      'debug',
      'show',
      `"use strict"; return (async () => {\n${code}\n})();`,
    ) as (nodeInputs: Record<string, unknown>, nodeApi: { run: () => undefined }, debug: DebugFunction, show: ShowFunction) => Promise<unknown>;
    const result = await execute(inputs, { run: () => undefined }, debug, show);
    if (result === null || result === undefined) {
      self.postMessage({ id, type: 'result', result: null });
    } else if (typeof result === 'object' && !Array.isArray(result)) {
      self.postMessage({ id, type: 'result', result });
    } else {
      self.postMessage({
        id,
        type: 'error',
        error: {
          name: 'Error',
          code: 'invalid-return',
          message: 'run(inputs) must return an object or no value.',
        },
      });
    }
  } catch (error) {
    const exception = error instanceof Error ? error : new Error(String(error));
    self.postMessage({
      id,
      type: 'error',
      error: { name: exception.name, message: exception.message, stack: exception.stack },
    });
  }
});
