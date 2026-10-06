import { LevelId, ServiceId } from './types';

export interface LogTemplate {
  level: LevelId;
  text: string;
  /** Restrict to these services; undefined means any. */
  only?: ServiceId[];
  /** Weight multiplier used while a service is in an incident. */
  incident?: boolean;
}

export const TEMPLATES: LogTemplate[] = [
  { level: 'debug', text: 'cache lookup miss, falling back to origin' },
  { level: 'debug', text: 'connection pool stats sampled' },
  { level: 'debug', text: 'feature flag evaluation completed' },
  { level: 'debug', text: 'serializer reused buffer from pool' },
  { level: 'debug', text: 'retry budget check passed' },
  { level: 'info', text: 'request completed' },
  { level: 'info', text: 'request completed' },
  { level: 'info', text: 'request completed' },
  { level: 'info', text: 'session validated' , only: ['auth', 'gateway']},
  { level: 'info', text: 'cart updated', only: ['checkout'] },
  { level: 'info', text: 'order created', only: ['checkout', 'orders-db'] },
  { level: 'info', text: 'payment authorized', only: ['payments'] },
  { level: 'info', text: 'stock reserved', only: ['inventory'] },
  { level: 'info', text: 'search index shard refreshed', only: ['search'] },
  { level: 'info', text: 'email notification enqueued', only: ['notifications'] },
  { level: 'info', text: 'checkpoint completed', only: ['orders-db'] },
  { level: 'info', text: 'health check ok' },
  { level: 'warn', text: 'slow downstream call detected' },
  { level: 'warn', text: 'retrying request after transient failure' },
  { level: 'warn', text: 'rate limit approaching for client', only: ['gateway', 'auth'] },
  { level: 'warn', text: 'queue depth above soft limit', only: ['notifications', 'payments', 'checkout'] },
  { level: 'warn', text: 'connection pool near capacity' },
  { level: 'warn', text: 'retry attempt exceeded backoff budget', incident: true },
  { level: 'warn', text: 'latency above SLO for 95th percentile', incident: true },
  { level: 'error', text: 'upstream timeout calling payments after 3000ms', only: ['checkout'], incident: true },
  { level: 'error', text: 'upstream timeout calling inventory after 3000ms', only: ['checkout', 'search'], incident: true },
  { level: 'error', text: 'deadline exceeded while waiting for downstream response', incident: true },
  { level: 'error', text: 'request timeout: retry limit reached', incident: true },
  { level: 'error', text: 'connection pool exhausted, request rejected', incident: true },
  { level: 'error', text: 'card authorization timeout from acquirer', only: ['payments'], incident: true },
  { level: 'error', text: 'database connection reset by peer' },
  { level: 'error', text: 'unhandled exception in request handler' },
  { level: 'error', text: 'invalid token signature', only: ['auth', 'gateway'] },
  { level: 'error', text: 'failed to publish message to broker', only: ['notifications', 'checkout'] },
  { level: 'error', text: 'out of memory: allocation failed, restarting worker', only: ['search', 'inventory', 'notifications', 'auth'] },
  { level: 'error', text: 'circuit breaker open for downstream' },
  { level: 'error', text: 'deadlock detected, transaction rolled back', only: ['orders-db'] },
];

export const TEMPLATE_LOWER = TEMPLATES.map((t) => t.text.toLowerCase());
