import { Schema } from './query/evaluator';
import { HOSTS, LEVELS, REGIONS, SERVICES } from '../shared/types';
import { TEMPLATE_LOWER } from '../shared/logTemplates';

export const LOG_SCHEMA: Schema = {
  service: { kind: 'enum', values: SERVICES, doc: 'emitting service' },
  level: { kind: 'enum', values: LEVELS, doc: 'debug, info, warn, error' },
  region: { kind: 'enum', values: REGIONS, doc: 'deployment region' },
  host: { kind: 'enum', values: HOSTS, doc: 'host instance' },
  status: { kind: 'number', doc: 'HTTP status code' },
  latency: { kind: 'number', doc: 'request latency in ms' },
  msg: { kind: 'text', doc: 'message text contains' },
};

/** Per query: which message templates contain a term (cached per term). */
export function templateMatcher(termLower: string): Uint8Array {
  const m = new Uint8Array(TEMPLATE_LOWER.length);
  for (let i = 0; i < TEMPLATE_LOWER.length; i++) if (TEMPLATE_LOWER[i].includes(termLower)) m[i] = 1;
  return m;
}
