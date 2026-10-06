import { mulberry32 } from './prng';
import { Deploy, NOW0, ServiceId, SERVICES, Scenario } from './types';

const CULPRITS: ServiceId[] = ['checkout', 'payments', 'search', 'inventory'];
const BURSTS: ServiceId[] = ['auth', 'notifications', 'gateway'];
const LEAKS: ServiceId[] = ['notifications', 'inventory', 'search', 'auth'];
const AUTHORS = ['Maya Chen', 'Dev Patel', 'Lena Ortiz', 'Sam Okafor', 'Ivo Novak', 'Rae Kim'];
const MESSAGES = [
  'Bump http client, tune pool size',
  'Refactor retry policy',
  'Feature flag: new pricing path',
  'Upgrade runtime, minor fixes',
  'Add request-level caching',
  'Migrate config to v3 schema',
  'Hotfix: null guard on cart payload',
];

/** Pure: the same seed always produces the same story. */
export function makeScenario(seed: number): Scenario {
  const r = mulberry32(seed * 7919 + 13);
  const culprit = CULPRITS[(seed - 1 + 4000) % CULPRITS.length];
  const leakPool = LEAKS.filter((s) => s !== culprit);
  const leak = leakPool[Math.floor(r() * leakPool.length)];
  const burstPool = BURSTS.filter((s) => s !== leak);
  const burst = burstPool[Math.floor(r() * burstPool.length)];

  const culpritDeployTs = NOW0 - Math.round((34 + r() * 14) * 60_000);
  const burstStart = NOW0 - Math.round((3 + r() * 1.5) * 3600_000);

  const deploys: Deploy[] = [];
  let n = 0;
  const ver: Record<string, number> = {};
  for (const s of SERVICES) ver[s] = 3 + Math.floor(r() * 9);
  for (const s of SERVICES) {
    const count = 3 + Math.floor(r() * 4);
    for (let k = 0; k < count; k++) {
      const ts = NOW0 - Math.round((1.5 + r() * 25) * 3600_000);
      // keep the story clear: no unrelated deploys right before the culprit deploy
      if (s === culprit && Math.abs(ts - culpritDeployTs) < 3 * 3600_000) continue;
      deploys.push({
        id: `d${n++}`,
        ts,
        service: s,
        version: '',
        author: AUTHORS[Math.floor(r() * AUTHORS.length)],
        message: MESSAGES[Math.floor(r() * MESSAGES.length)],
        kind: 'deploy',
      });
    }
  }
  deploys.sort((a, b) => a.ts - b.ts);
  // assign versions in chronological order
  for (const d of deploys) d.version = `v${Math.floor(ver[d.service] / 4) + 1}.${ver[d.service]++ % 4 * 3 + 1}.0`;
  const culpritVersion = `v${Math.floor(ver[culprit] / 4) + 1}.${ver[culprit]++ % 4 * 3 + 1}.0`;
  deploys.push({
    id: 'd-culprit',
    ts: culpritDeployTs,
    service: culprit,
    version: culpritVersion,
    author: 'Dev Patel',
    message: 'Add retry-with-backoff to downstream client',
    kind: 'deploy',
  });
  deploys.sort((a, b) => a.ts - b.ts);

  return {
    seed,
    culprit,
    culpritDeployTs,
    burst: { service: burst, start: burstStart, end: burstStart + Math.round((9 + r() * 6) * 60_000) },
    leak: { service: leak, start: NOW0 - Math.round(5.4 * 3600_000) },
    deploys,
  };
}
