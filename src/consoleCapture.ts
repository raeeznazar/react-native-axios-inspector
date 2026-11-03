import { addConsoleLog, ConsoleLevel } from "./consoleLogStore";

const METHODS: ConsoleLevel[] = ["log", "info", "warn", "error"];

type ConsoleMethod = (...args: unknown[]) => void;

let refCount = 0;
let originalMethods: Partial<Record<ConsoleLevel, ConsoleMethod>> = {};

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

/**
 * Wraps console.log/info/warn/error so every call also lands in the inspector's Console tab,
 * without changing what gets printed to Metro/terminal. Reference-counted so repeated
 * mount/unmount (e.g. Fast Refresh) can't leave the console permanently un-patched or
 * double-wrapped. Returns a function that detaches this particular attachment.
 */
export function attachConsoleCapture(): () => void {
  refCount++;
  if (refCount === 1) {
    for (const method of METHODS) {
      originalMethods[method] = console[method].bind(console);
      console[method] = (...args: unknown[]) => {
        originalMethods[method]?.(...args);
        addConsoleLog(method, formatArgs(args));
      };
    }
  }

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      for (const method of METHODS) {
        const original = originalMethods[method];
        if (original) console[method] = original;
      }
      originalMethods = {};
    }
  };
}
