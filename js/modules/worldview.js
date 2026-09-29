import { CHARACTER_DATA, CHARACTER_IDS } from '../data/characters.js';
import { getCharacterName } from '../settings.js';
import {
  state,
  setActiveWorldview,
  setWorldviewImage,
  getWorldviewImage,
  upsertLocalWorldview,
  removeLocalWorldview
} from '../state.js';
import {
  createWorldview,
  deleteWorldview,
  getWorldviewReason,
  isWorldviewSupported,
  saveWorldviewImage,
  updateWorldview
} from '../supabase.js';
import { $, bindModalClosers, hideModal, isHttpUrl, isModalOpen, normalizeImageUrl, runBusy, showModal } from '../ui.js';

// 화면에 보이는 칸 수. 좌우로 무한히 이어 붙여 순환합니다.
const VISIBLE_SLOTS = 5;

/*
 * 평소에 흐르는 속도(초당 픽셀). 오른쪽에서 왼쪽으로 갑니다.
 * scrollLeft 가 늘어나면 내용이 왼쪽으로 밀립니다.
 */
const DRIFT = 26;

/*
 * 끌거나 밀었을 때 그 힘이 속도에 얹히는 정도와, 1초에 남는 비율.
 * 손을 떼면 0.06^t 로 줄어들어 1초 안에 원래 속도로 돌아옵니다.
 */
const PUSH_GAIN = 0.85;
const PUSH_KEEP = 0.06;
const PUSH_MAX = 900;

/*
 * 가운데에 가까울수록 커집니다.
 * 한 칸 멀어질 때마다 FALLOFF 만큼 작아지고, MIN_SCALE 아래로는 안 갑니다.
 * (보내주신 gif 에서 가운데 92px, 한 칸 옆 76px, 두 칸 옆 60px 이었습니다)
 */
const FALLOFF = 0.19;
const MIN_SCALE = 0.62;
const STORAGE_KEY = 'colliji:active-worldview';
const DRAG_THRESHOLD = 6;

let bar = null;
let viewport = null;
let track = null;

let available = false;
let looping = false;
let listWidth = 0;
let dragging = false;
let dragStartX = 0;
let dragStartScroll = 0;
let dragDistance = 0;

// 흐름용
let frame = 0;
let lastTime = 0;
let lastSet = null;    // 우리가 마지막으로 써 넣은 scrollLeft
let push = 0;          // 사용자가 민 힘. 시간이 지나면 0으로 돌아옵니다.

/*
 * 아직 옮기지 못한 소수점 이하 거리.
 *
 * scrollLeft 는 정수로만 저장됩니다. 한 프레임에 0.43px 씩 더하면
 * 매번 반올림되어 사라지고 영영 움직이지 않습니다.
 * 그래서 1px 이 모일 때까지 여기에 쌓아 둡니다.
 */
let pending = 0;

/*
 * 고른 세계관을 가운데로 데려갈 목표 위치.
 * null 이면 데려갈 것이 없다는 뜻입니다.
 */
let centerTarget = null;

/*
 * 가운데 맞추기를 몇 번 더 손봤는지.
 *
 * 데려가는 도중에 목록이 한 바퀴 감기면 좌표가 살짝 어긋납니다.
 * 다 온 뒤에 한 번 더 재서 바로잡습니다. 두 번까지만 합니다.
 */
let centerPasses = 0;
let touching = false;  // 손가락이나 마우스가 닿아 있는 동안
let suppressClick = false;

/**
 * 저장해 둔 선택을 state에 복원합니다.
 * 캐릭터를 만들기 전에 불러야 첫 화면부터 올바른 기본 이미지가 나옵니다.
 */
export function restoreWorldviewSelection() {
  if (!state.worldviewSupported) return null;
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }

  const applied = setActiveWorldview(saved);
  if (saved && !applied) {
    // 저장된 세계관이 사라졌으면 기록도 지웁니다.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 무시
    }
  }
  return applied;
}

export function isWorldviewAvailable() {
  return isWorldviewSupported() && state.worldviewSupported;
}

export function initializeWorldview() {
  bar = document.getElementById('worldview-bar');
  if (!bar) return;

  viewport = $('worldview-viewport');
  track = $('worldview-track');

  // 세계관 스키마가 아직 없어도 바는 항상 보여줍니다.
  // 조용히 사라지면 무엇이 잘못됐는지 알 수가 없기 때문입니다.
  available = isWorldviewAvailable();
  bar.classList.toggle('is-unavailable', !available);

  bindBarEvents();
  bindModalEvents();
  renderTrack();
}

function warnUnavailable() {
  const reason = getWorldviewReason();
  alert(
    '세계관 기능을 아직 쓸 수 없습니다.\n\n' +
      'Supabase SQL Editor에서 supabase/schema.sql을 실행한 뒤 새로고침해 주세요.' +
      (reason ? `\n\n(원인: ${reason})` : '')
  );
}

/* ------------------------------------------------------------------ */
/* 버튼 바                                                             */
/* ------------------------------------------------------------------ */

function bindBarEvents() {
  track.addEventListener('click', event => {
    const button = event.target.closest('.worldview-btn');
    if (!button) return;
    if (!available) {
      warnUnavailable();
      return;
    }
    if (button.disabled) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const id = button.dataset.worldviewId;
    // 같은 버튼을 다시 누르면 해제됩니다. 중복 선택은 되지 않습니다.
    applySelection(state.activeWorldviewId === id ? null : id);
  });

  viewport.addEventListener('scroll', wrapScroll, { passive: true });

  // 터치는 브라우저 기본 가로 스크롤을 그대로 쓰고, 마우스만 직접 끌어줍니다.
  // 손가락 스크롤도 '닿아 있는 동안'으로 칩니다.
  viewport.addEventListener('touchstart', () => { touching = true; centerTarget = null; }, { passive: true });
  for (const type of ['touchend', 'touchcancel']) {
    viewport.addEventListener(type, () => { touching = false; }, { passive: true });
  }

  viewport.addEventListener('pointerdown', event => {
    if (!looping || event.pointerType === 'touch' || event.button !== 0) return;
    touching = true;
    centerTarget = null;   // 손을 대면 데려가던 것을 그만둡니다
    dragging = true;
    dragDistance = 0;
    suppressClick = false;
    dragStartX = event.clientX;
    dragStartScroll = viewport.scrollLeft;
    viewport.classList.add('is-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  window.addEventListener('resize', () => {
    if (looping) requestAnimationFrame(primeScroll);
    else resizeButtons();
  });

  // 다른 탭에 가 있는 동안에는 흐름을 멈춥니다.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopFlow();
    else startFlow();
  });
}

function onPointerMove(event) {
  if (!dragging) return;
  const delta = event.clientX - dragStartX;
  dragDistance = Math.max(dragDistance, Math.abs(delta));
  viewport.scrollLeft = dragStartScroll - delta;
}

function onPointerUp() {
  touching = false;
  if (!dragging) return;
  dragging = false;
  suppressClick = dragDistance > DRAG_THRESHOLD;
  viewport.classList.remove('is-dragging');
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
}

/**
 * 목록을 세 벌 이어 붙여 두고, 양 끝에 닿기 전에 한 벌만큼 순간이동시킵니다.
 * 첫 버튼 왼쪽에서 마지막 버튼이, 마지막 버튼 오른쪽에서 첫 버튼이 이어집니다.
 */
function wrapScroll() {
  if (!looping || !listWidth) return;

  const current = viewport.scrollLeft;
  let shift = 0;
  if (current < listWidth * 0.5) shift = listWidth;
  else if (current > listWidth * 1.5) shift = -listWidth;
  if (!shift) return;

  jumpTo(current + shift);

  /*
   * 순간이동했으면 '어디를 기준으로 삼고 있었는지'도 같은 만큼 옮깁니다.
   *
   * 가운데로 데려가는 목표를 안 옮기면, 목표가 갑자기 한 벌만큼 멀어집니다.
   * 그러면 그쪽으로 달려가다 또 경계를 넘어 또 순간이동하고,
   * 영원히 빙빙 돌게 됩니다.
   */
  if (dragging) dragStartScroll += shift;
  if (centerTarget !== null) centerTarget += shift;
}

function jumpTo(position) {
  const previous = viewport.style.scrollBehavior;
  viewport.style.scrollBehavior = 'auto';
  viewport.scrollLeft = position;
  viewport.style.scrollBehavior = previous;
  // 우리가 옮긴 것이므로 '사용자가 민 양'으로 세지 않습니다.
  lastSet = viewport.scrollLeft;
}

function primeScroll() {
  if (!looping) {
    listWidth = 0;
    jumpTo(0);
    resizeButtons();
    return;
  }
  listWidth = viewport.scrollWidth / 3;
  jumpTo(listWidth);
  resizeButtons();

  // 이미 고른 세계관이 있으면(지난번에 고른 것을 되살린 경우) 가운데로 데려옵니다.
  centerOnSelected();
}

/* ------------------------------------------------------------------ */
/* 흐름                                                                */
/* ------------------------------------------------------------------ */

/*
 * 가운데에 가까운 버튼일수록 크게 그립니다.
 *
 * 폭을 실제로 바꾸면 매 프레임 배치가 다시 계산돼 무거워집니다.
 * transform 만 건드리면 그리기만 다시 하므로 훨씬 가볍습니다.
 */
function resizeButtons() {
  if (!viewport) return;

  const box = viewport.getBoundingClientRect();
  const middle = box.left + box.width / 2;
  const slot = box.width / VISIBLE_SLOTS;
  if (!slot) return;

  for (const cell of track.querySelectorAll('.worldview-slot')) {
    // 가운데를 기준으로 줄이므로, 줄여도 가운데 좌표는 그대로입니다.
    const rect = cell.getBoundingClientRect();
    const away = Math.abs(rect.left + rect.width / 2 - middle) / slot;
    const scale = Math.max(MIN_SCALE, 1 - FALLOFF * away);
    cell.style.setProperty('--flow-scale', scale.toFixed(3));
  }
}

// 세계관을 고르면 멈춥니다. 고른 것을 가만히 보게 하려는 것입니다.
function flowing() {
  return looping && available && !state.activeWorldviewId;
}

function step(now) {
  frame = requestAnimationFrame(step);

  const dt = Math.min((now - lastTime) / 1000, 0.1);   // 탭을 다시 열 때 튀지 않게
  lastTime = now;
  if (!dt) return;

  /*
   * 고른 세계관을 가운데로 데려가는 중이면 그것만 합니다.
   * 남은 거리의 일정 비율씩 줄여 가므로 끝에서 부드럽게 멎습니다.
   */
  if (centerTarget !== null) {
    const here = viewport.scrollLeft;
    const left = centerTarget - here;
    if (Math.abs(left) < 1) {
      viewport.scrollLeft = Math.round(centerTarget);
      centerTarget = null;

      // 다 왔으면 한 번 더 재 봅니다. 이미 맞으면 그대로 끝납니다.
      if (centerPasses < 2) {
        centerPasses++;
        centerOnSelected(false);
      }
    } else {
      /*
       * scrollLeft 은 정수로만 저장됩니다.
       * 거의 다 와서 한 프레임에 1px 이 안 되게 움직이면 반올림에 먹혀
       * 제자리에 머물고, 영영 '다 왔다'가 되지 않습니다.
       * 남은 거리가 1px 이상이면 적어도 1px 은 가게 합니다.
       */
      const by = left * (1 - Math.pow(0.004, dt));
      viewport.scrollLeft = here + (Math.abs(by) < 1 ? Math.sign(left) : by);
    }
    lastSet = viewport.scrollLeft;
    pending = 0;
    resizeButtons();
    return;
  }

  /*
   * 우리가 써 넣은 값과 지금 값이 다르면, 그 사이에 사용자가 민 것입니다.
   * 손가락 스크롤이든 마우스 끌기든 똑같이 여기서 잡힙니다.
   */
  const actual = viewport.scrollLeft;
  if (lastSet !== null) {
    const moved = actual - lastSet;
    if (Math.abs(moved) > 0.5) {
      push += (moved / dt) * PUSH_GAIN;
      push = Math.max(-PUSH_MAX, Math.min(PUSH_MAX, push));
    }
  }

  // 민 힘은 시간이 지나면 사라집니다.
  push *= Math.pow(PUSH_KEEP, dt);
  if (Math.abs(push) < 1) push = 0;

  // 손이 닿아 있는 동안에는 우리가 밀지 않습니다. 사용자와 싸우게 됩니다.
  const speed = touching ? 0 : (flowing() ? DRIFT : 0) + push;

  pending += speed * dt;
  const move = Math.trunc(pending);
  if (move) {
    pending -= move;
    viewport.scrollLeft = actual + move;
    wrapScroll();
  }

  const moving = move !== 0 || Math.abs(actual - (lastSet ?? actual)) > 0.5;
  lastSet = viewport.scrollLeft;

  /*
   * 움직이지 않았으면 다시 재지 않습니다.
   * 칸마다 위치를 재는 일이라, 가만히 있을 때까지 매 프레임 하면 낭비입니다.
   * (세계관을 골라 멈춰 있는 동안이 그렇습니다)
   */
  if (moving) resizeButtons();
}

function startFlow() {
  if (frame) return;
  lastTime = performance.now();
  lastSet = viewport.scrollLeft;
  pending = 0;
  frame = requestAnimationFrame(step);
}

function stopFlow() {
  if (!frame) return;
  cancelAnimationFrame(frame);
  frame = 0;
}

function renderTrack() {
  const worldviews = state.worldviews;

  /*
   * 두 개만 있어도 흐르게 합니다. 예전에는 칸 수보다 많을 때만 순환했는데,
   * 이제는 늘 흐르고 있어야 하기 때문입니다.
   *
   * 한 벌이 화면보다 짧으면 넘길 자리가 안 생기므로,
   * 한 벌이 화면을 채울 만큼 반복해서 '한 덩어리'를 만들고 그것을 세 벌 잇습니다.
   */
  looping = worldviews.length >= 2;

  let slots;
  if (looping) {
    const times = Math.max(1, Math.ceil(VISIBLE_SLOTS / worldviews.length));
    const block = [];
    for (let i = 0; i < times; i++) block.push(...worldviews);
    slots = [...block, ...block, ...block];
  } else {
    slots = padToVisible(worldviews);
  }

  track.replaceChildren(...slots.map(createSlot));
  viewport.classList.toggle('is-scrollable', looping);
  syncActiveButtons();
  requestAnimationFrame(() => {
    primeScroll();
    startFlow();
  });
}

// 세계관이 5개 이하면 남는 칸은 이름 없는 비활성 버튼으로 채웁니다.
function padToVisible(worldviews) {
  const slots = worldviews.slice(0, VISIBLE_SLOTS);
  while (slots.length < VISIBLE_SLOTS) slots.push(null);
  return slots;
}

function createSlot(worldview) {
  const slot = document.createElement('div');
  slot.className = 'worldview-slot';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'worldview-btn';

  const label = document.createElement('span');
  label.className = 'worldview-btn-label';

  if (!worldview) {
    button.classList.add('is-empty');
    button.disabled = true;
    button.tabIndex = -1;
    button.setAttribute('aria-hidden', 'true');
  } else {
    button.dataset.worldviewId = String(worldview.id);
    label.textContent = worldview.name;
    button.title = worldview.name;
    button.setAttribute('aria-pressed', 'false');
  }

  button.appendChild(label);
  slot.appendChild(button);
  return slot;
}

function syncActiveButtons() {
  for (const button of track.querySelectorAll('.worldview-btn')) {
    if (!button.dataset.worldviewId) continue;
    const active = button.dataset.worldviewId === state.activeWorldviewId;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function applySelection(worldviewId) {
  const applied = setActiveWorldview(worldviewId);

  try {
    if (applied) localStorage.setItem(STORAGE_KEY, applied);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장에 실패해도 이번 세션 동작에는 영향이 없습니다.
  }

  syncActiveButtons();
  centerOnSelected();
  document.dispatchEvent(
    new CustomEvent('colliji:worldview-change', { detail: { worldviewId: applied } })
  );
}

/*
 * 고른 세계관을 가운데로 데려옵니다.
 *
 * 같은 버튼이 세 벌 깔려 있으므로, 지금 화면 가운데에서 가장 가까운 한 벌을 고릅니다.
 * 멀리 있는 것을 고르면 바가 화면을 가로질러 휙 지나갑니다.
 */
function centerOnSelected(fresh = true) {
  if (fresh) centerPasses = 0;

  if (!viewport || !state.activeWorldviewId) {
    centerTarget = null;
    return;
  }

  const box = viewport.getBoundingClientRect();
  const middle = box.left + box.width / 2;

  let best = null;
  for (const button of track.querySelectorAll('.worldview-btn')) {
    if (button.dataset.worldviewId !== state.activeWorldviewId) continue;
    const rect = button.getBoundingClientRect();
    const away = rect.left + rect.width / 2 - middle;
    if (!best || Math.abs(away) < Math.abs(best)) best = away;
  }
  if (best === null) return;

  push = 0;                       // 데려가는 중에는 여운이 끼어들지 않게
  centerTarget = viewport.scrollLeft + best;
}

/* ------------------------------------------------------------------ */
/* 모달                                                                */
/* ------------------------------------------------------------------ */

function bindModalEvents() {
  bindModalClosers([
    ['worldview-list-close-btn', 'worldview-list-modal'],
    ['worldview-edit-close-btn', 'worldview-edit-modal']
  ]);

  $('worldview-list-btn').addEventListener('click', () => {
    if (!available) return warnUnavailable();
    openWorldviewListModal();
  });

  $('worldview-add-submit-btn').addEventListener('click', submitAddWorldview);
  $('worldview-edit-submit-btn').addEventListener('click', submitEditWorldview);

  $('worldview-add-input').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitAddWorldview();
  });

  $('worldview-edit-input').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submitEditWorldview();
  });

  for (const id of CHARACTER_IDS) {
    $(worldviewImageInputId(id)).addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submitEditWorldview();
    });
  }
}

async function submitAddWorldview() {
  const input = $('worldview-add-input');
  const name = input.value.trim();
  if (!name) return;

  if (state.worldviews.some(row => row.name.toLowerCase() === name.toLowerCase())) {
    alert('같은 이름의 세계관이 이미 있습니다.');
    return;
  }

  await runBusy(async () => {
    const sortOrder = state.worldviews.length
      ? Math.max(...state.worldviews.map(row => Number(row.sort_order ?? 0))) + 1
      : 0;
    const row = await createWorldview({ name, sortOrder });
    upsertLocalWorldview(row);
    input.value = '';
    renderTrack();
    if (isModalOpen('worldview-list-modal')) renderWorldviewList();
  }, '세계관을 저장하지 못했습니다.');
}

function openWorldviewListModal() {
  $('worldview-add-input').value = '';
  renderWorldviewList();
  showModal('worldview-list-modal');
}

function renderWorldviewList() {
  const list = $('worldview-list');
  list.replaceChildren();

  if (state.worldviews.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '등록된 세계관이 없습니다. + 로 추가하세요.';
    list.appendChild(empty);
    return;
  }

  for (const worldview of state.worldviews) {
    const row = document.createElement('li');
    row.className = 'worldview-row';
    if (String(worldview.id) === state.activeWorldviewId) row.classList.add('is-active');

    const name = document.createElement('span');
    name.className = 'worldview-row-name';
    name.textContent = worldview.name;

    const actions = document.createElement('div');
    actions.className = 'worldview-row-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'worldview-action-btn';
    editButton.textContent = '수정';
    editButton.addEventListener('click', () => openWorldviewEditModal(worldview));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-btn';
    deleteButton.textContent = '✕';
    deleteButton.setAttribute('aria-label', '세계관 삭제');
    deleteButton.addEventListener('click', () => deleteWorldviewRow(worldview));

    actions.append(editButton, deleteButton);
    row.append(name, actions);
    list.appendChild(row);
  }
}

// 세계관 수정창의 캐릭터별 기본 이미지 칸. (index.html 의 worldview-image-a-input 등)
function worldviewImageInputId(characterId) {
  return `worldview-image-${CHARACTER_DATA[characterId].slot}-input`;
}

function openWorldviewEditModal(worldview) {
  state.editingWorldviewId = worldview.id;
  $('worldview-edit-modal-title').textContent = `${worldview.name} 수정`;
  $('worldview-edit-input').value = worldview.name ?? '';
  for (const id of CHARACTER_IDS) {
    const slot = CHARACTER_DATA[id].slot;
    $(`worldview-image-${slot}-label`).textContent = `${getCharacterName(id)} 기본 이미지`;
    $(worldviewImageInputId(id)).value = getWorldviewImage(worldview.id, id);
  }
  showModal('worldview-edit-modal');
  $('worldview-edit-input').focus();
}

async function submitEditWorldview() {
  const id = state.editingWorldviewId;
  if (!id) return;

  const name = $('worldview-edit-input').value.trim();
  if (!name) return;

  const duplicated = state.worldviews.some(
    row => String(row.id) !== String(id) && row.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicated) {
    alert('같은 이름의 세계관이 이미 있습니다.');
    return;
  }

  const images = CHARACTER_IDS.map(id => [id, normalizeImageUrl($(worldviewImageInputId(id)).value)]);

  for (const [characterId, url] of images) {
    if (url && !isHttpUrl(url)) {
      const label = getCharacterName(characterId);
      alert(`${label} 기본 이미지 URL은 http:// 또는 https://로 시작해야 합니다.`);
      return;
    }
  }

  await runBusy(async () => {
    const current = state.worldviews.find(row => String(row.id) === String(id));
    if (!current || current.name !== name) {
      upsertLocalWorldview(await updateWorldview(id, { name }));
    }

    for (const [characterId, url] of images) {
      if (getWorldviewImage(id, characterId) === url) continue;
      await saveWorldviewImage({ worldviewId: id, characterId, url });
      setWorldviewImage(id, characterId, url);
    }

    state.editingWorldviewId = null;
    hideModal('worldview-edit-modal');
    renderTrack();
    renderWorldviewList();
    notifyWorldviewChanged();
  }, '세계관을 수정하지 못했습니다.');
}

async function deleteWorldviewRow(worldview) {
  const confirmed = confirm(
    `'${worldview.name}' 세계관을 삭제하시겠습니까?\n\n이 세계관의 대사와 표정은 지워지지 않고 미분류로 남습니다.`
  );
  if (!confirmed) return;

  await runBusy(async () => {
    const wasActive = String(worldview.id) === state.activeWorldviewId;
    await deleteWorldview(worldview.id);
    removeLocalWorldview(worldview.id);

    renderTrack();
    renderWorldviewList();

    if (wasActive) applySelection(null);
    else notifyWorldviewChanged();
  }, '세계관을 삭제하지 못했습니다.');
}

/* ------------------------------------------------------------------ */
/* 공용                                                                */
/* ------------------------------------------------------------------ */

// 선택은 그대로 둔 채, 목록을 다시 그려야 할 때만 알립니다.
function notifyWorldviewChanged() {
  document.dispatchEvent(
    new CustomEvent('colliji:worldview-change', { detail: { worldviewId: state.activeWorldviewId } })
  );
}

