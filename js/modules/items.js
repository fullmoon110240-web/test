import { CHARACTER_DATA } from '../data/characters.js';
import { ITEM_SLOTS } from '../data/items.js';
import { getItem, getItems } from '../settings.js';
import { getCharacter } from './characters.js';
import { playPop } from './sfx.js';
import { showModal, $ } from '../ui.js';

/*
 * 아이템 칸 네 개.
 *
 *   빈 칸      누르면 이미지 · 이름 · 설명을 넣는 창이 열립니다. (modules/customize.js)
 *   채워진 칸  누르면 정보 창, 캐릭터에게 끌어다 놓으면 그 아이템 대사를 말합니다.
 *
 * HTML5 드래그앤드롭(dragstart/drop)은 모바일 브라우저가 터치로 발생시키지
 * 않습니다. 그래서 포인터 이벤트로 직접 구현합니다. 포인터 이벤트는 마우스와
 * 터치, 펜을 한 코드로 처리하므로 데스크톱 동작도 그대로 유지됩니다.
 */

const DRAG_THRESHOLD = 8;
const DROP_TARGETS = Object.values(CHARACTER_DATA).map(config => [config.cardId, config.id]);

let drag = null;
let suppressClick = false;
let detailItemId = null;

export function initializeItems() {
  document.querySelectorAll('.item-btn').forEach(button => {
    const itemId = button.dataset.itemId;
    if (!ITEM_SLOTS.includes(itemId)) return;

    button.addEventListener('click', () => {
      // 끌어놓기 직후에 따라오는 click은 무시합니다.
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const item = getItem(itemId);
      if (item) openItemDetail(item);
      else openItemEdit(itemId);
    });

    button.addEventListener('pointerdown', event => {
      // 빈 칸은 끌 것이 없습니다.
      if (getItem(itemId)) beginDrag(event, button, itemId);
    });
  });

  $('item-detail-edit-btn').addEventListener('click', () => {
    if (detailItemId) openItemEdit(detailItemId);
  });

  document.addEventListener('colliji:settings-change', renderItemSlots);
  renderItemSlots();
}

function openItemEdit(itemId) {
  document.dispatchEvent(new CustomEvent('colliji:item-edit', { detail: { itemId } }));
}

// 칸마다 채워졌는지 비었는지에 맞춰 그림과 이름표를 다시 겁니다.
function renderItemSlots() {
  document.querySelectorAll('.item-btn').forEach(button => {
    const itemId = button.dataset.itemId;
    const item = getItem(itemId);
    const image = button.querySelector('img');
    const number = ITEM_SLOTS.indexOf(itemId) + 1;

    button.classList.toggle('is-empty', !item);
    if (item) {
      if (image && image.getAttribute('src') !== item.image) image.src = item.image;
      if (image) image.alt = item.label;
      button.title = item.label;
      button.setAttribute('aria-label', item.label);
    } else {
      image?.removeAttribute('src');
      if (image) image.alt = '';
      button.title = `빈 아이템 칸 ${number} · 눌러서 추가`;
      button.setAttribute('aria-label', `빈 아이템 칸 ${number}, 눌러서 추가`);
    }
  });
}

function beginDrag(event, button, itemId) {
  if (drag || (event.button !== undefined && event.button !== 0)) return;

  drag = {
    pointerId: event.pointerId,
    itemId,
    button,
    startX: event.clientX,
    startY: event.clientY,
    started: false,
    ghost: null
  };
  suppressClick = false;

  // 포인터를 붙잡아 두면 손가락이 버튼 밖으로 나가도 계속 추적됩니다.
  button.setPointerCapture?.(event.pointerId);
  button.addEventListener('pointermove', onPointerMove);
  button.addEventListener('pointerup', onPointerUp);
  button.addEventListener('pointercancel', onPointerCancel);
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;

  if (!drag.started) {
    // 살짝 흔들린 탭까지 끌기로 치지 않도록 문턱을 둡니다.
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.started = true;
    drag.ghost = createGhost(drag.itemId, drag.button);
    drag.button.classList.add('is-dragging');
  }

  event.preventDefault();
  moveGhost(drag.ghost, event.clientX, event.clientY);
  highlightTarget(findDropTarget(event.clientX, event.clientY));
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;

  const { started, itemId } = drag;
  const target = started ? findDropTarget(event.clientX, event.clientY) : null;
  cleanup();

  // 움직이지 않았으면 그냥 탭입니다. click이 상세 창을 엽니다.
  if (!started) return;
  suppressClick = true;

  if (!target) return;
  const item = getItem(itemId);
  playPop();
  getCharacter(target.characterId)?.speakItemQuote(itemId, item?.label ?? itemId);
}

function onPointerCancel(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const started = drag.started;
  cleanup();
  if (started) suppressClick = true;
}

function cleanup() {
  if (!drag) return;
  const { button, pointerId, ghost } = drag;

  button.removeEventListener('pointermove', onPointerMove);
  button.removeEventListener('pointerup', onPointerUp);
  button.removeEventListener('pointercancel', onPointerCancel);
  if (button.hasPointerCapture?.(pointerId)) button.releasePointerCapture(pointerId);
  button.classList.remove('is-dragging');
  ghost?.remove();

  for (const [cardId] of DROP_TARGETS) {
    document.getElementById(cardId)?.classList.remove('drag-over');
  }
  drag = null;
}

// 손가락이나 커서 아래에 어떤 캐릭터 카드가 있는지 찾습니다.
// 따라다니는 이미지는 pointer-events: none이라 여기에 걸리지 않습니다.
function findDropTarget(x, y) {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  for (const [cardId, characterId] of DROP_TARGETS) {
    if (element.closest(`#${cardId}`)) {
      return { cardId, characterId };
    }
  }
  return null;
}

function highlightTarget(target) {
  for (const [cardId] of DROP_TARGETS) {
    document.getElementById(cardId)?.classList.toggle('drag-over', target?.cardId === cardId);
  }
}

function createGhost(itemId, button) {
  const rect = button.getBoundingClientRect();
  const ghost = document.createElement('img');
  ghost.className = 'item-drag-ghost';
  ghost.src = getItem(itemId)?.image ?? '';
  ghost.alt = '';
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  document.body.appendChild(ghost);
  return ghost;
}

function moveGhost(ghost, x, y) {
  if (!ghost) return;
  ghost.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(1.15)`;
}

function openItemDetail(item) {
  detailItemId = item.id;
  $('item-detail-img').src = item.image;
  $('item-detail-img').alt = item.label;
  $('item-detail-name').textContent = item.label;
  $('item-detail-desc').textContent = item.description;
  $('item-detail-desc').hidden = !item.description;
  showModal('item-detail-modal');
}

// 대사에 붙일 아이템 고르기. 채워진 칸만 나옵니다.
export function populateItemSelectList(onSelect) {
  const list = $('item-select-list');
  list.replaceChildren();

  const defaultItem = document.createElement('li');
  defaultItem.className = 'expression-select-item default-tag';
  defaultItem.textContent = '[기본] (아이템 없음)';
  defaultItem.addEventListener('click', () => onSelect(''));
  list.appendChild(defaultItem);

  const items = getItems();
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = '등록된 아이템이 없습니다. 아래 빈 아이템 칸을 눌러 넣어 주세요.';
    list.appendChild(empty);
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'expression-select-item';
    li.textContent = item.label;
    li.addEventListener('click', () => onSelect(item.id));
    list.appendChild(li);
  }
}
