export interface ApiLogEntry {
  id: number;
  scope: string;
  method: string;
  url: string;
  startedAt: number;
  ms: number;
  pending: boolean;
  ok: boolean;
  status: number | string;
  message?: string;
  params?: unknown;
  body?: unknown;
  requestHeaders?: unknown;
  hasResponse: boolean;
  response?: unknown;
  responseHeaders?: unknown;
}

const MAX_ENTRIES = 200;

let logs: ApiLogEntry[] = [];
let nextId = 1;
const listeners = new Set<(logs: ApiLogEntry[]) => void>();

function notify(): void {
  for (const listener of listeners) listener(logs);
}

/** Appends a pending row and returns its id; callers patch it via updateApiLog once the call settles. */
export function addApiLog(entry: Omit<ApiLogEntry, "id">): number {
  const id = nextId++;
  logs = [{ ...entry, id }, ...logs].slice(0, MAX_ENTRIES);
  notify();
  return id;
}

export function updateApiLog(id: number, patch: Partial<ApiLogEntry>): void {
  let changed = false;
  logs = logs.map((log) => {
    if (log.id !== id) return log;
    changed = true;
    return { ...log, ...patch };
  });
  if (changed) notify();
}

export function clearApiLogs(): void {
  logs = [];
  notify();
}

export function getApiLogs(): ApiLogEntry[] {
  return logs;
}

/** Returns an unsubscribe function. */
export function subscribeApiLogs(
  listener: (logs: ApiLogEntry[]) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
