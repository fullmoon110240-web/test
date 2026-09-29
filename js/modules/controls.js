import { CHARACTER_DATA } from '../data/characters.js';
import { getCharacter, setBubblesHeld } from './characters.js';
import { setSfxEnabled } from './sfx.js';

/*
 * 왼쪽 위 켜고 끄는 단추 두 개.
 *
 *   효과음 — 뽁 소리를 낼지 말지. 처음에는 켜져 있습니다.
 *   AUTO  — 누르지 않아도 캐릭터가 알아서 말합니다. 처음에는 꺼져 있습니다.
 *
 * 새로고침하면 다시 이 기본값으로 돌아옵니다.
 * 켠 상태를 기억하게 하려면 localStorage 에 담으면 되지만,
 * 창을 열자마자 혼자 떠들기 시작하면 놀랄 수 있어서 그러지 않았습니다.
 */

/*
 * 대사를 갈아끼우는 간격. 캐릭터마다 따로 돌아서 둘이 엇갈립니다.
 * 말풍선은 사라지지 않고 이 때마다 내용만 바뀝니다.
 */
const MIN_GAP = 5000;
const MAX_GAP = 12000;

const IDS = Object.keys(CHARACTER_DATA);

// 캐릭터마다 따로 돕니다. 둘의 바뀌는 때가 서로 달라야 자연스럽습니다.
const autoTimers = new Map();

function setSwitch(button, on) {
  button.classList.toggle('is-on', on);
  button.setAttribute('aria-checked', String(on));
}

/* --------------------------------------------------------------- AUTO */

/*
 * event 를 넘기지 않습니다. 그래야
 *   - 하트가 안 뜨고 (showHeart 가 좌표 없으면 그냥 넘어갑니다)
 *   - 소리도 안 납니다 (소리는 클릭 처리 쪽에만 붙어 있습니다)
 * 클릭으로 나온 게 아니니까요.
 */
function speak(id) {
  getCharacter(id)?.speakRandomQuote();
}

function scheduleFor(id) {
  const gap = MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP);
  autoTimers.set(id, setTimeout(() => {
    // 다른 탭에 가 있는 동안에는 바꾸지 않고 넘어갑니다.
    if (!document.hidden) speak(id);
    scheduleFor(id);
  }, gap));
}

/*
 * 켜면 두 사람이 바로 말하고, 그 뒤로는 각자 따로 대사만 갈아끼웁니다.
 * 말풍선은 내내 떠 있습니다. (characters.js 의 setBubblesHeld)
 */
function startAuto() {
  stopAuto(true);
  setBubblesHeld(true);

  for (const id of IDS) {
    speak(id);
    scheduleFor(id);
  }
}

function stopAuto(keepHold = false) {
  for (const timer of autoTimers.values()) clearTimeout(timer);
  autoTimers.clear();

  // 끄면 지금 떠 있는 말풍선부터 평소대로 사라집니다.
  if (!keepHold) setBubblesHeld(false);
}

/* --------------------------------------------------------------- 시작 */

export function initializeControls() {
  const sfx = document.getElementById('sfx-toggle');
  const auto = document.getElementById('auto-toggle');
  if (!sfx || !auto) return;

  // 처음 값: 효과음 켬, AUTO 끔.
  setSwitch(sfx, true);
  setSfxEnabled(true);
  setSwitch(auto, false);

  sfx.addEventListener('click', () => {
    const on = !sfx.classList.contains('is-on');
    setSwitch(sfx, on);
    setSfxEnabled(on);
  });

  auto.addEventListener('click', () => {
    const on = !auto.classList.contains('is-on');
    setSwitch(auto, on);
    if (on) startAuto();
    else stopAuto();
  });
}
