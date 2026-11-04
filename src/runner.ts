import { LocalizedError } from './i18n';
import { instrumentDebugCalls } from './ports';

export interface ExecutionError {
  name: string;
  message: string;
  stack?: string;
  code?: 'invalid-return';
}

export interface ExecutionLog {
  id: string;
  kind: 'debug' | 'show';
  label?: string;
  value: string;
}

export function executeCode(
  code: string,
  inputs: Record<string, unknown>,
  onLog: (log: ExecutionLog) => void,
  timeoutMs = 10_000,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const id = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new LocalizedError('Ausführungszeitlimit von {0} Sekunden überschritten.', timeoutMs / 1000));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };

    worker.addEventListener('message', (event: MessageEvent<{
      id: string;
      type: 'log' | 'result' | 'error';
      log?: ExecutionLog;
      result?: unknown;
      error?: ExecutionError;
    }>) => {
      if (event.data.id !== id) return;
      if (event.data.type === 'log' && event.data.log) {
        onLog(event.data.log);
        return;
      }
      cleanup();
      if (event.data.error) {
        const error = event.data.error.code === 'invalid-return'
          ? new LocalizedError('run(inputs) muss ein Objekt oder keinen Wert zurückgeben.')
          : new Error(event.data.error.message);
        error.name = event.data.error.name;
        if (event.data.error.stack) error.stack = event.data.error.stack;
        reject(error);
        return;
      }
      if (event.data.result === null || event.data.result === undefined) {
        resolve(null);
        return;
      }
      if (typeof event.data.result !== 'object' || Array.isArray(event.data.result)) {
        reject(new LocalizedError('run(inputs) muss ein Objekt oder keinen Wert zurückgeben.'));
        return;
      }
      resolve(event.data.result as Record<string, unknown>);
    });

    worker.addEventListener('error', (event) => {
      cleanup();
      reject(event.message ? new Error(event.message) : new LocalizedError('Der JavaScript-Worker ist fehlgeschlagen.'));
    }, { once: true });

    worker.postMessage({ id, code: instrumentDebugCalls(code), inputs });
  });
}
