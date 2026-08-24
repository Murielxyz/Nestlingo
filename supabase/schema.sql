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

-- 给已存在的库补 theme 列（词群页「AI 智能整理」把生词归到的场景主题 key，删卡即随之消失）
alter table public.cards add column if not exists theme text;

-- 给已存在的库补 lang 列（卡片语言 thai/korean/chinese/japanese/other；转卡时自动判断，可手动改）
alter table public.cards add column if not exists lang text;

-- 给已存在的库补 reading 列（日语生词的读音，JSON 字符串存 text+reading 分段；背诵/卡片在汉字上方标假名）
alter table public.cards add column if not exists reading text;

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

-- 给已存在的库补 hidden_themes 列（幂等）：用户隐藏（删除）的内置词群主题 key
alter table public.user_settings add column if not exists hidden_themes text[] default '{}';

-- 给已存在的库补「AI 模型」列（幂等）：每任务一个，null=用环境默认
alter table public.user_settings add column if not exists ai_text_provider text;   -- 'claude' | 'deepseek'
alter table public.user_settings add column if not exists ai_speech_provider text; -- 'groq' | 'openai'
alter table public.user_settings add column if not exists ai_vision_provider text; -- 'claude' | 'openai'

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

-- ============================================================
-- 表 7：测试错题集 test_errors（测试里选错的卡，独立于 SM-2 复习评分）
-- ============================================================
create table if not exists public.test_errors (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  card_id    uuid not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, card_id)
);

create index if not exists test_errors_user_id_idx on public.test_errors (user_id);

alter table public.test_errors enable row level security;

drop policy if exists "test_errors_own" on public.test_errors;
create policy "test_errors_own" on public.test_errors
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists test_errors_set_updated_at on public.test_errors;
create trigger test_errors_set_updated_at before update on public.test_errors
  for each row execute function public.set_updated_at();

-- ============================================================
-- 表 8：素材合集 material_collections（用户可建，照 word_themes；无 updated_at）
-- ============================================================
create table if not exists public.material_collections (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- 合集的「定义标签」：语言 + 类型（可选，用户可手动设置；不设则筛选时按里面素材的标签兜底）。
alter table public.material_collections add column if not exists lang text;
alter table public.material_collections add column if not exists type text;

create index if not exists material_collections_user_id_idx
  on public.material_collections (user_id);

alter table public.material_collections enable row level security;

drop policy if exists "material_collections_own" on public.material_collections;
create policy "material_collections_own" on public.material_collections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- 表 9：素材 materials
--   type:    youtube / audio / spotify / link / podcast
--   status:  pending（待处理）/ imported（已导入）
--   note_id: 导入到的笔记（删笔记只孤立标记，不删素材）
--   collection_id: 所属合集（删合集退归类[置 null]，素材行保留）
-- ============================================================
create table if not exists public.materials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  url           text not null,
  type          text not null default 'link',
  title         text not null default '',
  source        text,
  thumbnail     text,
  lang          text,
  status        text not null default 'pending',
  note_id       uuid references public.notes(id) on delete set null,
  -- 删合集「退归类(置 null)」而非级联删素材（对齐上方注释 + UI「素材退到单条」提示）。
  -- 注意：下方有幂等 alter 可修掉已建库里的旧 cascade 约束；新装直接走这里。
  collection_id uuid references public.material_collections(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 修正已有库：把旧「on delete cascade」换成「on delete set null」，避免删合集误删其内素材。
-- 约束名由 PG 对 `collection_id` 自动生成（`materials_collection_id_fkey`），drop 幂等、重建安全。
alter table public.materials drop constraint if exists materials_collection_id_fkey;
alter table public.materials add constraint materials_collection_id_fkey
  foreign key (collection_id) references public.material_collections(id) on delete set null;

create index if not exists materials_user_id_idx      on public.materials (user_id);
create index if not exists materials_collection_id_idx on public.materials (collection_id);
create index if not exists materials_note_id_idx       on public.materials (note_id);

-- 给已存在的库补 content 列（AI 生成素材 / 网页文章正文的原文，转成笔记时用）
alter table public.materials add column if not exists content text;

-- 给已存在的库补 file_kind 列（上传文件素材的子类：audio / image / doc）
alter table public.materials add column if not exists file_kind text;

alter table public.materials enable row level security;

drop policy if exists "materials_own" on public.materials;
create policy "materials_own" on public.materials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists materials_set_updated_at on public.materials;
create trigger materials_set_updated_at before update on public.materials
  for each row execute function public.set_updated_at();

-- ============================================================
-- 表 10：素材文件上传用的存储桶（materials）
--   上传的音频 / 图片 / 文档都放这里，按「每用户一个前缀文件夹」隔离。
--   脚本可重复运行（on conflict do nothing）。
-- ============================================================
insert into storage.buckets (id, name, public)
values ('materials', 'materials', true)
on conflict (id) do nothing;

-- 存储桶 RLS：登录用户只能往「自己的用户 id 文件夹」下上传/读取自己的文件。
drop policy if exists "materials_bucket_read" on storage.objects;
create policy "materials_bucket_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "materials_bucket_write" on storage.objects;
create policy "materials_bucket_write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

-- 启动桶初值保留了 public 读：上传文件的 URL 会被 <img>/<audio> 直接引用（无鉴权头），
-- 改私有会破坏自身展示；路径含「uid + 随机 uuid」难以猜测，单用户下实用风险低。
-- （长期可改用签名 URL 收紧，见 UPDATE_LOG。）
-- 这里补上缺失的 UPDATE / DELETE 策略：否则用户改/删自己上传的文件会被拒（覆盖/替换失败）。
drop policy if exists "materials_bucket_update" on storage.objects;
create policy "materials_bucket_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "materials_bucket_delete" on storage.objects;
create policy "materials_bucket_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
