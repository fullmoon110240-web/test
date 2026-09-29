import { CHARACTER_DATA } from '../data/characters.js';
import {
  state,
  getQuotes,
  getVisibleQuotes,
  getVisibleExpressions,
  getWorldviewImage,
  getExpressionById,
  upsertLocalQuote,
  removeLocalQuote
} from '../state.js';
import { getCharacterColor, getCharacterImage, getCharacterName } from '../settings.js';
import { createQuote, deleteQuote, updateQuote } from '../supabase.js';
import { $ } from '../ui.js';
import { playPop } from './sfx.js';

// 이 파일 안에서만 씁니다. 바깥에서는 getCharacter() 로 가져갑니다.
const characters = new Map();

// 말풍선이 떠 있는 시간. 예전 4초에서 두 배로 늘렸습니다.
const BUBBLE_DURATION = 8000;

// A와 B 말풍선이 겹칠 때 나중에 말한 쪽이 위로 오도록,
// 말할 때마다 z-index를 하나씩 올려서 붙입니다.
let bubbleStackOrder = 10;

/*
 * 말풍선을 띄운 채로 두는 모드. AUTO 를 켜면 켜집니다.
 * 켜져 있는 동안에는 시간이 지나도 사라지지 않고, 다음 대사로 갈아끼워집니다.
 */
let bubblesHeld = false;

export function setBubblesHeld(on) {
  bubblesHeld = Boolean(on);

  for (const character of characters.values()) {
    if (bubblesHeld) {
      // 사라질 예정이던 것을 취소합니다.
      if (character.timer) {
        clearTimeout(character.timer);
        character.timer = null;
      }
    } else if (character.bubble.style.display === 'block') {
      // 붙잡기를 풀면, 지금 떠 있는 것부터 평소대로 사라집니다.
      character.scheduleHide();
    }
  }
}

class ShimejiCharacter {
  constructor(config) {
    this.config = config;
    this.element = $(config.avatarId);
    this.image = $(config.imageId);
    this.bubble = $(config.bubbleId);
    this.card = $(config.cardId);
    this.addButton = $(config.addButtonId);
    this.listButton = $(config.listButtonId);
    this.timer = null;

    this.image.addEventListener('error', () => this.handleImageError());
    this.bindEvents();
    this.refreshLabels();
    this.setImage(this.defaultImage);
  }

  get id() { return this.config.id; }

  // [설정]에서 넣은 기본 이미지. 비어 있으면 빈 칸으로 보입니다.
  get fallbackImage() {
    return getCharacterImage(this.id);
  }

  // 말풍선이 없는 평상시 이미지.
  // 세계관이 선택되어 있으면 그 세계관의 기본 이미지를, 없으면 원래 기본 이미지를 씁니다.
  get defaultImage() {
    return getWorldviewImage(state.activeWorldviewId, this.id) || this.fallbackImage;
  }

  /**
   * 대사를 말할 때 쓸 기본 이미지.
   *
   * 세계관을 전부 해제하면 모든 세계관의 대사가 섞여 나옵니다.
   * 이때는 "지금 선택된 세계관"이 아니라 "그 대사가 속한 세계관"을 따라가야
   * 세계관마다 그 세계관의 모습으로 말합니다.
   * 미분류 대사이거나 그 세계관에 지정된 이미지가 없으면 원래 기본 이미지를 씁니다.
   */
  baseImageFor(quote) {
    const worldviewId = quote?.worldview_id ?? state.activeWorldviewId;
    return getWorldviewImage(worldviewId, this.id) || this.fallbackImage;
  }

  get name() { return getCharacterName(this.id); }
  get color() { return getCharacterColor(this.id); }

  // 이미지가 없으면 칸을 비워 두고, 누르면 이미지를 넣을 수 있게 합니다.
  get isEmpty() {
    return this.element.classList.contains('is-empty');
  }

  setImage(src) {
    const value = String(src ?? '').trim();
    this.element.classList.toggle('is-empty', !value);
    if (value) {
      if (this.image.getAttribute('src') !== value) this.image.src = value;
    } else {
      this.image.removeAttribute('src');
    }
  }

  // 이미지가 깨지면 엑박 대신 원래 기본 이미지로 돌아가고, 그것도 깨지면 빈 칸으로 둡니다.
  handleImageError() {
    const failed = this.image.getAttribute('src');
    if (!failed) return;
    console.warn(`[image] 불러오지 못했습니다: ${failed}`);
    const fallback = this.fallbackImage;
    this.setImage(fallback && failed !== fallback ? fallback : '');
  }

  // 이름이 바뀌면 화면의 글자와 읽어 주는 이름도 함께 바꿉니다.
  refreshLabels() {
    const name = this.name;
    this.element.title = name;
    this.element.setAttribute('aria-label', name);
    this.image.alt = name;
    this.listButton.setAttribute('aria-label', `${name} 대사 목록`);
    this.addButton.setAttribute('aria-label', `${name} 대사 추가`);
    const placeholder = this.element.querySelector('.avatar-placeholder-label');
    if (placeholder) placeholder.textContent = `${name} 이미지 넣기`;
  }

  bindEvents() {
    const activate = event => {
      event?.preventDefault?.();
      // 빈 칸이면 말하는 대신 기본 이미지를 넣는 창을 엽니다.
      if (this.isEmpty) {
        document.dispatchEvent(new CustomEvent('colliji:character-setup', { detail: { characterId: this.id } }));
        return;
      }
      playPop();
      showRandomQuote(this, event);
    };

    this.element.addEventListener('click', activate);
    this.element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });

    this.addButton.addEventListener('click', event => {
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('colliji:quote-add', { detail: { characterId: this.id } }));
    });

    this.listButton.addEventListener('click', event => {
      event.stopPropagation();
      document.dispatchEvent(new CustomEvent('colliji:quote-list', { detail: { characterId: this.id } }));
    });
  }

  // 현재 세계관에 해당하는 것만. 전부 해제 상태면 전체가 섞여 나옵니다.
  getQuotes() {
    return getVisibleQuotes(this.id);
  }

  getAllQuotes() {
    return getQuotes(this.id);
  }

  getExpressions() {
    return getVisibleExpressions(this.id);
  }

  // 세계관이나 설정을 바꾸면 말풍선을 닫고 기본 이미지를 다시 맞춥니다.
  resetToDefault() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.bubble.style.display = 'none';
    this.setImage(this.defaultImage);
  }

  async addQuote(text, options = {}) {
    const row = await createQuote({
      characterId: this.id,
      text,
      itemId: options.itemId ?? '',
      expressionId: options.expressionId ?? null,
      worldviewId: options.worldviewId ?? null
    });
    upsertLocalQuote(row);
    return row;
  }

  async updateQuote(id, patch) {
    const row = await updateQuote(id, patch);
    upsertLocalQuote(row);
    return row;
  }

  async deleteQuote(id) {
    await deleteQuote(id);
    removeLocalQuote(id, this.id);
  }

  speakRandomQuote(event) {
    hideGuide();
    const baseQuotes = this.getQuotes().filter(q => !String(q.item_id ?? '').trim());
    if (baseQuotes.length === 0) return;
    showHeart(this, event);
    const quote = baseQuotes[Math.floor(Math.random() * baseQuotes.length)];
    this.displayQuote(quote);
  }

  speakItemQuote(itemId, itemName = itemId) {
    hideGuide();
    const itemQuotes = this.getQuotes().filter(q => String(q.item_id ?? '') === itemId);
    if (itemQuotes.length === 0) {
      alert(`${this.name}에게 등록된 '${itemName}' 상호작용 대사가 없습니다.`);
      return;
    }
    this.displayQuote(itemQuotes[Math.floor(Math.random() * itemQuotes.length)]);
  }

  displayQuote(quote) {
    this.bubble.style.zIndex = String(++bubbleStackOrder);
    this.bubble.textContent = String(quote.text ?? '');
    this.bubble.style.display = 'block';
    // 표정 URL은 expressions 테이블 한 곳에만 있습니다. 여기서 찾아 씁니다.
    // 표정이 없으면 그 대사가 속한 세계관의 기본 이미지로 말합니다.
    const expression = getExpressionById(quote.expression_id);
    this.setImage(String(expression?.url ?? '').trim() || this.baseImageFor(quote));

    this.bubble.style.animation = 'none';
    void this.bubble.offsetHeight;
    this.bubble.style.animation = 'bubblePop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;

    // AUTO 로 붙잡아 둔 동안에는 사라지지 않습니다.
    if (!bubblesHeld) this.scheduleHide();
  }

  scheduleHide() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.bubble.style.display = 'none';
      this.setImage(this.defaultImage);
    }, BUBBLE_DURATION);
  }
}

export function initializeCharacters() {
  for (const config of Object.values(CHARACTER_DATA)) {
    characters.set(config.id, new ShimejiCharacter(config));
  }

  document.addEventListener('colliji:worldview-change', refreshCharacterImages);
  document.addEventListener('colliji:settings-change', () => {
    for (const character of characters.values()) character.refreshLabels();
    refreshCharacterImages();
  });
}

function refreshCharacterImages() {
  for (const character of characters.values()) character.resetToDefault();
}

export function getCharacter(id) {
  return characters.get(id) ?? null;
}

function showRandomQuote(character, event) {
  character.speakRandomQuote(event);
}

function showHeart(character, event) {
  if (!event?.clientX || !event?.clientY) return;
  const heart = document.createElement('div');
  heart.className = 'heart';
  heart.textContent = '♥';
  heart.style.color = character.color;

  const rect = character.card.getBoundingClientRect();
  heart.style.left = `${event.clientX - rect.left}px`;
  heart.style.top = `${event.clientY - rect.top - 10}px`;
  character.card.appendChild(heart);
  setTimeout(() => heart.remove(), 800);
}

function hideGuide() {
  const guide = document.getElementById('initial-guide-bubble');
  if (!guide) return;
  guide.classList.add('fade-out');
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => guide.classList.remove('fade-out'), 10000);
}

export function setupGlobalGuideTimer() {
  const trigger = () => hideGuide();
  window.addEventListener('mousemove', trigger);
  window.addEventListener('click', trigger);
}
