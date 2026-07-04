import { getDataset } from '../lib/github.js';
import { ok } from '../lib/http.js';

export async function handleHealth(request, params, query, ctx) {
  const lastUpdated = await getDataset('last_updated', ctx);
  return ok({
    status: 'ok',
    worker: 'ow-agent-api',
    version: 'v1',
    data_last_updated: lastUpdated.timestamp,
    sources: lastUpdated.sources,
    has_ban_rate: lastUpdated.has_ban_rate,
  });
}
