import { state } from './state.js';

export function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`필수 요소를 찾을 수 없습니다: #${id}`);
  return element;
}

export function showModal(id) {
  const modal = $(id);
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
}

export function hideModal(id) {
  const modal = $(id);
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

/*
 * ['닫기 단추 id', '닫을 모달 id'] 짝을 받아 한 번에 연결합니다.
 * 대사 쪽과 세계관 쪽이 똑같은 세 줄을 각자 들고 있던 것을 모았습니다.
 */
export function bindModalClosers(pairs) {
  for (const [buttonId, modalId] of pairs) {
    $(buttonId).addEventListener('click', () => hideModal(modalId));
  }
}

export function isModalOpen(id) {
  return document.getElementById(id)?.classList.contains('is-open');
}

/*
 * 저장·삭제처럼 서버를 다녀오는 일을 감쌉니다.
 *
 *   - 다녀오는 동안 또 누르는 것을 막습니다 (state.busy)
 *   - 실패하면 무엇이 실패했는지 그대로 알려 줍니다
 *
 * 대사 쪽(modules/modals.js)과 세계관 쪽(modules/worldview.js)에
 * 같은 함수가 한 벌씩 들어 있던 것을 여기로 모았습니다.
 */
export async function runBusy(task, fallbackMessage) {
  if (state.busy) return;
  state.busy = true;
  try {
    await task();
  } catch (error) {
    console.error(error);
    flashError(`${fallbackMessage}\n\n${error.message || error}`);
  } finally {
    state.busy = false;
  }
}

export function setLoadingMessage(message) {
  const element = document.getElementById('loading-message');
  if (element) element.textContent = message;
}

export function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('is-hidden');
}

export function showLoading(message) {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('is-hidden');
  if (message) setLoadingMessage(message);
}

// runBusy 안에서만 씁니다.
function flashError(message) {
  console.error(message);
  alert(message);
}

export function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(String(value ?? '').trim());
}

/*
 * 마침표로 치는 글자들. 온점, 말줄임표, 전각 온점, 한중일 구두점.
 * '...미안.' 과 '미안.' 을 같은 문장으로 보기 위해 전부 지웁니다.
 */
const PERIOD_LIKE = /[.．。…⋯]/gu;
const WHITESPACE = /[\s\u200b]/gu;

/**
 * 대사 중복 판단용 정규화.
 * 띄어쓰기와 마침표만 지우고, 나머지 문장부호는 그대로 둡니다.
 *   '...미안.'  ->  '미안'
 *   '미안.'     ->  '미안'   (위와 같은 대사)
 *   '미안!'     ->  '미안!'  (다른 대사)
 *   '미안?'     ->  '미안?'  (또 다른 대사)
 */
export function quoteDuplicateKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(PERIOD_LIKE, '')
    .replace(WHITESPACE, '');
}

/**
 * 가나다순 정렬용 키.
 * 이쪽은 문장부호를 전부 털어내고 글자와 숫자만 남깁니다.
 * 그래야 '...미안.' 이 마침표가 아니라 'ㅁ' 자리에 놓입니다.
 */
export function quoteSortKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

const DRIVE_FILE_ID = /(?:\/d\/|[?&]id=)([A-Za-z0-9_-]{20,})/;

/**
 * 구글 드라이브 링크를 누구나 볼 수 있는 형태로 바꿉니다.
 *
 *   https://lh3.google.com/u/0/d/<ID>=w545-h909-iv1   ← 내 계정으로 로그인해야만 보임
 *   https://drive.google.com/file/d/<ID>/view         ← 페이지 주소라 이미지가 아님
 *        -> https://lh3.googleusercontent.com/d/<ID>
 *
 * 드라이브 미리보기에서 복사되는 rd-d/... 주소는 파일 ID가 들어있지 않아
 * 변환할 수 없습니다. 그대로 두고 경고는 호출한 쪽에서 합니다.
 */
export function normalizeImageUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return '';

  if (/^https:\/\/(lh3\.google\.com\/u\/|drive\.google\.com\/)/i.test(url)) {
    const match = url.match(DRIVE_FILE_ID);
    if (match) return `https://lh3.googleusercontent.com/d/${match[1]}`;
  }

  return url;
}

// 만료되는 임시 주소인지 (드라이브 미리보기에서 복사한 링크)
export function isTemporaryDriveUrl(value) {
  return /\/rd-d\/|auditContext=/i.test(String(value ?? ''));
}
