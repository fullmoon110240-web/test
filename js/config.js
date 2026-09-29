/*
 * 데이터베이스(Supabase) 연결 정보.
 *
 * 비워 두면: 처음 열 때 입력창이 뜨고, 입력한 값은 그 브라우저에 저장됩니다.
 *            (기기나 브라우저를 바꾸면 한 번 더 입력합니다)
 *
 * 채워 두면: 입력창 없이 바로 이 DB로 연결됩니다. 이 사이트를 여는 모든 사람이
 *            같은 DB를 쓰게 되므로, 혼자 쓰는 사이트일 때만 채우세요.
 *
 * 키는 반드시 Publishable key(예전 이름: anon key)를 씁니다.
 * secret / service_role 키는 절대 넣지 마세요.
 */
export const SUPABASE_URL = '';
export const SUPABASE_PUBLISHABLE_KEY = '';

export const TABLES = Object.freeze({
  quotes: 'quotes',
  expressions: 'expressions',
  worldviews: 'worldviews',
  worldviewCharacters: 'worldview_characters',
  settings: 'settings'
});

// 캐릭터 · 아이템 이미지를 올리는 Storage 버킷. supabase/schema.sql 이 만듭니다.
export const STORAGE_BUCKET = 'dialogue-images';
