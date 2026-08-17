-- ============================================================
-- 语巢 · Language Nest —— 数据库结构（阶段 1：笔记核心）
-- ============================================================
-- 怎么用：
--   1. 打开 Supabase 控制台 → 左侧「SQL Editor」→ New query
--   2. 把本文件全部内容粘贴进去 → 点右下角 Run
--   3. 看到绿色「Success」就完成了（可重复运行，脚本是幂等的）
-- ============================================================

-- uuid 生成函数（确保可用）
create extension if not exists "pgcrypto";

-- ============================================================
-- 表 1：文件夹 folders（可嵌套，先只用一层）
-- ============================================================
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  name       text not null,
  parent_id  uuid references public.folders(id) on delete cascade,
  position   int  not null default 0,
  color      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ============================================================
-- 表 2：笔记 notes
--   content      富文本内容（TipTap JSON）
--   content_text 纯文本（供搜索、粘贴识别用）
-- ============================================================
create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  folder_id    uuid references public.folders(id) on delete set null,
  title        text not null default '',
  content      jsonb,
  content_text text,
  source_type  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- ============================================================
-- 表 3：卡片 cards（挂在某篇笔记下，也可独立）
-- ============================================================
create table if not exists public.cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  note_id     uuid references public.notes(id) on delete cascade,
  front       text not null,
  back        text,
  front_audio text,
  back_audio  text,
  tags        text[],
  kind        text,                    -- 'word' 生词 / 'example' 例句（精读分两个合集）
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- 给已存在的库补 kind 列（幂等；新建库上面的 create table 已含）
alter table public.cards add column if not exists kind text;

-- ============================================================
-- 表 4：复习状态 review_state（SM-2 间隔重复，每张卡一条）
-- ============================================================
create table if not exists public.review_state (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  card_id       uuid not null references public.cards(id) on delete cascade,
  ease          float not null default 2.5,   -- 难度系数（SM-2 的 EF）
  interval_days float not null default 0,     -- 当前间隔（天）
  reps          int  not null default 0,      -- 连续答对次数
  lapses        int  not null default 0,      -- 忘记次数
  due_at        timestamptz not null default now(), -- 下次到期
  last_rating   int,                          -- 上次评分 1-4
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, card_id)
);

-- ============================================================
-- 表 5：用户设置 user_settings（每日复习目标、复习提醒等）
-- ============================================================
create table if not exists public.user_settings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid(),
  daily_goal       int,                    -- 每日计划背多少张（空则不限）
  reminder_enabled boolean not null default false,
  reminder_time    text,                   -- "HH:MM"，如 "20:00"
  recognition_rules jsonb,                 -- 自定义识别规则（正面/背面/读音/拓展表头关键词）
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id)
);

-- 给已存在的库补 recognition_rules 列（幂等）
alter table public.user_settings add column if not exists recognition_rules jsonb;

-- ============================================================
-- 索引（加快按用户 / 按文件夹 / 按笔记 / 按到期查询）
-- ============================================================
create index if not exists folders_user_id_idx on public.folders (user_id);
create index if not exists notes_user_id_idx   on public.notes   (user_id);
create index if not exists notes_folder_id_idx on public.notes   (folder_id);
create index if not exists cards_user_id_idx   on public.cards   (user_id);
create index if not exists cards_note_id_idx   on public.cards   (note_id);
create index if not exists review_state_due_idx on public.review_state (user_id, due_at);
create index if not exists user_settings_user_id_idx on public.user_settings (user_id);

-- ============================================================
-- 行级安全（RLS）：只有登录的本人能读写自己的数据
-- ============================================================
alter table public.folders      enable row level security;
alter table public.notes        enable row level security;
alter table public.cards        enable row level security;
alter table public.review_state enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "folders_own" on public.folders;
create policy "folders_own" on public.folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notes_own" on public.notes;
create policy "notes_own" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "cards_own" on public.cards;
create policy "cards_own" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "review_state_own" on public.review_state;
create policy "review_state_own" on public.review_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_settings_own" on public.user_settings;
create policy "user_settings_own" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- updated_at 自动更新时间（每次更新数据时自动刷新）
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists folders_set_updated_at on public.folders;
create trigger folders_set_updated_at before update on public.folders
  for each row execute function public.set_updated_at();

drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at before update on public.cards
  for each row execute function public.set_updated_at();

drop trigger if exists review_state_set_updated_at on public.review_state;
create trigger review_state_set_updated_at before update on public.review_state
  for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ============================================================
-- 表 6：用户自定义词群分类 word_themes（名字 + 关键词，命中即收录）
-- ============================================================
create table if not exists public.word_themes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  name       text not null,
  keywords   text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists word_themes_user_id_idx on public.word_themes (user_id);

alter table public.word_themes enable row level security;

drop policy if exists "word_themes_own" on public.word_themes;
create policy "word_themes_own" on public.word_themes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
