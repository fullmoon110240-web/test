import { CHARACTER_DATA, CHARACTER_IDS, DEFAULT_COLOR } from '../data/characters.js';
import { clearStoredConnection, getBuiltInConnection, getConnection } from '../connection.js';
import {
  clearItem,
  getCharacterForm,
  getCharacterName,
  getCursorImage,
  getItem,
  getItemForm,
  getItemLabel,
  getMusic,
  isItemSlot,
  itemNumber,
  normalizeHex,
  saveCharacterSettings,
  saveExtras,
  saveItem
} from '../settings.js';
import { getQuotes } from '../state.js';
import { $, bindModalClosers, hideModal, isHttpUrl, runBusy, showModal } from '../ui.js';
import { ImagePicker } from './image-picker.js';
import { openSetupModal } from './setup.js';

/*
 * 화면에서 바꾸는 설정창 두 개.
 *
 *   설정 창     - 위의 [설정] 또는 비어 있는 캐릭터 칸을 누르면 열립니다.
 *                 A / B 탭: 기본 이미지 · 이름 · 컬러
 *                 기타 탭 : 마우스를 따라다니는 캐릭터 · 배경 음악 · DB 연결
 *   아이템 창   - 비어 있는 아이템 칸, 또는 아이템 정보의 [수정]을 누르면 열립니다.
 */

const ETC_TAB = 'etc';

let characterPicker = null;
let itemPicker = null;
// 기타 탭의 '마우스를 따라다니는 캐릭터' 그림 칸. 캐릭터 id -> ImagePicker
const cursorPickers = new Map();
let activeTab = CHARACTER_IDS[0];
let editingItemId = null;

export function initializeCustomize() {
  characterPicker = new ImagePicker($('character-image-picker'));
  itemPicker = new ImagePicker($('item-image-picker'));
  for (const id of CHARACTER_IDS) {
    cursorPickers.set(id, new ImagePicker($(`cursor-image-picker-${CHARACTER_DATA[id].slot}`)));
  }

  bindModalClosers([
    ['settings-close-btn', 'settings-modal'],
    ['item-edit-close-btn', 'item-edit-modal']
  ]);

  $('settings-open-btn').addEventListener('click', () => openSettings());
  for (const button of document.querySelectorAll('.settings-tab')) {
    button.addEventListener('click', () => openSettings(button.dataset.tab));
  }

  document.addEventListener('dialogue:character-setup', event => {
    openSettings(event.detail?.characterId);
  });
  document.addEventListener('dialogue:item-edit', event => openItemEdit(event.detail?.itemId));
  document.addEventListener('dialogue:settings-change', renderTabNames);

  // 색 고르기 칸과 #글자 칸을 서로 맞춥니다.
  const colorPicker = $('character-color-picker');
  const colorInput = $('character-color-input');
  colorPicker.addEventListener('input', () => {
    colorInput.value = colorPicker.value;
  });
  colorInput.addEventListener('input', () => {
    const hex = normalizeHex(colorInput.value);
    if (hex) colorPicker.value = hex;
  });
  $('character-color-reset').addEventListener('click', () => {
    colorInput.value = '';
    colorPicker.value = DEFAULT_COLOR;
  });

  $('character-save-btn').addEventListener('click', submitCharacter);
  $('etc-save-btn').addEventListener('click', submitEtc);
  $('db-change-btn').addEventListener('click', changeConnection);
  $('db-forget-btn').addEventListener('click', forgetConnection);
  $('item-save-btn').addEventListener('click', submitItem);
  $('item-clear-btn').addEventListener('click', clearItemSlot);

  submitOnEnter(['character-name-input', 'character-color-input'], submitCharacter);
  submitOnEnter(['music-src-input', 'music-artist-input'], submitEtc);
  submitOnEnter(['item-name-input'], submitItem);

  renderTabNames();
}

function submitOnEnter(ids, submit) {
  for (const id of ids) {
    $(id).addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      submit();
    });
  }
}

// 저장하는 동안 단추를 잠그고 '저장하는 중...'으로 바꿉니다. 올리기가 몇 초 걸릴 수 있습니다.
async function withButton(button, task, fallbackMessage, busyLabel = '저장하는 중...') {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await runBusy(task, fallbackMessage);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/* ------------------------------------------------------------------ */
/* 설정 창                                                              */
/* ------------------------------------------------------------------ */

// 탭과 '마우스를 따라다니는 캐릭터' 칸 이름표에 지금 캐릭터 이름을 씁니다.
function renderTabNames() {
  for (const button of document.querySelectorAll('.settings-tab')) {
    const id = button.dataset.tab;
    if (CHARACTER_DATA[id]) button.textContent = getCharacterName(id);
  }
  for (const id of CHARACTER_IDS) {
    $(`cursor-label-${CHARACTER_DATA[id].slot}`).textContent = getCharacterName(id);
  }
}

export function openSettings(tab = activeTab) {
  activeTab = CHARACTER_DATA[tab] || tab === ETC_TAB ? tab : CHARACTER_IDS[0];
  const isCharacter = Boolean(CHARACTER_DATA[activeTab]);

  for (const button of document.querySelectorAll('.settings-tab')) {
    button.classList.toggle('is-active', button.dataset.tab === activeTab);
  }

  $('settings-modal').setAttribute('data-character', isCharacter ? activeTab : 'mid');
  $('settings-character-panel').hidden = !isCharacter;
  $('settings-etc-panel').hidden = isCharacter;

  if (isCharacter) fillCharacterForm(activeTab);
  else fillEtcForm();

  showModal('settings-modal');
}

function fillCharacterForm(id) {
  const form = getCharacterForm(id);
  const defaultName = CHARACTER_DATA[id].defaultName;

  $('settings-modal-title').textContent = `${getCharacterName(id)} 설정`;
  characterPicker.reset(form.image);
  $('character-name-input').value = form.name;
  $('character-name-input').placeholder = `비우면 '${defaultName}'`;
  $('character-color-input').value = form.color;
  $('character-color-picker').value = form.color || DEFAULT_COLOR;
}

function fillEtcForm() {
  const music = getMusic();
  $('settings-modal-title').textContent = '기타 설정';
  for (const [id, picker] of cursorPickers) picker.reset(getCursorImage(id));
  $('music-src-input').value = music.src;
  $('music-artist-input').value = music.artist;

  const connection = getConnection();
  const builtIn = Boolean(getBuiltInConnection());
  $('db-status').textContent = connection
    ? `${connection.url}\n${builtIn ? 'js/config.js에 적힌 연결을 쓰고 있어요. 바꾸려면 그 파일을 고쳐 주세요.' : '이 브라우저에 저장된 연결이에요.'}`
    : '연결되어 있지 않아요.';
  $('db-change-btn').hidden = builtIn;
  $('db-forget-btn').hidden = builtIn;
}

async function submitCharacter() {
  const id = activeTab;
  if (!CHARACTER_DATA[id]) return;

  const name = $('character-name-input').value.trim();
  const colorText = $('character-color-input').value.trim();
  const color = colorText ? normalizeHex(colorText) : '';

  if (colorText && !color) {
    alert('컬러는 #6b7280 처럼 # 뒤에 여섯 자리로 적어 주세요.\n비워 두면 기본 회색입니다.');
    $('character-color-input').focus();
    return;
  }
  if (!characterPicker.validate()) return;

  await withButton($('character-save-btn'), async () => {
    const image = await characterPicker.resolve('characters');
    await saveCharacterSettings(id, { name, color, image });
    hideModal('settings-modal');
  }, '캐릭터 설정을 저장하지 못했습니다.');
}

// 기타 탭의 저장: 마우스를 따라다니는 그림과 배경 음악을 함께 저장합니다.
async function submitEtc() {
  const src = $('music-src-input').value.trim();
  const artist = $('music-artist-input').value.trim();

  if (src && !isHttpUrl(src)) {
    alert('음악 주소는 http:// 또는 https://로 시작해야 합니다.');
    return;
  }
  for (const picker of cursorPickers.values()) {
    if (!picker.validate()) return;
  }

  await withButton($('etc-save-btn'), async () => {
    // 파일을 고른 칸은 여기서 올립니다. 하나라도 실패하면 아무것도 저장하지 않습니다.
    const cursor = {};
    for (const [id, picker] of cursorPickers) cursor[id] = await picker.resolve('cursor');
    await saveExtras({ cursor, music: { src, artist } });
    hideModal('settings-modal');
  }, '기타 설정을 저장하지 못했습니다.');
}

async function changeConnection() {
  if (getBuiltInConnection()) return;
  hideModal('settings-modal');
  const next = await openSetupModal({ initial: getConnection(), closable: true });
  // 새 DB로 처음부터 다시 불러옵니다.
  if (next) location.reload();
}

function forgetConnection() {
  if (getBuiltInConnection()) return;
  const ok = confirm(
    '이 브라우저에 저장된 DB 연결 정보를 지울까요?\n\n' +
      'DB 안의 데이터는 그대로 남습니다. 다시 열면 연결 입력창이 뜹니다.'
  );
  if (!ok) return;
  clearStoredConnection();
  location.reload();
}

/* ------------------------------------------------------------------ */
/* 아이템 창                                                            */
/* ------------------------------------------------------------------ */

function openItemEdit(itemId) {
  if (!isItemSlot(itemId)) return;
  editingItemId = itemId;

  const form = getItemForm(itemId);
  const filled = Boolean(getItem(itemId));
  const label = getItemLabel(itemId);

  hideModal('item-detail-modal');
  $('item-edit-modal-title').textContent = filled ? `${label} 수정` : `${label} 추가`;
  itemPicker.reset(form.image);
  $('item-name-input').value = form.name;
  $('item-name-input').placeholder = `비우면 '아이템 ${itemNumber(itemId)}'`;
  $('item-desc-input').value = form.description;
  $('item-clear-btn').hidden = !filled;

  showModal('item-edit-modal');
}

async function submitItem() {
  const id = editingItemId;
  if (!isItemSlot(id)) return;

  if (itemPicker.isEmpty()) {
    alert('이미지를 넣어 주세요.\n이미지가 있어야 아이템 칸이 채워집니다.');
    return;
  }
  if (!itemPicker.validate()) return;

  const name = $('item-name-input').value.trim();
  const description = $('item-desc-input').value.trim();

  await withButton($('item-save-btn'), async () => {
    const image = await itemPicker.resolve('items');
    await saveItem(id, { name, description, image });
    editingItemId = null;
    hideModal('item-edit-modal');
  }, '아이템을 저장하지 못했습니다.');
}

function countItemQuotes(itemId) {
  return CHARACTER_IDS.reduce(
    (sum, id) => sum + getQuotes(id).filter(row => String(row.item_id ?? '') === itemId).length,
    0
  );
}

async function clearItemSlot() {
  const id = editingItemId;
  if (!isItemSlot(id)) return;

  const count = countItemQuotes(id);
  const ok = confirm(
    `'${getItemLabel(id)}' 칸을 비울까요?` +
      (count
        ? `\n\n이 아이템에 연결된 대사 ${count}개는 지워지지 않고 남습니다.\n이 칸에 새 아이템을 넣으면 그 대사들이 새 아이템에 이어집니다.`
        : '')
  );
  if (!ok) return;

  await withButton($('item-clear-btn'), async () => {
    await clearItem(id);
    editingItemId = null;
    hideModal('item-edit-modal');
  }, '아이템 칸을 비우지 못했습니다.', '비우는 중...');
}
