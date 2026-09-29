/*
 * 효과음.
 *
 * 캐릭터를 누를 때와, 아이템을 끌어다 놓을 때 '뽁' 소리가 납니다.
 * 아래 다섯 가지 중 하나가 무작위로 나옵니다.
 *
 * 소리를 바꾸려면 sfx/ 안의 파일을 갈아 끼우면 됩니다.
 * 다섯 파일은 평균 음량을 -25dB 로 맞춰 두었습니다. 새 파일을 넣을 때
 * 그것만 유난히 크거나 작으면 무작위로 나올 때 튑니다.
 */

const POPS = [
  './sfx/pop-1.mp3',
  './sfx/pop-2.mp3',
  './sfx/pop-3.mp3',
  './sfx/pop-4.mp3',
  './sfx/pop-5.mp3'
];

// 0 ~ 1. 노래보다 조금 아래에 깔리도록 잡았습니다.
const VOLUME = 0.7;

const sounds = [];
let lastIndex = -1;
let enabled = true;

// 왼쪽 위 '효과음' 단추가 부릅니다.
export function setSfxEnabled(on) {
  enabled = Boolean(on);
}

export function initializeSfx() {
  for (const src of POPS) {
    try {
      const audio = new Audio(src);
      audio.preload = 'auto';      // 첫 클릭 때 소리가 늦지 않도록 미리 받아 둡니다
      audio.volume = VOLUME;
      audio.addEventListener('error', () => {
        console.warn(`[sfx] 효과음을 불러오지 못했습니다: ${src}`);
        const at = sounds.indexOf(audio);
        if (at !== -1) sounds.splice(at, 1);
      });
      sounds.push(audio);
    } catch (error) {
      console.warn(`[sfx] 효과음을 준비하지 못했습니다: ${src}`, error.message);
    }
  }
}

/*
 * 아무거나 하나 골라 냅니다.
 *
 * 바로 앞에 났던 것은 피합니다. 순수한 무작위로 두면 다섯 개뿐이라
 * 같은 소리가 연달아 나는 일이 꽤 자주 생겨서 '무작위'로 느껴지지 않습니다.
 *
 * 같은 소리를 연달아 누르면 겹쳐 쌓지 않고 처음부터 다시 냅니다.
 * 서로 다른 소리끼리는 자연스럽게 겹칩니다.
 */
export function playPop() {
  if (!enabled || !sounds.length) return;

  let index = Math.floor(Math.random() * sounds.length);
  if (sounds.length > 1 && index === lastIndex) {
    index = (index + 1 + Math.floor(Math.random() * (sounds.length - 1))) % sounds.length;
  }
  lastIndex = index;

  const audio = sounds[index];
  try {
    audio.currentTime = 0;
    // 소리가 막히는 건 흔한 일이라, 실패해도 조용히 넘어갑니다.
    audio.play().catch(() => {});
  } catch (error) {
    /* 아직 다 못 받았을 때 currentTime 을 건드리면 날 수 있습니다. 무시합니다. */
  }
}
