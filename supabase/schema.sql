-- =====================================================================
-- Supabase 스키마 (이 파일 하나면 됩니다)
--
-- 새 Supabase 프로젝트의 SQL Editor에 이 파일 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다. (이미 있는 표와 데이터는 그대로 둡니다)
--
-- 브라우저에는 Publishable key(anon key)만 들어가며,
-- 실제로 무엇을 읽고 쓸 수 있는지는 맨 아래 RLS 정책이 정합니다.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 세계관
-- ---------------------------------------------------------------------
create table if not exists public.worldviews (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists worldviews_name_uniq
  on public.worldviews (lower(name));

-- 세계관별 캐릭터 기본 이미지.
-- character_id는 앱의 캐릭터 키입니다: 'char-a' / 'char-b'
create table if not exists public.worldview_characters (
  worldview_id      uuid not null references public.worldviews(id) on delete cascade,
  character_id      text not null,
  default_image_url text not null,
  created_at        timestamptz not null default now(),
  primary key (worldview_id, character_id)
);

-- ---------------------------------------------------------------------
-- 표정
-- 이미지 URL은 오직 여기에만 있습니다. 대사는 id로 이 행을 가리킵니다.
-- ---------------------------------------------------------------------
create table if not exists public.expressions (
  id           uuid primary key default gen_random_uuid(),
  character_id text not null,
  name         text not null,
  url          text not null,
  worldview_id uuid references public.worldviews(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 대사
--   expression_id : 표정 참조. 없으면 기본 이미지로 말합니다.
--   item_id       : 아이템 칸 키 ('item-1' ~ 'item-4'). 비어 있으면 일반 대사.
--   worldview_id  : 없으면 미분류. 세계관을 전부 해제했을 때만 함께 나옵니다.
-- ---------------------------------------------------------------------
create table if not exists public.quotes (
  id            uuid primary key default gen_random_uuid(),
  character_id  text not null,
  text          text not null,
  item_id       text not null default '',
  expression_id uuid references public.expressions(id) on delete set null,
  worldview_id  uuid references public.worldviews(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 화면에서 바꾸는 설정
--   'character:char-a' / 'character:char-b'  { name, color, image }
--   'item:item-1' ~ 'item:item-4'            { name, description, image }
--   'music'                                  { src, artist }
--   'cursor'                                 { "char-a": 그림 주소, "char-b": 그림 주소 }  마우스를 따라다니는 그림
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 인덱스
--
-- 앱은 전체를 한 번에 읽고 브라우저에서 거릅니다. WHERE 절이 없으므로
-- 조회용 인덱스는 필요하지 않습니다. 아래 셋은 외래키의 on delete set null이
-- 참조 행을 찾을 때 실제로 사용되는 것들입니다.
-- ---------------------------------------------------------------------
create index if not exists quotes_expression_idx     on public.quotes (expression_id);
create index if not exists quotes_worldview_idx      on public.quotes (worldview_id);
create index if not exists expressions_worldview_idx on public.expressions (worldview_id);

-- ---------------------------------------------------------------------
-- RLS
--
-- GitHub Pages처럼 로그인 없이 브라우저에서 사용하는 방식의 정책입니다.
-- Publishable key 자체는 공개되어도 되지만, 아래 정책을 쓰면 키를 아는 사람은
-- 누구나 이 프로젝트의 데이터를 읽고 쓰고 삭제할 수 있습니다.
-- 사이트 주소와 키를 모르는 사람에게는 보이지 않지만, 비밀 저장소는 아닙니다.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  op text;
begin
  foreach t in array array['quotes', 'expressions', 'worldviews', 'worldview_characters', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);

    foreach op in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_public_' || op, t);
    end loop;

    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_public_select', t);
    execute format(
      'create policy %I on public.%I for insert to anon, authenticated with check (true)',
      t || '_public_insert', t);
    execute format(
      'create policy %I on public.%I for update to anon, authenticated using (true) with check (true)',
      t || '_public_update', t);
    execute format(
      'create policy %I on public.%I for delete to anon, authenticated using (true)',
      t || '_public_delete', t);

    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 이미지 저장소 (Storage)
--
-- 캐릭터 · 아이템 · 마우스 캐릭터 칸에서 [파일 올리기]로 올린 그림이 여기에 들어갑니다.
-- 누구나 주소로 볼 수 있는 공개 버킷이고, 그림 파일만 10MB까지 받습니다.
-- (이미지 주소를 직접 붙여넣어 쓴다면 이 부분이 없어도 됩니다)
-- ---------------------------------------------------------------------
-- 이 부분이 실패해도 위의 표들은 그대로 만들어집니다. (파일 올리기만 안 되고, 주소 붙여넣기는 됩니다)
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'collige',
    'collige',
    true,
    10485760,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
  )
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "collige_images_select" on storage.objects;
  drop policy if exists "collige_images_insert" on storage.objects;
  drop policy if exists "collige_images_update" on storage.objects;
  drop policy if exists "collige_images_delete" on storage.objects;

  create policy "collige_images_select" on storage.objects
    for select to anon, authenticated using (bucket_id = 'collige');
  create policy "collige_images_insert" on storage.objects
    for insert to anon, authenticated with check (bucket_id = 'collige');
  create policy "collige_images_update" on storage.objects
    for update to anon, authenticated using (bucket_id = 'collige') with check (bucket_id = 'collige');
  create policy "collige_images_delete" on storage.objects
    for delete to anon, authenticated using (bucket_id = 'collige');
exception when others then
  raise warning '이미지 저장소(Storage)를 준비하지 못했습니다: %. 대시보드의 Storage에서 collige 라는 Public 버킷을 직접 만들어 주세요.', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------
-- 앱이 표를 바로 알아보도록 API 캐시를 새로 고칩니다.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
