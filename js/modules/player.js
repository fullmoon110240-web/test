import { getMusic } from '../settings.js';

/*
 * 오른쪽 위 음악 재생바.
 *
 * 노래 주소와 표기는 [설정 → 기타 → 배경 음악]에서 넣습니다.
 * 넣지 않으면 재생바가 보이지 않습니다.
 *
 * 노래는 ▶ 를 눌러야만 나옵니다. 저절로 트는 기능은 두지 않습니다.
 * (브라우저가 막는 경우가 많아 되레 '왜 안 나오지' 하게 만들었습니다)
 */

// 지금 걸려 있는 노래. [설정]에서 바꾸면 applySong() 이 갈아 끼웁니다.
const SONG = { src: '', artist: '' };

// 소리가 멎었을 때 이만큼 기다렸다가 다시 붙입니다.
const STALL_WAIT = 6000;

// 다시 붙여 보는 횟수. 이만큼도 안 되면 바를 감춥니다.
const MAX_RETRIES = 3;

const audio = new Audio();

let root = null;
let fill = null;
let progress = null;
let volumeSlider = null;

// 음소거를 풀 때 돌아갈 음량.
let lastVolume = 1;

// '지금 나와야 하는 상태인가'. 사람이 멈춘 것과 끊겨서 멎은 것을 가릅니다.
let wantPlaying = false;

let retries = 0;
let stallTimer = null;

// 한 번이라도 소리가 나간 적이 있는가. 주소가 아예 틀린 경우와 가릅니다.
let everPlayed = false;

function setPlaying(isPlaying) {
  root.classList.toggle('is-playing', isPlaying);
  root.querySelector('.music-play').setAttribute('aria-label', isPlaying ? '멈춤' : '재생');
}

function setMuted(isMuted) {
  root.classList.toggle('is-muted', isMuted);
}

function updateProgress() {
  if (!audio.duration) return;
  const percent = (audio.currentTime / audio.duration) * 100;
  fill.style.width = `${percent}%`;
  progress.setAttribute('aria-valuenow', String(Math.round(percent)));
}

function togglePlay() {
  if (audio.paused) {
    wantPlaying = true;
    // 사람이 직접 눌렀으면 다시 붙여 보는 횟수를 되돌립니다.
    // 잠깐 끊겼다가 돌아온 경우에도 이 단추 하나로 다시 들을 수 있습니다.
    retries = 0;
    if (audio.error) reattach(audio.currentTime || 0);
    else audio.play().catch(error => console.warn('[player] 재생하지 못했습니다:', error.message));
  } else {
    wantPlaying = false;
    audio.pause();
  }
}

function seek(event) {
  if (!audio.duration) return;
  const box = progress.getBoundingClientRect();
  const ratio = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1);
  audio.currentTime = ratio * audio.duration;
  updateProgress();
}

function applyVolume(value) {
  audio.volume = value;
  audio.muted = value === 0;
  setMuted(audio.muted);
}

function toggleMute() {
  if (audio.muted || audio.volume === 0) {
    const next = lastVolume > 0 ? lastVolume : 0.5;
    volumeSlider.value = String(next);
    applyVolume(next);
  } else {
    lastVolume = audio.volume;
    volumeSlider.value = '0';
    applyVolume(0);
  }
}

/* --------------------------------------------------------- 끊겼을 때 */

/*
 * 바깥 저장소에서 받아 오는 파일이라 중간에 끊길 수 있습니다.
 * 그냥 두면 소리만 멎고 아무 일도 일어나지 않으므로,
 * 듣던 자리를 기억해 두었다가 다시 붙입니다.
 */
let resumeAt = 0;

function resumeAfterReattach() {
  try { if (resumeAt) audio.currentTime = resumeAt; } catch { /* 길이를 아직 모르면 처음부터 */ }
  if (wantPlaying) audio.play().catch(() => {});
}

function reattach(at) {
  resumeAt = at;

  // 앞서 붙여 둔 게 남아 있을 수 있으니 한 번 떼고 답니다.
  audio.removeEventListener('loadedmetadata', resumeAfterReattach);
  audio.addEventListener('loadedmetadata', resumeAfterReattach, { once: true });

  if (!SONG.src) return;
  audio.src = SONG.src;
  audio.load();
}

function clearStallWatch() {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
}

function watchStall() {
  if (stallTimer || !wantPlaying) return;

  const at = audio.currentTime;
  stallTimer = setTimeout(() => {
    stallTimer = null;
    // 그 사이에 조금이라도 나갔으면 그냥 받는 중이었던 겁니다.
    if (!wantPlaying || audio.currentTime > at + 0.2) return;
    console.info('[player] 소리가 멎어서 다시 붙입니다.');
    reattach(at);
  }, STALL_WAIT);
}

function handleError() {
  clearStallWatch();
  if (!SONG.src) return;

  if (retries < MAX_RETRIES) {
    retries += 1;
    const at = audio.currentTime || 0;
    console.warn(`[player] 음악이 끊겼습니다. 다시 붙여 봅니다 (${retries}/${MAX_RETRIES})`);
    // 1초, 2초, 4초. 잠깐 끊긴 것이라면 이 사이에 돌아옵니다.
    setTimeout(() => reattach(at), 1000 * Math.pow(2, retries - 1));
    return;
  }

  /*
   * 여기까지 왔다는 건 여러 번 시도해도 안 됐다는 뜻입니다.
   *
   * 한 번이라도 소리가 나갔었다면 주소는 멀쩡하고 잠깐 막힌 것이므로,
   * 바를 그대로 두고 멈춰만 둡니다. ▶ 를 누르면 다시 시도합니다.
   * 한 번도 나간 적이 없다면 주소 자체가 잘못된 것이라 바를 감춥니다.
   */
  console.warn(`[player] 음악을 불러오지 못했습니다: ${SONG.src}`);
  if (!everPlayed) root.hidden = true;
}

/*
 * 작은 창으로 띄울 때 원래 창의 노래를 멈춥니다.
 * 두 창에서 같은 노래가 겹쳐 나오지 않게 하려는 것입니다.
 */
export function pauseMusic() {
  wantPlaying = false;
  clearStallWatch();
  try { audio.pause(); } catch { /* 아직 준비 전이면 그냥 넘어갑니다 */ }
}

/*
 * 노래를 걸거나 바꿉니다. 주소가 없으면 재생바를 감춥니다.
 */
function applySong({ src, artist }) {
  root.querySelector('.music-artist').textContent = artist;
  if (src === SONG.src) {
    SONG.artist = artist;
    return;
  }

  pauseMusic();
  SONG.src = src;
  SONG.artist = artist;
  retries = 0;
  everPlayed = false;
  fill.style.width = '0%';

  if (!src) {
    root.hidden = true;
    audio.removeAttribute('src');
    audio.load();
    return;
  }

  root.hidden = false;
  audio.src = src;
}

export function initializeMusicPlayer() {
  root = document.getElementById('music-player');
  if (!root) return;

  fill = document.getElementById('music-fill');
  progress = document.getElementById('music-progress');
  volumeSlider = document.getElementById('music-volume-slider');

  root.hidden = true;
  applySong(getMusic());
  document.addEventListener('colliji:settings-change', () => applySong(getMusic()));

  audio.preload = 'metadata';
  audio.loop = true;           // 끝나면 처음부터 다시
  audio.volume = Number(volumeSlider.value);

  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));

  // 한 자락이라도 나가면 '끊김 감시'를 풀고, 다시 붙여 본 횟수도 되돌립니다.
  audio.addEventListener('playing', () => { clearStallWatch(); retries = 0; everPlayed = true; });
  audio.addEventListener('stalled', watchStall);
  audio.addEventListener('waiting', watchStall);
  audio.addEventListener('error', handleError);

  root.querySelector('.music-play').addEventListener('click', togglePlay);
  root.querySelector('.music-mute').addEventListener('click', toggleMute);
  progress.addEventListener('click', seek);
  volumeSlider.addEventListener('input', () => applyVolume(Number(volumeSlider.value)));
}
