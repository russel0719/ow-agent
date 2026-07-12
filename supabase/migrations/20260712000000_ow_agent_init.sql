-- ow-agent 초기 스키마
-- 스키마 분리 원칙(~/.claude/CLAUDE.md 3.1)에 따라 ow_agent 스키마 사용.
-- 적용 후 Supabase 대시보드 > Settings > API > Exposed schemas 에 ow_agent 추가 필요.
--
-- 데이터 흐름:
--   쓰기: GitHub Actions(scripts/generate_data.py) → service_role 키 (RLS 우회)
--   읽기: 브라우저(public/app.js) + 공개 API(cloudflare-worker-api) → anon 키 (RLS public read)

create schema if not exists ow_agent;

grant usage on schema ow_agent to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 최신 스냅샷 blob — 프론트가 통째로 로드하는 데이터
--   name: 'meta' | 'map_meta' | 'stadium' | 'patch' | 'last_updated'
-- ---------------------------------------------------------------------------
create table ow_agent.datasets (
  name       text primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 정규화 히스토리: 랭크별·날짜별 1행
--   heroes: 기존 meta_history[rank][date] 배열 그대로
-- ---------------------------------------------------------------------------
create table ow_agent.meta_history (
  rank          text not null,
  snapshot_date date not null,
  heroes        jsonb not null,
  primary key (rank, snapshot_date)
);

-- ---------------------------------------------------------------------------
-- 정규화 맵 히스토리: 맵별·날짜별 1행
--   entries: [{hero_id, meta_score}, ...]
-- ---------------------------------------------------------------------------
create table ow_agent.map_meta_history (
  map_id        text not null,
  snapshot_date date not null,
  entries       jsonb not null,
  primary key (map_id, snapshot_date)
);

-- ---------------------------------------------------------------------------
-- RLS: 공개 읽기 전용 (쓰기는 service_role 키가 RLS 우회)
-- ---------------------------------------------------------------------------
alter table ow_agent.datasets         enable row level security;
alter table ow_agent.meta_history      enable row level security;
alter table ow_agent.map_meta_history  enable row level security;

create policy "public read" on ow_agent.datasets        for select using (true);
create policy "public read" on ow_agent.meta_history     for select using (true);
create policy "public read" on ow_agent.map_meta_history for select using (true);

-- Data API 롤 권한 (커스텀 스키마는 명시적 GRANT 필요)
grant select on all tables in schema ow_agent to anon, authenticated;
grant all    on all tables in schema ow_agent to service_role;

-- 이후 추가되는 테이블에도 동일 권한 자동 부여
alter default privileges in schema ow_agent grant select on tables to anon, authenticated;
alter default privileges in schema ow_agent grant all    on tables to service_role;
