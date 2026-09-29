import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { STORAGE_BUCKET, TABLES } from './config.js';

/*
 * 연결은 앱이 켜질 때 connectSupabase() 로 한 번 맺습니다.
 * (주소와 키는 js/config.js 또는 첫 화면 입력창에서 옵니다 - js/connection.js)
 * 이 파일 안에서만 씁니다. 바깥에는 아래 함수들만 내보냅니다.
 */
let supabase = null;

export function makeClient(url, key) {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function connectSupabase({ url, key }) {
  supabase = makeClient(url, key);
}

function db() {
  if (!supabase) throw new Error('데이터베이스가 아직 연결되지 않았습니다.');
  return supabase;
}

const QUOTE_COLUMNS_BASE = 'id,character_id,text,item_id,expression_id,created_at';
const EXPRESSION_COLUMNS_BASE = 'id,character_id,name,url,created_at';
const QUOTE_COLUMNS = `${QUOTE_COLUMNS_BASE},worldview_id`;
const EXPRESSION_COLUMNS = `${EXPRESSION_COLUMNS_BASE},worldview_id`;
const WORLDVIEW_COLUMNS = 'id,name,sort_order,created_at';
const WORLDVIEW_IMAGE_COLUMNS = 'worldview_id,character_id,default_image_url';
const SETTING_COLUMNS = 'key,value';

// 세계관 표가 없으면(스키마 일부만 실행한 경우) 세계관 기능만 끄고 나머지는 그대로 씁니다.
let worldviewSupported = true;
let worldviewReason = '';

export function isWorldviewSupported() {
  return worldviewSupported;
}

// 세계관 바가 왜 비활성인지 화면과 콘솔에서 알려주기 위한 정보입니다.
export function getWorldviewReason() {
  return worldviewReason;
}

function disableWorldview(error, where) {
  if (!worldviewSupported) return;
  worldviewSupported = false;
  worldviewReason = error ? `${where}: ${error.message || error.code || error}` : where;
  console.warn(
    `[worldview] 세계관 스키마를 찾지 못해 기능을 끕니다. (${worldviewReason})\n` +
      'Supabase SQL Editor에서 supabase/schema.sql을 실행해 주세요.'
  );
}

function quoteColumns() {
  return worldviewSupported ? QUOTE_COLUMNS : QUOTE_COLUMNS_BASE;
}

function expressionColumns() {
  return worldviewSupported ? EXPRESSION_COLUMNS : EXPRESSION_COLUMNS_BASE;
}

// 42P01: undefined_table, 42703: undefined_column, PGRST205: 표를 찾지 못함
export function isMissingTable(error) {
  if (!error) return false;
  const code = String(error.code ?? '');
  return code === '42P01' || code === '42703' || code === 'PGRST205' || code === 'PGRST204';
}

function isWorldviewMissing(error) {
  if (!error) return false;
  if (isMissingTable(error)) return true;
  const code = String(error.code ?? '');
  return code.startsWith('PGRST') && /worldview/i.test(String(error.message ?? ''));
}

function unwrap(result, message) {
  if (result.error) {
    const error = new Error(result.error.message || message);
    error.code = result.error.code;
    error.details = result.error.details;
    error.hint = result.error.hint;
    throw error;
  }
  return result.data;
}

function orderedSelect(table, columns) {
  return db()
    .from(table)
    .select(columns)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
}

async function selectRows(table, fullColumns, baseColumns) {
  if (worldviewSupported) {
    const result = await orderedSelect(table, fullColumns);
    if (!result.error) return result;
    if (!isWorldviewMissing(result.error)) return result;
    disableWorldview(result.error, `${table}.worldview_id`);
  }
  return orderedSelect(table, baseColumns);
}

async function fetchWorldviewData() {
  const [worldviewResult, imageResult] = await Promise.all([
    db()
      .from(TABLES.worldviews)
      .select(WORLDVIEW_COLUMNS)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    db().from(TABLES.worldviewCharacters).select(WORLDVIEW_IMAGE_COLUMNS)
  ]);

  if (isWorldviewMissing(worldviewResult.error)) {
    disableWorldview(worldviewResult.error, TABLES.worldviews);
    return { worldviews: [], worldviewImages: [] };
  }

  if (isWorldviewMissing(imageResult.error)) {
    disableWorldview(imageResult.error, TABLES.worldviewCharacters);
    return { worldviews: [], worldviewImages: [] };
  }

  return {
    worldviews: unwrap(worldviewResult, '세계관 목록을 불러오지 못했습니다.') ?? [],
    worldviewImages: unwrap(imageResult, '세계관 기본 이미지를 불러오지 못했습니다.') ?? []
  };
}

async function fetchSettings() {
  const result = await db().from(TABLES.settings).select(SETTING_COLUMNS);
  if (isMissingTable(result.error)) {
    console.warn('[settings] settings 표가 없습니다. supabase/schema.sql을 실행해 주세요.');
    return [];
  }
  return unwrap(result, '설정을 불러오지 못했습니다.') ?? [];
}

export async function fetchAllData() {
  const [quotesResult, expressionsResult, settings] = await Promise.all([
    selectRows(TABLES.quotes, QUOTE_COLUMNS, QUOTE_COLUMNS_BASE),
    selectRows(TABLES.expressions, EXPRESSION_COLUMNS, EXPRESSION_COLUMNS_BASE),
    fetchSettings()
  ]);

  const quotes = unwrap(quotesResult, '대사 데이터를 불러오지 못했습니다.') ?? [];
  const expressions = unwrap(expressionsResult, '표정 데이터를 불러오지 못했습니다.') ?? [];

  const worldviewData = worldviewSupported
    ? await fetchWorldviewData()
    : { worldviews: [], worldviewImages: [] };

  if (worldviewSupported) {
    console.info(`[worldview] 사용 가능. 등록된 세계관 ${worldviewData.worldviews.length}개.`);
  }

  return {
    quotes,
    expressions,
    settings,
    ...worldviewData,
    worldviewSupported,
    worldviewReason
  };
}

/* ------------------------------------------------------------------ */
/* 설정 (캐릭터 이름·컬러·이미지, 아이템, 배경 음악)                      */
/* ------------------------------------------------------------------ */

export async function saveSetting(key, value) {
  const result = await db()
    .from(TABLES.settings)
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select(SETTING_COLUMNS)
    .single();

  return unwrap(result, '설정을 저장하지 못했습니다.');
}

export async function deleteSetting(key) {
  const result = await db().from(TABLES.settings).delete().eq('key', key);
  unwrap(result, '설정을 지우지 못했습니다.');
}

/*
 * 이미지 파일을 Storage 버킷에 올리고, 누구나 볼 수 있는 주소를 돌려줍니다.
 * 같은 이름으로 덮어쓰지 않도록 매번 새 이름을 붙입니다.
 */
const EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
};

export async function uploadImage(blob, folder) {
  const type = blob.type || 'image/png';
  const extension = EXTENSIONS[type] ?? 'png';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const path = `${folder}/${name}`;

  const bucket = db().storage.from(STORAGE_BUCKET);
  const { error } = await bucket.upload(path, blob, {
    contentType: type,
    cacheControl: '31536000',
    upsert: false
  });

  if (error) {
    const message = String(error.message ?? error);
    let hint = '';
    if (/bucket not found/i.test(message)) {
      hint = `'${STORAGE_BUCKET}' 버킷이 없습니다. supabase/schema.sql을 다시 실행해 주세요.`;
    } else if (/row-level security|unauthorized|403/i.test(message)) {
      hint = '업로드 권한이 없습니다. supabase/schema.sql의 Storage 부분을 실행했는지 확인해 주세요.';
    } else if (/mime|type/i.test(message)) {
      hint = 'PNG · JPG · WEBP · GIF 이미지만 올릴 수 있습니다.';
    } else if (/size|large/i.test(message)) {
      hint = '파일이 너무 큽니다. 10MB 이하로 줄여 주세요.';
    }
    throw new Error(`${hint || '이미지를 올리지 못했습니다.'}\n(${message})\n\n이미지 주소를 붙여넣어도 됩니다.`);
  }

  return bucket.getPublicUrl(path).data.publicUrl;
}

/* ------------------------------------------------------------------ */
/* 대사 / 표정 / 세계관                                                 */
/* ------------------------------------------------------------------ */

export async function createQuote({ characterId, text, itemId = '', expressionId = null, worldviewId = null }) {
  const payload = {
    character_id: characterId,
    text,
    item_id: itemId,
    expression_id: expressionId
  };
  if (worldviewSupported) payload.worldview_id = worldviewId;

  const result = await db()
    .from(TABLES.quotes)
    .insert(payload)
    .select(quoteColumns())
    .single();

  return unwrap(result, '대사를 저장하지 못했습니다.');
}

export async function updateQuote(id, patch) {
  const result = await db()
    .from(TABLES.quotes)
    .update(patch)
    .eq('id', id)
    .select(quoteColumns())
    .single();

  return unwrap(result, '대사를 수정하지 못했습니다.');
}

export async function deleteQuote(id) {
  const result = await db().from(TABLES.quotes).delete().eq('id', id);
  unwrap(result, '대사를 삭제하지 못했습니다.');
}

export async function createExpression({ characterId, name, url, worldviewId = null }) {
  const payload = { character_id: characterId, name, url };
  if (worldviewSupported) payload.worldview_id = worldviewId;

  const result = await db()
    .from(TABLES.expressions)
    .insert(payload)
    .select(expressionColumns())
    .single();

  return unwrap(result, '표정을 저장하지 못했습니다.');
}

export async function updateExpression(id, patch) {
  const result = await db()
    .from(TABLES.expressions)
    .update(patch)
    .eq('id', id)
    .select(expressionColumns())
    .single();

  return unwrap(result, '표정을 수정하지 못했습니다.');
}

export async function deleteExpression(id) {
  const result = await db().from(TABLES.expressions).delete().eq('id', id);
  unwrap(result, '표정을 삭제하지 못했습니다.');
}

export async function createWorldview({ name, sortOrder = 0 }) {
  const result = await db()
    .from(TABLES.worldviews)
    .insert({ name, sort_order: sortOrder })
    .select(WORLDVIEW_COLUMNS)
    .single();

  return unwrap(result, '세계관을 저장하지 못했습니다.');
}

export async function updateWorldview(id, patch) {
  const result = await db()
    .from(TABLES.worldviews)
    .update(patch)
    .eq('id', id)
    .select(WORLDVIEW_COLUMNS)
    .single();

  return unwrap(result, '세계관을 수정하지 못했습니다.');
}

export async function deleteWorldview(id) {
  const result = await db().from(TABLES.worldviews).delete().eq('id', id);
  unwrap(result, '세계관을 삭제하지 못했습니다.');
}

export async function saveWorldviewImage({ worldviewId, characterId, url }) {
  const trimmed = String(url ?? '').trim();

  if (!trimmed) {
    const result = await db()
      .from(TABLES.worldviewCharacters)
      .delete()
      .eq('worldview_id', worldviewId)
      .eq('character_id', characterId);
    unwrap(result, '세계관 기본 이미지를 지우지 못했습니다.');
    return null;
  }

  const result = await db()
    .from(TABLES.worldviewCharacters)
    .upsert(
      { worldview_id: worldviewId, character_id: characterId, default_image_url: trimmed },
      { onConflict: 'worldview_id,character_id' }
    )
    .select(WORLDVIEW_IMAGE_COLUMNS)
    .single();

  return unwrap(result, '세계관 기본 이미지를 저장하지 못했습니다.');
}
