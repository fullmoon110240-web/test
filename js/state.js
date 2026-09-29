export const state = {
  quotesByCharacter: Object.create(null),
  expressionsByCharacter: Object.create(null),
  // 대사는 expression_id로 표정을 가리킵니다. 빠르게 되찾기 위한 색인입니다.
  expressionsById: Object.create(null),
  worldviews: [],
  // `${worldviewId}::${characterId}` -> 기본 이미지 URL
  worldviewImages: Object.create(null),
  worldviewSupported: false,
  activeWorldviewId: null,
  activeCharacterId: null,
  // 표정 목록은 세계관 목록에서 열리므로 대사 목록과 별개로 캐릭터를 기억합니다.
  expressionCharacterId: 'char-a',
  editingQuoteId: null,
  editingExpressionId: null,
  editingQuote: null,
  // 아직 등록하지 않은 대사의 아이템/표정/세계관 초안
  draftQuote: null,
  // 대사 목록 정렬: 'oldest' | 'newest' | 'name'
  quoteSort: readStoredSort(),
  // 대사 목록 거르기. '' = 전체, '__none__' = 지정 안 된 것, 그 외 = 해당 id
  quoteItemFilter: '',
  quoteExpressionFilter: '',
  editingExpression: null,
  editingWorldviewId: null,
  idleTimer: null,
  busy: false
};

function readStoredSort() {
  try {
    const saved = localStorage.getItem('colliji:quote-sort');
    return ['oldest', 'newest', 'name'].includes(saved) ? saved : 'oldest';
  } catch {
    return 'oldest';
  }
}

export function setLoadedData({ quotes, expressions, worldviews, worldviewImages, worldviewSupported }) {
  // worldviewSupported가 false면 세계관 바는 안내 상태로 표시됩니다.
  state.quotesByCharacter = Object.create(null);
  state.expressionsByCharacter = Object.create(null);

  for (const row of quotes ?? []) {
    const id = String(row.character_id);
    if (!state.quotesByCharacter[id]) state.quotesByCharacter[id] = [];
    state.quotesByCharacter[id].push(row);
  }

  state.expressionsById = Object.create(null);
  for (const row of expressions ?? []) {
    const id = String(row.character_id);
    if (!state.expressionsByCharacter[id]) state.expressionsByCharacter[id] = [];
    state.expressionsByCharacter[id].push(row);
    state.expressionsById[String(row.id)] = row;
  }

  state.worldviewSupported = Boolean(worldviewSupported);
  setWorldviews(worldviews ?? []);
  setWorldviewImages(worldviewImages ?? []);
}

export function getQuotes(characterId) {
  return state.quotesByCharacter[characterId] ?? (state.quotesByCharacter[characterId] = []);
}

export function getExpressions(characterId) {
  return state.expressionsByCharacter[characterId] ?? (state.expressionsByCharacter[characterId] = []);
}

export function getExpressionById(expressionId) {
  if (!expressionId) return null;
  return state.expressionsById[String(expressionId)] ?? null;
}

/* ------------------------------------------------------------------ */
/* 세계관                                                              */
/* ------------------------------------------------------------------ */

// 선택된 세계관이 없으면 모든 세계관의 대사/표정이 섞여 나옵니다.
function matchesActiveWorldview(row) {
  if (!state.activeWorldviewId) return true;
  return String(row.worldview_id ?? '') === state.activeWorldviewId;
}

export function sameWorldview(a, b) {
  return String(a ?? '') === String(b ?? '');
}

export function getVisibleQuotes(characterId) {
  return getQuotes(characterId).filter(matchesActiveWorldview);
}

export function getVisibleExpressions(characterId) {
  return getExpressions(characterId).filter(matchesActiveWorldview);
}

export function setActiveWorldview(worldviewId) {
  const id = worldviewId ? String(worldviewId) : null;
  state.activeWorldviewId = id && state.worldviews.some(row => String(row.id) === id) ? id : null;
  return state.activeWorldviewId;
}

export function getActiveWorldview() {
  if (!state.activeWorldviewId) return null;
  return state.worldviews.find(row => String(row.id) === state.activeWorldviewId) ?? null;
}

function setWorldviews(rows) {
  state.worldviews = [...(rows ?? [])].sort(compareWorldview);
}

export function upsertLocalWorldview(row) {
  const index = state.worldviews.findIndex(item => String(item.id) === String(row.id));
  if (index === -1) state.worldviews.push(row);
  else state.worldviews[index] = row;
  state.worldviews.sort(compareWorldview);
}

// DB는 on delete set null이므로, 로컬 데이터도 동일하게 미분류로 되돌립니다.
export function removeLocalWorldview(worldviewId) {
  const id = String(worldviewId);
  state.worldviews = state.worldviews.filter(item => String(item.id) !== id);

  for (const key of Object.keys(state.worldviewImages)) {
    if (key.startsWith(`${id}::`)) delete state.worldviewImages[key];
  }

  for (const rows of Object.values(state.quotesByCharacter)) {
    for (const row of rows) if (sameWorldview(row.worldview_id, id)) row.worldview_id = null;
  }

  for (const rows of Object.values(state.expressionsByCharacter)) {
    for (const row of rows) if (sameWorldview(row.worldview_id, id)) row.worldview_id = null;
  }

  if (state.activeWorldviewId === id) state.activeWorldviewId = null;
}

function setWorldviewImages(rows) {
  state.worldviewImages = Object.create(null);
  for (const row of rows ?? []) {
    setWorldviewImage(row.worldview_id, row.character_id, row.default_image_url);
  }
}

export function setWorldviewImage(worldviewId, characterId, url) {
  const key = `${String(worldviewId)}::${String(characterId)}`;
  const value = String(url ?? '').trim();
  if (value) state.worldviewImages[key] = value;
  else delete state.worldviewImages[key];
}

export function getWorldviewImage(worldviewId, characterId) {
  if (!worldviewId) return '';
  return state.worldviewImages[`${String(worldviewId)}::${String(characterId)}`] ?? '';
}

function compareWorldview(a, b) {
  const ao = Number(a.sort_order ?? 0);
  const bo = Number(b.sort_order ?? 0);
  if (ao !== bo) return ao - bo;
  return compareCreatedAt(a, b);
}

/* ------------------------------------------------------------------ */
/* 대사 / 표정 로컬 캐시                                                */
/* ------------------------------------------------------------------ */

export function upsertLocalQuote(row) {
  const rows = getQuotes(row.character_id);
  const index = rows.findIndex(item => item.id === row.id);
  if (index === -1) rows.push(row);
  else rows[index] = row;
  rows.sort(compareCreatedAt);
}

export function removeLocalQuote(id, characterId) {
  state.quotesByCharacter[characterId] = getQuotes(characterId).filter(row => row.id !== id);
}

export function upsertLocalExpression(row) {
  const rows = getExpressions(row.character_id);
  const index = rows.findIndex(item => item.id === row.id);
  if (index === -1) rows.push(row);
  else rows[index] = row;
  rows.sort(compareCreatedAt);
  state.expressionsById[String(row.id)] = row;
}

export function removeLocalExpression(id, characterId) {
  state.expressionsByCharacter[characterId] = getExpressions(characterId).filter(row => row.id !== id);
  delete state.expressionsById[String(id)];

  // DB는 on delete set null로 처리합니다. 로컬도 같은 상태로 맞춥니다.
  for (const rows of Object.values(state.quotesByCharacter)) {
    for (const row of rows) {
      if (String(row.expression_id ?? '') === String(id)) row.expression_id = null;
    }
  }
}

function compareCreatedAt(a, b) {
  const at = new Date(a.created_at ?? 0).getTime();
  const bt = new Date(b.created_at ?? 0).getTime();
  if (at !== bt) return at - bt;
  return String(a.id).localeCompare(String(b.id));
}
