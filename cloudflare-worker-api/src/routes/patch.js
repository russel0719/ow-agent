import { getDataset } from '../lib/github.js';
import { ok, notFound, badRequest } from '../lib/http.js';

export async function handlePatchList(request, params, query, ctx, env) {
  const limitParam = query.get('limit');
  let limit = null;
  if (limitParam != null) {
    limit = Number(limitParam);
    if (!Number.isInteger(limit) || limit <= 0) {
      return badRequest('invalid_limit', `limit은 양의 정수여야 합니다: '${limitParam}'`);
    }
  }

  const patches = await getDataset('patch', ctx, env);
  const list = limit ? patches.slice(0, limit) : patches;
  return ok(list, { count: list.length });
}

export async function handlePatchLatest(request, params, query, ctx, env) {
  const patches = await getDataset('patch', ctx, env);
  if (patches.length === 0) {
    return notFound('patch_not_found', '패치노트 데이터가 없습니다.');
  }
  return ok(patches[0]);
}
