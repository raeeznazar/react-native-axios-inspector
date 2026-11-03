export type ConsoleLevel = "log" | "info" | "warn" | "error";

export interface ConsoleLogEntry {
  id: number;
  level: ConsoleLevel;
  message: string;
  timestamp: number;
}

const MAX_ENTRIES = 200;

let logs: ConsoleLogEntry[] = [];
let nextId = 1;
const listeners = new Set<(logs: ConsoleLogEntry[]) => void>();

function notify(): void {
  for (const listener of listeners) listener(logs);
}

export function addConsoleLog(level: ConsoleLevel, message: string): number {
  const id = nextId++;
  logs = [{ id, level, message, timestamp: Date.now() }, ...logs].slice(
    0,
    MAX_ENTRIES,
  );
  notify();
  return id;
}

export function clearConsoleLogs(): void {
  logs = [];
  notify();
}

export function getConsoleLogs(): ConsoleLogEntry[] {
  return logs;
}

/** Returns an unsubscribe function. */
export function subscribeConsoleLogs(
  listener: (logs: ConsoleLogEntry[]) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
