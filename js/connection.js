import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, TABLES } from './config.js';
import { isMissingTable, makeClient } from './supabase.js';

/*
 * DB 연결 정보를 어디서 가져올지 정합니다.
 *
 *   1. js/config.js 에 적혀 있으면 그것을 씁니다. (입력창이 뜨지 않습니다)
 *   2. 없으면 이 브라우저에 저장해 둔 값을 씁니다.
 *   3. 그것도 없으면 첫 화면에서 입력창을 띄웁니다. (js/modules/setup.js)
 */
const STORAGE_KEY = 'collige:db-connection';

export function getBuiltInConnection() {
  const url = normalizeProjectUrl(SUPABASE_URL);
  const key = String(SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  return url && key ? { url, key, source: 'config' } : null;
}

export function getStoredConnection() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    const url = normalizeProjectUrl(saved?.url);
    const key = String(saved?.key ?? '').trim();
    return url && key ? { url, key, source: 'browser' } : null;
  } catch {
    return null;
  }
}

export function getConnection() {
  return getBuiltInConnection() ?? getStoredConnection();
}

export function saveConnection({ url, key }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url, key }));
    return true;
  } catch {
    // 사생활 보호 창 등에서는 저장이 안 됩니다. 이번에만 연결하고 다음에 다시 묻습니다.
    return false;
  }
}

export function clearStoredConnection() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 무시
  }
}

/*
 * 사람들이 붙여넣는 여러 모양을 https://<프로젝트>.supabase.co 로 맞춥니다.
 *   abcdefghijklmnopqrst                              (프로젝트 ID만)
 *   https://supabase.com/dashboard/project/abcd...    (대시보드 주소)
 *   https://abcd....supabase.co/rest/v1/              (API 주소)
 */
export function normalizeProjectUrl(value) {
  let text = String(value ?? '').trim();
  if (!text) return '';

  if (/^[a-z0-9]{20}$/.test(text)) return `https://${text}.supabase.co`;

  const dashboard = text.match(/supabase\.com\/dashboard\/project\/([a-z0-9]{20})/);
  if (dashboard) return `https://${dashboard[1]}.supabase.co`;

  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (!url.hostname.includes('.')) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
  } catch {
    return null;
  }
}

// 브라우저에 넣으면 안 되는 키를 걸러냅니다. 문제가 없으면 빈 문자열.
export function keyProblem(key) {
  const text = String(key ?? '').trim();
  if (!text) return 'Publishable key를 입력해 주세요.';

  if (/^sb_secret_/i.test(text)) {
    return 'secret 키입니다. 이 키는 브라우저에 넣으면 안 됩니다.\nsb_publishable_ 로 시작하는 키를 넣어 주세요.';
  }

  if (text.startsWith('eyJ') && decodeJwtPayload(text)?.role === 'service_role') {
    return 'service_role 키입니다. 이 키는 브라우저에 넣으면 안 됩니다.\nanon(public) 키를 넣어 주세요.';
  }

  return '';
}

/*
 * 실제로 접속해서 필요한 표가 다 있는지 봅니다.
 * 문제가 있으면 무엇을 고쳐야 하는지 적힌 오류를 던집니다.
 */
export async function testConnection({ url, key }) {
  const client = makeClient(url, key);
  const tables = Object.values(TABLES);

  const results = await Promise.all(
    tables.map(table => client.from(table).select('*').limit(1))
  );

  const missing = [];
  for (const [index, result] of results.entries()) {
    const error = result.error;
    if (!error) continue;

    const message = String(error.message ?? '');
    const status = Number(result.status ?? 0);

    if (/fetch|network|load failed/i.test(message) || status === 0) {
      throw new Error('주소에 접속하지 못했습니다.\nProject URL이 맞는지, 인터넷이 연결되어 있는지 확인해 주세요.');
    }
    if (status === 401 || /api key|jwt|apikey/i.test(message)) {
      throw new Error('키가 올바르지 않습니다.\nProject URL과 같은 프로젝트의 Publishable key인지 확인해 주세요.');
    }
    if (isMissingTable(error) || status === 404) {
      missing.push(tables[index]);
      continue;
    }
    if (error.code === '42501' || status === 403) {
      throw new Error('읽기 권한이 없습니다.\nSQL Editor에서 supabase/schema.sql을 다시 실행해 주세요.');
    }
    throw new Error(`연결 확인 중 오류가 났습니다.\n(${message || error.code || status})`);
  }

  if (missing.length) {
    throw new Error(
      '연결은 됐지만 필요한 표가 없습니다.\n' +
        'Supabase의 SQL Editor에서 supabase/schema.sql 내용을 붙여넣고 실행(Run)해 주세요.\n' +
        `(없는 표: ${missing.join(', ')})`
    );
  }
}
