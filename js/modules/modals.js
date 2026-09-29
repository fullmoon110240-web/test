import { CHARACTER_IDS } from '../data/characters.js';
import { ITEM_SLOTS } from '../data/items.js';
import { getCharacterName, getItemLabel } from '../settings.js';
import {
  state,
  getQuotes,
  getVisibleQuotes,
  getExpressions,
  getVisibleExpressions,
  getExpressionById,
  getActiveWorldview,
  sameWorldview,
  upsertLocalExpression,
  removeLocalExpression,
  upsertLocalQuote
} from '../state.js';
import { createExpression, deleteExpression, updateExpression } from '../supabase.js';
import { $, bindModalClosers, hideModal, isHttpUrl, isModalOpen, isTemporaryDriveUrl, normalizeImageUrl, quoteDuplicateKey, quoteSortKey, runBusy, showModal } from '../ui.js';
import { getCharacter } from './characters.js';
import { populateItemSelectList } from './items.js';
import { isWorldviewAvailable } from './worldview.js';

// 이 모달들은 열려 있는 캐릭터의 색을 따라갑니다. (A 컬러 / B 컬러)
const CHARACTER_THEMED_MODALS = [
  'quote-modal',
  'quote-add-modal',
  'quote-edit-modal',
  'expression-select-modal',
  'item-select-modal',
  'worldview-select-modal'
];

const SORT_STORAGE_KEY = 'dialogue:quote-sort';

/*
 * 아이템 / 표정 / 세계관 선택창은 두 곳에서 열립니다.
 *   - 이미 등록된 대사를 고칠 때  -> 고른 즉시 DB에 저장
 *   - 아직 등록 전인 대사를 쓸 때 -> 등록 버튼을 누르기 전까지 초안에만 반영
 * 지금 어느 쪽에서 열렸는지 여기에 기억해 둡니다.
 */
let selectTarget = null;

// 대사 중복 판단은 같은 캐릭터, 같은 세계관 안에서만 합니다.
// 세계관 1의 '안녕'과 세계관 2의 '안녕'은 서로 다른 대사이기 때문입니다.
function findDuplicateQuote(characterId, text, worldviewId, exceptId = null) {
  const target = quoteDuplicateKey(text);
  if (!target) return null;
  return getQuotes(characterId).find(row =>
    row.id !== exceptId &&
    sameWorldview(row.worldview_id, worldviewId) &&
    quoteDuplicateKey(row.text) === target
  ) ?? null;
}

/*
 * 대사 목록 거르기.
 *
 * '' 는 전체, '__none__' 은 아이템이나 표정을 지정하지 않은 대사를 뜻합니다.
 * 그 외의 값은 아이템 키 또는 표정 id 입니다.
 */
const FILTER_ALL = '';
const FILTER_NONE = '__none__';

function matchesFilters(quote) {
  const item = state.quoteItemFilter;
  if (item !== FILTER_ALL) {
    const value = String(quote.item_id ?? '');
    if (item === FILTER_NONE ? value !== '' : value !== item) return false;
  }

  /*
   * 표정은 id가 아니라 '이름'으로 거릅니다.
   * 표정은 세계관마다 따로 있으므로 '미소'가 여러 세계관에 따로 존재할 수 있습니다.
   * 세계관을 전부 해제했을 때 '미소'를 고르면 모든 세계관의 미소가 함께
   * 나오도록, 같은 이름을 한 묶음으로 봅니다.
   */
  const expression = state.quoteExpressionFilter;
  if (expression !== FILTER_ALL) {
    const name = getExpressionById(quote.expression_id)?.name ?? '';
    if (expression === FILTER_NONE ? name !== '' : name !== expression) return false;
  }

  return true;
}

function hasActiveFilter() {
  return state.quoteItemFilter !== FILTER_ALL || state.quoteExpressionFilter !== FILTER_ALL;
}

/*
 * 거르기 목록은 "지금 이 세계관의 대사에 실제로 쓰인 것"만 담습니다.
 * 고르자마자 빈 목록이 나오는 선택지를 없애기 위해서입니다.
 * 세계관을 바꿔 선택지가 사라지면 전체로 되돌립니다.
 */
function populateQuoteFilters(quotes) {
  const itemIds = new Set();
  const expressionIds = new Set();
  let hasBareItem = false;
  let hasBareExpression = false;

  for (const quote of quotes) {
    const itemId = String(quote.item_id ?? '');
    if (itemId && getItemLabel(itemId)) itemIds.add(itemId);
    else hasBareItem = true;

    const expressionId = String(quote.expression_id ?? '');
    if (expressionId && getExpressionById(expressionId)) expressionIds.add(expressionId);
    else hasBareExpression = true;
  }

  const itemOptions = [{ value: FILTER_ALL, label: '아이템 전체' }];
  if (hasBareItem) itemOptions.push({ value: FILTER_NONE, label: '아이템 없음' });
  for (const itemId of ITEM_SLOTS) {
    if (itemIds.has(itemId)) itemOptions.push({ value: itemId, label: getItemLabel(itemId) });
  }

  /*
   * 이름이 같은 표정은 한 항목으로 묶습니다.
   * 목록에 나오는 순서는 그 이름이 처음 등장한 표정의 등록 순서를 따릅니다.
   */
  const expressionNames = [];
  for (const expression of getVisibleExpressions(state.activeCharacterId)) {
    if (!expressionIds.has(String(expression.id))) continue;
    if (!expressionNames.includes(expression.name)) expressionNames.push(expression.name);
  }

  const expressionOptions = [{ value: FILTER_ALL, label: '표정 전체' }];
  if (hasBareExpression) expressionOptions.push({ value: FILTER_NONE, label: '표정 없음' });
  for (const name of expressionNames) {
    expressionOptions.push({ value: name, label: name });
  }

  state.quoteItemFilter = fillSelect($('quote-item-filter'), itemOptions, state.quoteItemFilter);
  state.quoteExpressionFilter =
    fillSelect($('quote-expression-filter'), expressionOptions, state.quoteExpressionFilter);
}

// 고른 값이 남아 있으면 유지하고, 사라졌으면 전체로 되돌린 뒤 그 값을 돌려줍니다.
function fillSelect(select, options, current) {
  const value = options.some(option => option.value === current) ? current : FILTER_ALL;

  select.replaceChildren(...options.map(option => {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    return element;
  }));

  select.value = value;
  select.classList.toggle('is-filtered', value !== FILTER_ALL);
  select.disabled = options.length <= 1;
  return value;
}

function sortQuotes(quotes) {
  const rows = [...quotes];
  if (state.quoteSort === 'newest') return rows.reverse();
  if (state.quoteSort === 'name') {
    return rows.sort((a, b) =>
      quoteSortKey(a.text).localeCompare(quoteSortKey(b.text), 'ko')
    );
  }
  return rows;
}

// 표정 목록은 세계관 목록에서 열리므로, 어느 캐릭터의 표정인지 따로 기억합니다.
function getExpressionCharacter() {
  return getCharacter(state.expressionCharacterId) ?? getCharacter(CHARACTER_IDS[0]);
}

export function initializeModals() {
  document.addEventListener('dialogue:quote-add', event => {
    const character = event.detail?.characterId ? getCharacter(event.detail.characterId) : null;
    if (character) openQuoteAddModal(character);
  });

  document.addEventListener('dialogue:quote-list', event => {
    const character = event.detail?.characterId ? getCharacter(event.detail.characterId) : null;
    if (character) openQuoteModal(character);
  });

  document.addEventListener('dialogue:worldview-change', () => {
    if (isModalOpen('quote-modal')) renderQuoteList();
    if (isModalOpen('expression-modal')) renderExpressionList();
  });

  // 캐릭터 이름이나 아이템이 바뀌면 떠 있는 목록의 글자도 맞춥니다.
  document.addEventListener('dialogue:settings-change', () => {
    renderExpressionTabs();
    if (isModalOpen('quote-modal')) renderQuoteList();
  });
  renderExpressionTabs();

  bindModalClosers([
    ['modal-close-btn', 'quote-modal'],
    ['quote-add-modal-close-btn', 'quote-add-modal'],
    ['quote-edit-modal-close-btn', 'quote-edit-modal'],
    ['expression-modal-close-btn', 'expression-modal'],
    ['exp-edit-modal-close-btn', 'expression-edit-modal'],
    ['exp-select-close-btn', 'expression-select-modal'],
    ['item-select-close-btn', 'item-select-modal'],
    ['item-detail-close-btn', 'item-detail-modal'],
    ['worldview-select-close-btn', 'worldview-select-modal']
  ]);

  // DB 연결창은 js/modules/setup.js 가 직접 닫습니다. (처음 켤 때는 닫히면 안 됩니다)
  document.querySelectorAll('.modal-overlay:not(#setup-modal)').forEach(modal => {
    modal.addEventListener('click', event => {
      if (event.target === modal) hideModal(modal.id);
    });
  });

  const sortSelect = $('quote-sort-select');
  sortSelect.value = state.quoteSort;
  sortSelect.addEventListener('change', event => {
    state.quoteSort = event.target.value;
    try {
      localStorage.setItem(SORT_STORAGE_KEY, state.quoteSort);
    } catch {
      // 저장에 실패해도 이번 세션 동작에는 영향이 없습니다.
    }
    renderQuoteList();
  });

  $('quote-item-filter').addEventListener('change', event => {
    state.quoteItemFilter = event.target.value;
    renderQuoteList();
  });

  $('quote-expression-filter').addEventListener('change', event => {
    state.quoteExpressionFilter = event.target.value;
    renderQuoteList();
  });

  $('expression-manage-btn').addEventListener('click', () => openExpressionModal());

  for (const button of document.querySelectorAll('#expression-modal .character-tab-btn')) {
    button.addEventListener('click', event => {
      state.expressionCharacterId = event.currentTarget.dataset.characterId;
      openExpressionModal();
    });
  }

  $('quote-add-item-btn').addEventListener('click', () => openItemSelect({ kind: 'draft' }));
  $('quote-add-expression-btn').addEventListener('click', () => openExpressionSelect({ kind: 'draft' }));
  $('quote-add-worldview-btn').addEventListener('click', () => openWorldviewSelect({ kind: 'draft' }));

  $('quote-edit-item-btn').addEventListener('click', () => {
    if (state.editingQuoteId) openItemSelect({ kind: 'quote', quoteId: state.editingQuoteId });
  });
  $('quote-edit-expression-btn').addEventListener('click', () => {
    if (state.editingQuoteId) openExpressionSelect({ kind: 'quote', quoteId: state.editingQuoteId });
  });
  $('quote-edit-worldview-btn').addEventListener('click', () => {
    if (state.editingQuoteId) openWorldviewSelect({ kind: 'quote', quoteId: state.editingQuoteId });
  });
  $('quote-add-submit-btn').addEventListener('click', submitAddQuote);
  $('quote-edit-submit-btn').addEventListener('click', submitEditQuote);
  $('add-expression-btn').addEventListener('click', submitAddExpression);
  $('exp-edit-submit-btn').addEventListener('click', submitEditExpression);

  for (const inputId of ['quote-add-input', 'quote-edit-input', 'exp-name-input', 'exp-url-input', 'exp-edit-name-input', 'exp-edit-url-input']) {
    $(inputId).addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (inputId === 'quote-add-input') submitAddQuote();
      if (inputId === 'quote-edit-input') submitEditQuote();
      if (inputId === 'exp-name-input' || inputId === 'exp-url-input') submitAddExpression();
      if (inputId === 'exp-edit-name-input' || inputId === 'exp-edit-url-input') submitEditExpression();
    });
  }
}

// 모달 안의 모든 버튼/목록이 해당 캐릭터 색을 쓰도록 표시만 남깁니다. 색은 CSS가 결정합니다.
function applyCharacterTheme() {
  const characterId = state.activeCharacterId ?? '';
  for (const modalId of CHARACTER_THEMED_MODALS) {
    document.getElementById(modalId)?.setAttribute('data-character', characterId);
  }
}

function openQuoteAddModal(character) {
  state.activeCharacterId = character.id;
  applyCharacterTheme();

  // 아이템과 표정은 '기본', 세계관은 지금 고른 세계관이 기본값입니다.
  state.draftQuote = {
    character_id: character.id,
    text: '',
    item_id: '',
    expression_id: null,
    worldview_id: state.activeWorldviewId
  };

  $('quote-add-modal-title').textContent = `${character.name} 대사 추가`;
  $('quote-add-input').value = '';
  renderQuoteAddTags();
  showModal('quote-add-modal');
  $('quote-add-input').focus();
}

async function submitAddQuote() {
  const character = getActiveCharacter();
  const draft = state.draftQuote;
  if (!character || !draft) return;

  const text = $('quote-add-input').value;
  if (!text.trim()) return;

  const duplicate = findDuplicateQuote(character.id, text, draft.worldview_id);
  if (duplicate) {
    alert(`이미 같은 대사가 있습니다.\n\n"${duplicate.text}"`);
    return;
  }

  await runBusy(async () => {
    await character.addQuote(text, {
      itemId: draft.item_id,
      expressionId: draft.expression_id,
      worldviewId: draft.worldview_id
    });
    state.draftQuote = null;
    hideModal('quote-add-modal');
    if (isModalOpen('quote-modal')) renderQuoteList();
  }, '대사를 저장하지 못했습니다.');
}

function renderQuoteAddTags() {
  if (state.draftQuote) renderTagRow('quote-add', state.draftQuote);
}

function openQuoteModal(character) {
  state.activeCharacterId = character.id;
  applyCharacterTheme();
  $('modal-title').textContent = `${character.name} 대사 목록`;

  // 전체가 기본 상태입니다. 지난번에 걸어둔 조건 때문에
  // 목록이 비어 보이는 일이 없도록 열 때마다 되돌립니다.
  state.quoteItemFilter = FILTER_ALL;
  state.quoteExpressionFilter = FILTER_ALL;

  renderQuoteList();
  showModal('quote-modal');
}

function renderQuoteList() {
  const character = getActiveCharacter();
  if (!character) return;

  const list = $('modal-quote-list');
  list.replaceChildren();

  // 선택지는 거르기 전 목록에서 뽑습니다.
  // 아이템을 고른다고 표정 선택지가 줄어들면 헷갈리기 때문입니다.
  const visible = getVisibleQuotes(character.id);
  populateQuoteFilters(visible);

  const quotes = sortQuotes(visible.filter(matchesFilters));

  if (quotes.length === 0) {
    const worldview = getActiveWorldview();
    const empty = document.createElement('li');
    empty.className = 'empty-state';

    if (hasActiveFilter()) {
      empty.textContent = '고른 조건에 맞는 대사가 없습니다.';
    } else {
      empty.textContent = worldview
        ? `'${worldview.name}' 세계관에 등록된 대사가 없습니다.`
        : '등록된 대사가 없습니다.';
    }

    list.appendChild(empty);
    return;
  }

  for (const quote of quotes) {
    const row = document.createElement('li');
    row.className = 'quote-row';

    const text = document.createElement('span');
    text.className = 'quote-text';
    text.textContent = quote.text;

    const actions = document.createElement('div');
    actions.className = 'quote-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'quote-action-btn';
    editButton.textContent = '수정';
    editButton.addEventListener('click', () => openQuoteEditModal(quote));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-btn';
    deleteButton.textContent = '✕';
    deleteButton.setAttribute('aria-label', '대사 삭제');
    deleteButton.addEventListener('click', () => deleteQuoteRow(quote));

    actions.append(editButton, deleteButton);
    row.append(text, actions);
    list.appendChild(row);
  }
}

// 아이템 / 표정 / 세계관은 대사 수정 모달 안에서 바꿉니다.
/*
 * 아이템 / 표정 / 세계관 태그 줄.
 * 대사 추가창과 대사 수정창이 같은 모양을 쓰므로 한 함수로 그립니다.
 * prefix는 'quote-add' 또는 'quote-edit' 입니다.
 */
function renderTagRow(prefix, quote) {
  applyTagButton($(`${prefix}-item-btn`), getItemLabel(quote.item_id), '기본');

  const expression = getExpressionById(quote.expression_id);
  const expressionButton = $(`${prefix}-expression-btn`);
  applyTagButton(expressionButton, expression?.name, '기본');

  const mismatched = Boolean(expression) && !sameWorldview(expression.worldview_id, quote.worldview_id);
  expressionButton.classList.toggle('is-mismatched', mismatched);
  if (mismatched) {
    const other = state.worldviews.find(row => sameWorldview(row.id, expression.worldview_id));
    expressionButton.title = `'${other?.name ?? '미분류'}' 세계관의 표정입니다.`;
  }

  const worldview = state.worldviews.find(row => sameWorldview(row.id, quote.worldview_id));
  applyTagButton($(`${prefix}-worldview-btn`), worldview?.name, '미분류');
  $(`${prefix}-worldview-wrap`).hidden = !isWorldviewAvailable();
}

function renderQuoteEditTags(quote) {
  renderTagRow('quote-edit', quote);
}

// 색은 모달의 data-character 를 따라 CSS가 정합니다. (css/modals.css 의 --theme)
function applyTagButton(button, value, fallback) {
  const hasValue = String(value ?? '').trim() !== '';
  button.className = `quote-tag-btn ${hasValue ? 'active-tag' : 'default-tag'}`;
  button.textContent = hasValue ? value : fallback;
  button.title = hasValue ? value : fallback;
}

/* ------------------------------------------------------------------ */
/* 아이템 / 표정 / 세계관 선택창                                        */
/* ------------------------------------------------------------------ */

// 선택창이 지금 어떤 대사를 대상으로 열렸는지 돌려줍니다.
function getSelectSubject() {
  if (!selectTarget) return null;
  if (selectTarget.kind === 'draft') return state.draftQuote;
  const character = getActiveCharacter();
  if (!character) return null;
  return getQuotes(character.id).find(row => row.id === selectTarget.quoteId) ?? null;
}

// 고른 값을 반영합니다. 초안이면 메모리에만, 등록된 대사면 DB까지.
async function applySelectPatch(patch) {
  if (!selectTarget) return;

  if (selectTarget.kind === 'draft') {
    Object.assign(state.draftQuote, patch);
    renderQuoteAddTags();
    return;
  }

  await saveQuotePatch(selectTarget.quoteId, patch);
}

function openItemSelect(target) {
  selectTarget = target;
  if (!getSelectSubject()) return;

  populateItemSelectList(async itemId => {
    hideModal('item-select-modal');
    await applySelectPatch({ item_id: itemId });
  });
  showModal('item-select-modal');
}

/**
 * 지금 선택된 세계관이 아니라 "그 대사가 속한 세계관"의 표정만 보여줍니다.
 * 이름이 같은 표정이 여러 세계관에 있으면 목록에서 구분할 수가 없어
 * 엉뚱한 세계관의 표정을 붙이게 되기 때문입니다.
 */
function openExpressionSelect(target) {
  selectTarget = target;
  const quote = getSelectSubject();
  const character = getActiveCharacter();
  if (!quote || !character) return;

  const quoteWorldview = state.worldviews.find(row => sameWorldview(row.id, quote.worldview_id));
  $('expression-select-title').textContent = quoteWorldview
    ? `표정 선택 · ${quoteWorldview.name}`
    : '표정 선택';

  const list = $('expression-select-list');
  list.replaceChildren();

  const defaultLi = document.createElement('li');
  defaultLi.className = 'expression-select-item default-tag';
  defaultLi.textContent = '[기본] (이미지 없음)';
  defaultLi.addEventListener('click', async () => {
    hideModal('expression-select-modal');
    await applySelectPatch({ expression_id: null });
  });
  list.appendChild(defaultLi);

  const options = getExpressions(character.id).filter(row =>
    sameWorldview(row.worldview_id, quote.worldview_id)
  );

  if (options.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = quoteWorldview
      ? `'${quoteWorldview.name}' 세계관에 등록된 표정이 없습니다.`
      : '미분류 표정이 없습니다.';
    list.appendChild(empty);
  }

  for (const expression of options) {
    const li = document.createElement('li');
    li.className = 'expression-select-item';
    if (String(expression.id) === String(quote.expression_id)) li.classList.add('is-current');
    li.textContent = `[${expression.name}]`;
    li.addEventListener('click', async () => {
      hideModal('expression-select-modal');
      await applySelectPatch({ expression_id: expression.id });
    });
    list.appendChild(li);
  }

  showModal('expression-select-modal');
}

function openWorldviewSelect(target) {
  selectTarget = target;
  const quote = getSelectSubject();
  if (!quote) return;

  const list = $('worldview-select-list');
  list.replaceChildren();

  const defaultLi = document.createElement('li');
  defaultLi.className = 'expression-select-item default-tag';
  defaultLi.textContent = '[미분류] (세계관 없음)';
  defaultLi.addEventListener('click', () => chooseWorldview(quote, null));
  list.appendChild(defaultLi);

  if (state.worldviews.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '등록된 세계관이 없습니다.';
    list.appendChild(empty);
  }

  for (const worldview of state.worldviews) {
    const li = document.createElement('li');
    li.className = 'expression-select-item';
    if (sameWorldview(worldview.id, quote.worldview_id)) li.classList.add('is-current');
    li.textContent = `[${worldview.name}]`;
    li.addEventListener('click', () => chooseWorldview(quote, worldview.id));
    list.appendChild(li);
  }

  showModal('worldview-select-modal');
}

/*
 * 세계관을 옮길 때 표정도 같이 챙깁니다.
 * 표정은 세계관별로 따로 관리되므로, 옮긴 세계관에 같은 이름의 표정이 있으면
 * 그쪽으로 다시 연결하고, 없으면 물어본 뒤 표정을 해제합니다.
 */
async function chooseWorldview(quote, worldviewId) {
  if (sameWorldview(quote.worldview_id, worldviewId)) {
    hideModal('worldview-select-modal');
    return;
  }

  // 옮긴 세계관에 같은 대사가 이미 있으면 막습니다.
  const duplicate = findDuplicateQuote(quote.character_id, quote.text, worldviewId, quote.id);
  if (duplicate) {
    alert(`옮기려는 세계관에 이미 같은 대사가 있습니다.\n\n"${duplicate.text}"`);
    return;
  }

  const patch = { worldview_id: worldviewId ?? null };
  const current = getExpressionById(quote.expression_id);

  if (current && !sameWorldview(current.worldview_id, worldviewId)) {
    const replacement = getExpressions(quote.character_id).find(
      row => row.name === current.name && sameWorldview(row.worldview_id, worldviewId)
    );

    if (replacement) {
      patch.expression_id = replacement.id;
    } else {
      const moved = confirm(
        `옮기려는 세계관에 '${current.name}' 표정이 없습니다.\n\n표정을 해제하고 대사만 옮길까요?`
      );
      if (!moved) return;
      patch.expression_id = null;
    }
  }

  hideModal('worldview-select-modal');
  await applySelectPatch(patch);
}

function openQuoteEditModal(quote) {
  state.editingQuoteId = quote.id;
  state.editingQuote = quote;
  applyCharacterTheme();
  $('quote-edit-input').value = quote.text ?? '';
  renderQuoteEditTags(quote);
  showModal('quote-edit-modal');
  $('quote-edit-input').focus();
}

async function submitEditQuote() {
  const character = getActiveCharacter();
  const id = state.editingQuoteId;
  if (!character || !id) return;

  // 입력한 문장을 trim하여 재작성하지 않는다. 빈 문자열 여부만 별도로 검사한다.
  const newText = $('quote-edit-input').value;
  if (!newText.trim()) return;

  const duplicate = findDuplicateQuote(character.id, newText, state.editingQuote?.worldview_id, id);
  if (duplicate) {
    alert(`이미 같은 대사가 있습니다.\n\n"${duplicate.text}"`);
    return;
  }

  await runBusy(async () => {
    await character.updateQuote(id, { text: newText });
    hideModal('quote-edit-modal');
    state.editingQuoteId = null;
    state.editingQuote = null;
    renderQuoteList();
  }, '대사를 수정하지 못했습니다.');
}

async function deleteQuoteRow(quote) {
  const character = getActiveCharacter();
  if (!character || !confirm('정말 삭제하시겠습니까?')) return;

  await runBusy(async () => {
    await character.deleteQuote(quote.id);
    renderQuoteList();
  }, '대사를 삭제하지 못했습니다.');
}

function openExpressionModal() {
  const character = getExpressionCharacter();
  state.expressionCharacterId = character.id;

  const worldview = getActiveWorldview();
  $('expression-modal-title').textContent = worldview
    ? `표정 목록 · ${worldview.name}`
    : '표정 목록 · 전체';

  for (const button of document.querySelectorAll('#expression-modal .character-tab-btn')) {
    button.classList.toggle('is-active', button.dataset.characterId === character.id);
  }

  $('expression-modal').setAttribute('data-character', character.id);
  $('expression-edit-modal').setAttribute('data-character', character.id);
  renderExpressionList();
  showModal('expression-modal');
}

// 표정 목록 위의 A / B 전환 단추에 지금 이름을 씁니다.
function renderExpressionTabs() {
  for (const button of document.querySelectorAll('#expression-modal .character-tab-btn')) {
    button.textContent = getCharacterName(button.dataset.characterId);
  }
}

function renderExpressionList() {
  const character = getExpressionCharacter();
  if (!character) return;

  const list = $('expression-list');
  list.replaceChildren();
  const expressions = getVisibleExpressions(character.id);

  if (expressions.length === 0) {
    const worldview = getActiveWorldview();
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = worldview
      ? `'${worldview.name}' 세계관에 등록된 표정이 없습니다.`
      : '등록된 표정이 없습니다.';
    list.appendChild(empty);
    return;
  }

  for (const expression of expressions) {
    const row = document.createElement('li');
    row.className = 'expression-item';

    const info = document.createElement('span');
    info.className = 'quote-text';
    info.textContent = `[${expression.name}]`;

    const actions = document.createElement('div');
    actions.className = 'expression-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'quote-action-btn';
    edit.textContent = '수정';
    edit.addEventListener('click', () => openExpressionEditModal(expression));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-btn';
    del.textContent = '✕';
    del.setAttribute('aria-label', '표정 삭제');
    del.addEventListener('click', () => deleteExpressionRow(expression));

    actions.append(edit, del);
    row.append(info, actions);
    list.appendChild(row);
  }
}


// 만료되는 임시 링크면 한 번 알려주고, 그래도 쓰겠다면 그대로 진행합니다.
function confirmTemporaryUrl(url) {
  if (!isTemporaryDriveUrl(url)) return true;
  return confirm(
    '드라이브 미리보기에서 복사한 임시 주소로 보입니다.\n시간이 지나면 이미지가 깨집니다.\n\n' +
      '드라이브에서 파일 공유 링크를 복사해 쓰는 편이 좋습니다.\n그래도 이대로 등록할까요?'
  );
}

/*
 * 표정을 넣을 때와 고칠 때가 똑같이 거치던 검사입니다.
 * 두 곳에 같은 세 줄이 들어 있던 것을 하나로 모았습니다.
 * (비었는지 알리는 문구만 서로 달라서 그것만 받습니다)
 */
function expressionInputOk(name, url, emptyMessage) {
  if (!name || !url) {
    alert(emptyMessage);
    return false;
  }
  if (!isHttpUrl(url)) {
    alert('이미지 URL은 http:// 또는 https://로 시작해야 합니다.');
    return false;
  }
  return confirmTemporaryUrl(url);
}

async function submitAddExpression() {
  const character = getExpressionCharacter();
  if (!character) return;

  const name = $('exp-name-input').value.trim();
  const url = normalizeImageUrl($('exp-url-input').value);
  if (!expressionInputOk(name, url, '이름과 URL을 모두 입력해주세요.')) return;

  await runBusy(async () => {
    const row = await createExpression({
      characterId: character.id,
      name,
      url,
      worldviewId: state.activeWorldviewId
    });
    upsertLocalExpression(row);
    $('exp-name-input').value = '';
    $('exp-url-input').value = '';
    renderExpressionList();
  }, '표정을 저장하지 못했습니다.');
}

function openExpressionEditModal(expression) {
  state.editingExpressionId = expression.id;
  state.editingExpression = expression;
  $('exp-edit-name-input').value = expression.name ?? '';
  $('exp-edit-url-input').value = expression.url ?? '';
  showModal('expression-edit-modal');
}

async function submitEditExpression() {
  const character = getExpressionCharacter();
  if (!character || !state.editingExpressionId) return;

  const name = $('exp-edit-name-input').value.trim();
  const url = normalizeImageUrl($('exp-edit-url-input').value);
  if (!expressionInputOk(name, url, '표정 이름과 URL은 비워둘 수 없습니다.')) return;

  await runBusy(async () => {
    // 대사는 expression_id로만 표정을 가리키므로, 이름과 URL을 고쳐도
    // 따로 맞춰줄 곳이 없습니다. (예전의 동기화 트리거가 하던 일입니다)
    const row = await updateExpression(state.editingExpressionId, { name, url });
    upsertLocalExpression(row);

    state.editingExpressionId = null;
    state.editingExpression = null;
    hideModal('expression-edit-modal');
    renderExpressionList();
    if (isModalOpen('quote-modal')) renderQuoteList();
  }, '표정을 수정하지 못했습니다.');
}

async function deleteExpressionRow(expression) {
  const character = getExpressionCharacter();
  if (!character || !confirm(`'${expression.name}' 표정을 삭제하시겠습니까?`)) return;

  await runBusy(async () => {
    // DB는 on delete set null, 로컬은 removeLocalExpression이 함께 정리합니다.
    await deleteExpression(expression.id);
    removeLocalExpression(expression.id, character.id);

    renderExpressionList();
    if (isModalOpen('quote-modal')) renderQuoteList();
  }, '표정을 삭제하지 못했습니다.');
}

async function saveQuotePatch(quoteId, patch) {
  const character = getActiveCharacter();
  if (!character) return;

  await runBusy(async () => {
    const row = await character.updateQuote(quoteId, patch);
    upsertLocalQuote(row);
    renderQuoteList();

    // 대사 수정 모달을 열어둔 채 태그를 바꿨다면 그 안의 표시도 맞춥니다.
    if (state.editingQuoteId === quoteId) {
      state.editingQuote = row;
      renderQuoteEditTags(row);
    }
  }, '대사 설정을 저장하지 못했습니다.');
}

function getActiveCharacter() {
  return state.activeCharacterId ? getCharacter(state.activeCharacterId) : null;
}

