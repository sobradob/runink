/**
 * Structured JSON logger for server-side observability.
 *
 * Every render-path log line is a single JSON object emitted to stdout (info)
 * or stderr (warn/error). DigitalOcean's log drain captures this and lets us
 * search by field — no Sentry / Datadog dependency required.
 *
 * Shape is deliberately small and stable. If you add a field, add it here
 * once rather than sprinkling ad-hoc properties across call sites.
 */
import { randomUUID } from 'crypto';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  /** Where the log was emitted from, e.g. 'render.order', 'render.health'. */
  scope: string;
  /** A request-scoped UUID. Surfaced to clients in error responses so
   *  customer support can correlate an email with a server log line. */
  requestId?: string;
  /** Stable identifiers for grep-ability. */
  orderId?: string;
  token?: string;
  /** Outcome of the operation. */
  outcome?: 'ok' | 'error' | 'rejected' | 'timeout';
  /** Wall-clock milliseconds for the operation. */
  durationMs?: number;
  /** Sizes — payload bytes in, PNG bytes out. */
  payloadBytes?: number;
  bufferBytes?: number;
  /** Free-form extra context. Keep keys short and consistent. */
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields: LogFields): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  });
  if (level === 'info') {
    console.log(line);
  } else {
    console.error(line);
  }
}

export const log = {
  info(message: string, fields: LogFields): void {
    emit('info', message, fields);
  },
  warn(message: string, fields: LogFields): void {
    emit('warn', message, fields);
  },
  error(message: string, fields: LogFields): void {
    emit('error', message, fields);
  },
};

/** Generate a request ID for correlating client → server → background work. */
export function newRequestId(): string {
  return randomUUID();
}
