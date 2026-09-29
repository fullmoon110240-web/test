import { CHARACTER_DATA, CHARACTER_IDS, DEFAULT_COLOR } from './data/characters.js';
import { ITEM_SLOTS } from './data/items.js';
import { deleteSetting, saveSetting } from './supabase.js';

/*
 * 화면에서 바꾸는 설정들. DB의 settings 표에 key / value(jsonb) 로 한 줄씩 들어갑니다.
 *
 *   character:char-a   { name, color, image }
 *   character:char-b   { name, color, image }
 *   item:item-1 ~ 4    { name, description, image }
 *   music              { src, artist }
 *   cursor             { char-a: 그림 주소, char-b: 그림 주소 }   마우스를 따라다니는 그림
 *
 * 바뀌면 'colliji:settings-change' 를 알립니다. 캐릭터 · 아이템 · 음악바가 듣고 다시 그립니다.
 */

const store = {
  characters: Object.create(null),
  items: Object.create(null),
  music: { src: '', artist: '' },
  cursor: Object.create(null)
};

const characterKey = id => `character:${id}`;
const itemKey = id => `item:${id}`;
const MUSIC_KEY = 'music';
const CURSOR_KEY = 'cursor';

const text = value => String(value ?? '').trim();

function cleanCharacter(value) {
  return { name: text(value?.name), color: normalizeHex(value?.color), image: text(value?.image) };
}

function cleanItem(value) {
  return { name: text(value?.name), description: text(value?.description), image: text(value?.image) };
}

function cleanMusic(value) {
  return { src: text(value?.src), artist: text(value?.artist) };
}

function cleanCursor(value) {
  const clean = {};
  for (const id of CHARACTER_IDS) clean[id] = text(value?.[id]);
  return clean;
}

export function loadSettings(rows) {
  store.characters = Object.create(null);
  store.items = Object.create(null);
  store.music = { src: '', artist: '' };
  store.cursor = cleanCursor({});

  for (const row of rows ?? []) {
    const key = String(row?.key ?? '');
    const value = row?.value && typeof row.value === 'object' ? row.value : {};

    if (key.startsWith('character:')) {
      const id = key.slice('character:'.length);
      if (CHARACTER_DATA[id]) store.characters[id] = cleanCharacter(value);
    } else if (key.startsWith('item:')) {
      const id = key.slice('item:'.length);
      if (ITEM_SLOTS.includes(id)) store.items[id] = cleanItem(value);
    } else if (key === MUSIC_KEY) {
      store.music = cleanMusic(value);
    } else if (key === CURSOR_KEY) {
      store.cursor = cleanCursor(value);
    }
  }

  applyTheme();
}

function notify() {
  document.dispatchEvent(new CustomEvent('colliji:settings-change'));
}

/* ------------------------------------------------------------------ */
/* 캐릭터                                                              */
/* ------------------------------------------------------------------ */

export function getCharacterName(id) {
  return store.characters[id]?.name || CHARACTER_DATA[id]?.defaultName || '';
}

export function getCharacterColor(id) {
  return store.characters[id]?.color || DEFAULT_COLOR;
}

export function getCharacterImage(id) {
  return store.characters[id]?.image || '';
}

// 설정창에 채워 넣을 값. 비어 있는 칸은 비어 있는 그대로 돌려줍니다.
export function getCharacterForm(id) {
  const saved = store.characters[id] ?? {};
  return { name: saved.name ?? '', color: saved.color ?? '', image: saved.image ?? '' };
}

export async function saveCharacterSettings(id, value) {
  const clean = cleanCharacter(value);
  await saveSetting(characterKey(id), clean);
  store.characters[id] = clean;
  applyTheme();
  notify();
}

/* ------------------------------------------------------------------ */
/* 아이템                                                              */
/* ------------------------------------------------------------------ */

export function isItemSlot(id) {
  return ITEM_SLOTS.includes(id);
}

export function itemNumber(id) {
  return ITEM_SLOTS.indexOf(id) + 1;
}

// 이름을 비워 두면 '아이템 1' 처럼 칸 번호로 부릅니다.
export function getItemLabel(id) {
  if (!isItemSlot(id)) return '';
  return store.items[id]?.name || `아이템 ${itemNumber(id)}`;
}

// 이미지가 들어 있는 칸만 '채워진 아이템'입니다. 빈 칸이면 null.
export function getItem(id) {
  const item = store.items[id];
  if (!item?.image) return null;
  return { id, ...item, label: getItemLabel(id) };
}

export function getItems() {
  return ITEM_SLOTS.map(getItem).filter(Boolean);
}

export function getItemForm(id) {
  const saved = store.items[id] ?? {};
  return { name: saved.name ?? '', description: saved.description ?? '', image: saved.image ?? '' };
}

export async function saveItem(id, value) {
  const clean = cleanItem(value);
  await saveSetting(itemKey(id), clean);
  store.items[id] = clean;
  notify();
}

export async function clearItem(id) {
  await deleteSetting(itemKey(id));
  delete store.items[id];
  notify();
}

/* ------------------------------------------------------------------ */
/* 기타: 마우스를 따라다니는 그림 · 배경 음악                              */
/* ------------------------------------------------------------------ */

// 넣지 않았으면 빈 문자열입니다. 빈 캐릭터는 마우스를 따라다니지 않습니다.
export function getCursorImage(id) {
  return store.cursor[id] || '';
}

export function getMusic() {
  return { ...store.music };
}

// 비어 있으면 줄을 지우고, 무엇이든 들어 있으면 저장합니다.
async function saveOrDelete(key, value) {
  if (Object.values(value).some(Boolean)) await saveSetting(key, value);
  else await deleteSetting(key);
}

// [설정 → 기타]의 저장 단추. 두 가지를 저장한 뒤 한 번만 알립니다.
export async function saveExtras({ cursor, music }) {
  const cleanCursorValue = cleanCursor(cursor);
  const cleanMusicValue = cleanMusic(music);

  // 앞의 것만 저장되고 뒤에서 실패해도, 저장된 만큼은 화면에 반영합니다.
  try {
    await saveOrDelete(CURSOR_KEY, cleanCursorValue);
    store.cursor = cleanCursorValue;

    await saveOrDelete(MUSIC_KEY, cleanMusicValue);
    store.music = cleanMusicValue;
  } finally {
    notify();
  }
}

/* ------------------------------------------------------------------ */
/* 컬러                                                                */
/* ------------------------------------------------------------------ */

/*
 * 캐릭터 컬러 하나에서 화면에 필요한 색 다섯 가지를 뽑아 CSS 변수로 겁니다.
 *
 *   --color-a             고른 색 그대로 (버튼 바탕 등)
 *   --color-a-text        흰 바탕 위 글자용. 너무 연하면 읽힐 만큼 어둡게 눌러 씁니다
 *   --color-a-on          그 색 바탕 위에 올릴 글자색 (흰색 또는 검정)
 *   --color-a-soft        아주 연한 바탕색
 *   --color-a-rgb         투명도를 줄 때 쓰는 r, g, b
 *   --color-a-shadow-rgb  그림자용으로 어둡게 한 r, g, b
 *
 * --color-mid 는 A와 B의 중간색입니다. 세계관처럼 어느 한쪽 것이 아닌 곳에 씁니다.
 * CSS(css/base.css)에는 회색으로 같은 변수가 미리 들어 있습니다.
 */
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const INK = [31, 35, 40];

export function normalizeHex(value) {
  let hex = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : '';
}

function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return `#${rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function mix(a, b, amount) {
  return a.map((c, i) => c + (b[i] - c) * amount);
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toHsl([r, g, b]) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = t => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map(v => v * 255);
}

/*
 * 흰 바탕에서 읽히는 글자색.
 * 연한 색(파스텔)은 색감은 그대로 두고 밝기만 낮춰서, 글자가 읽힐 만큼 진하게 만듭니다.
 * (검정을 섞으면 탁한 회색빛이 되므로 밝기만 내립니다)
 */
function readableOnWhite(rgb) {
  if (contrast(rgb, WHITE) >= 4.5) return rgb;
  const [h, s, l] = toHsl(rgb);
  for (let lightness = l; lightness >= 0; lightness -= 0.01) {
    const color = fromHsl([h, s, lightness]).map(Math.round);
    if (contrast(color, WHITE) >= 4.5) return color;
  }
  return INK;
}

function paletteVars(prefix, rgb) {
  const rounded = rgb.map(Math.round);
  return {
    [`--${prefix}`]: toHex(rounded),
    [`--${prefix}-text`]: toHex(readableOnWhite(rounded)),
    [`--${prefix}-on`]: contrast(rounded, WHITE) >= contrast(rounded, INK) ? '#ffffff' : toHex(INK),
    [`--${prefix}-soft`]: toHex(mix(rounded, WHITE, 0.9)),
    [`--${prefix}-rgb`]: rounded.join(', '),
    [`--${prefix}-shadow-rgb`]: mix(rounded, BLACK, 0.35).map(Math.round).join(', ')
  };
}

export function applyTheme() {
  const style = document.documentElement.style;
  const colors = CHARACTER_IDS.map(id => toRgb(getCharacterColor(id)));
  const vars = { ...paletteVars('color-mid', mix(colors[0], colors[1], 0.5)) };

  CHARACTER_IDS.forEach((id, index) => {
    Object.assign(vars, paletteVars(`color-${CHARACTER_DATA[id].slot}`, colors[index]));
  });

  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', toHex(colors[0]));
}
