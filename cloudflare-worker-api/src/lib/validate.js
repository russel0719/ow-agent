export const RANK_ALIASES = {
  all: '전체',
  bronze: '브론즈',
  silver: '실버',
  gold: '골드',
  platinum: '플래티넘',
  diamond: '다이아몬드',
  master: '마스터',
  grandmaster: '그랜드마스터',
  champion: '챔피언',
};

export const RANKS = new Set(Object.values(RANK_ALIASES));

// meta_history.json에는 '챔피언'이 없음 (그랜드마스터와 동일해서 미저장)
export const HISTORY_RANKS = new Set([...RANKS].filter((r) => r !== '챔피언'));

export const ROLES = new Set(['tank', 'damage', 'support']);

export function resolveRank(input) {
  if (!input) return '전체';
  const lower = input.toLowerCase();
  if (RANK_ALIASES[lower]) return RANK_ALIASES[lower];
  if (RANKS.has(input)) return input;
  return null;
}

export function isValidRole(role) {
  return role == null || ROLES.has(role);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value) {
  if (value == null) return true;
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}
