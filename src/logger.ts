import type {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

import { addApiLog, updateApiLog } from "./apiLogStore";

type TimedConfig = InternalAxiosRequestConfig & {
  __startedAt?: number;
  __logId?: number;
};

const DEFAULT_REDACT_KEYS = [
  "password",
  "otp",
  "token",
  "pin",
  "cvv",
  "secret",
  "authorization",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "clientsecret",
  "client_secret",
];

const DEFAULT_MAX_BODY_BYTES = 50_000;

export interface ApiInspectorOptions {
  /** Lower-cased substrings matched against object keys (headers, body, params) to mask their value. */
  redactKeys?: string[];
  /** Stored/rendered body text is truncated past this length so one large upload can't bloat memory. */
  maxBodyBytes?: number;
  /** Defaults to a dev-environment check; pass explicitly to force on/off regardless of environment. */
  enabled?: boolean;
}

type ResolvedOptions = Required<ApiInspectorOptions>;

function isDevEnvironment(): boolean {
  const g = globalThis as { __DEV__?: boolean };
  if (typeof g.__DEV__ === "boolean") return g.__DEV__;
  return typeof process !== "undefined"
    ? process.env?.NODE_ENV !== "production"
    : true;
}

function toApiUrl(
  config?: Pick<InternalAxiosRequestConfig, "baseURL" | "url">,
): string {
  return `${config?.baseURL ?? ""}${config?.url ?? ""}`;
}

/** React Native's FormData keeps fields in `_parts` ([name, value] pairs) rather than enumerable properties. */
function toLoggable(value: unknown): unknown {
  const parts = (value as { _parts?: [string, unknown][] } | null)?._parts;
  if (Array.isArray(parts)) {
    return { formData: Object.fromEntries(parts) };
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function headersToPlain(headers: unknown): unknown {
  const asHeaders = headers as { toJSON?: () => unknown } | null;
  return typeof asHeaders?.toJSON === "function" ? asHeaders.toJSON() : headers;
}

function isRedactedKey(key: string, redactKeys: string[]): boolean {
  const lower = key.toLowerCase();
  return redactKeys.some((pattern) => lower.includes(pattern));
}

function redact(
  value: unknown,
  redactKeys: string[],
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, redactKeys, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isRedactedKey(key, redactKeys)
      ? "«redacted»"
      : redact(val, redactKeys, seen);
  }
  return out;
}

function capSize(value: unknown, maxBytes: number): unknown {
  if (value === undefined) return value;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
  if (text.length <= maxBytes) return value;
  return `${text.slice(0, maxBytes)}… [truncated, ${text.length - maxBytes} more chars]`;
}

function sanitize(value: unknown, options: ResolvedOptions): unknown {
  const redacted = redact(toLoggable(value), options.redactKeys, new WeakSet());
  return capSize(redacted, options.maxBodyBytes);
}

function resolveOptions(options: ApiInspectorOptions): ResolvedOptions {
  return {
    redactKeys: options.redactKeys ?? DEFAULT_REDACT_KEYS,
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    enabled: options.enabled ?? isDevEnvironment(),
  };
}

export function logApiRequest(
  scope: string,
  config: InternalAxiosRequestConfig,
  options: ResolvedOptions,
): InternalAxiosRequestConfig {
  const timed = config as TimedConfig;
  const startedAt = Date.now();
  timed.__startedAt = startedAt;
  timed.__logId = addApiLog({
    scope,
    method: config.method?.toUpperCase() ?? "GET",
    url: toApiUrl(config),
    startedAt,
    ms: 0,
    pending: true,
    ok: false,
    status: "…",
    params: sanitize(config.params, options),
    body: sanitize(config.data, options),
    requestHeaders: sanitize(headersToPlain(config.headers), options),
    hasResponse: false,
  });
  return config;
}

export function logApiResponse(
  scope: string,
  response: AxiosResponse,
  options: ResolvedOptions,
): void {
  const timed = response.config as TimedConfig;
  if (timed.__logId === undefined) return;
  updateApiLog(timed.__logId, {
    pending: false,
    ok: true,
    status: response.status,
    ms: Date.now() - (timed.__startedAt ?? Date.now()),
    hasResponse: true,
    response: sanitize(response.data, options),
    responseHeaders: sanitize(headersToPlain(response.headers), options),
  });
}

export function logApiError(
  scope: string,
  error: AxiosError,
  options: ResolvedOptions,
): void {
  const timed = error.config as TimedConfig | undefined;
  if (timed?.__logId === undefined) return;
  updateApiLog(timed.__logId, {
    pending: false,
    ok: false,
    status: error.response?.status ?? "NO RESPONSE",
    ms: Date.now() - (timed.__startedAt ?? Date.now()),
    message: error.message,
    hasResponse: !!error.response,
    response: sanitize(error.response?.data, options),
    responseHeaders: sanitize(headersToPlain(error.response?.headers), options),
  });
}

/**
 * The only line a client needs: wires logRequest/logResponse/logError into one axios instance's
 * interceptors under `scope`. A no-op in production — interceptors are never registered when disabled,
 * so there's zero runtime cost in release builds, not just hidden logging.
 */
export function attachApiLogger(
  instance: AxiosInstance,
  scope: string,
  options: ApiInspectorOptions = {},
): void {
  const resolved = resolveOptions(options);
  if (!resolved.enabled) return;

  instance.interceptors.request.use((config) =>
    logApiRequest(scope, config, resolved),
  );
  instance.interceptors.response.use(
    (response) => {
      logApiResponse(scope, response, resolved);
      return response;
    },
    (error: AxiosError) => {
      logApiError(scope, error, resolved);
      return Promise.reject(error);
    },
  );
}
