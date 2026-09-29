import { keyProblem, normalizeProjectUrl, saveConnection, testConnection } from '../connection.js';
import { $, hideModal, showModal } from '../ui.js';

/*
 * DB 연결 입력창.
 *
 * 처음 켤 때(연결 정보가 없을 때)는 닫을 수 없는 창으로 뜨고,
 * [설정 → 기타 → 연결 변경]에서 열 때는 닫을 수 있습니다.
 *
 * 입력값으로 실제로 접속해 보고, 필요한 표가 다 있을 때만 저장한 뒤 돌려줍니다.
 */

const MODAL_ID = 'setup-modal';

let bound = false;
let pending = null;   // { resolve, closable }

function showError(message) {
  const box = $('setup-error');
  box.textContent = message || '';
  box.hidden = !message;
}

function setBusy(busy) {
  const button = $('setup-submit-btn');
  button.disabled = busy;
  button.textContent = busy ? '확인하는 중...' : '연결';
  $('setup-url-input').disabled = busy;
  $('setup-key-input').disabled = busy;
}

async function submit(event) {
  event?.preventDefault();
  if (!pending || $('setup-submit-btn').disabled) return;

  const urlInput = $('setup-url-input');
  const keyInput = $('setup-key-input');

  const url = normalizeProjectUrl(urlInput.value);
  const key = keyInput.value.trim();

  if (!url) {
    showError('Project URL을 확인해 주세요.\n예) https://abcdefghijklmnopqrst.supabase.co');
    urlInput.focus();
    return;
  }

  const problem = keyProblem(key);
  if (problem) {
    showError(problem);
    keyInput.focus();
    return;
  }

  urlInput.value = url;
  showError('');
  setBusy(true);

  try {
    await testConnection({ url, key });
  } catch (error) {
    setBusy(false);
    showError(error.message || String(error));
    return;
  }

  setBusy(false);
  const saved = saveConnection({ url, key });
  if (!saved) console.warn('[setup] 이 브라우저에는 연결 정보를 저장할 수 없어, 다음에 다시 묻습니다.');

  const { resolve } = pending;
  pending = null;
  hideModal(MODAL_ID);
  resolve({ url, key, source: 'browser' });
}

function close() {
  if (!pending?.closable) return;
  const { resolve } = pending;
  pending = null;
  hideModal(MODAL_ID);
  resolve(null);
}

function bindOnce() {
  if (bound) return;
  bound = true;

  $('setup-form').addEventListener('submit', submit);
  $('setup-close-btn').addEventListener('click', close);
  $(MODAL_ID).addEventListener('click', event => {
    if (event.target.id === MODAL_ID) close();
  });
}

/**
 * 입력창을 띄우고, 연결에 성공하면 { url, key } 를 돌려줍니다.
 * 닫을 수 있는 창에서 그냥 닫으면 null 을 돌려줍니다.
 */
export function openSetupModal({ initial = null, error = '', closable = false } = {}) {
  bindOnce();

  // 이미 떠 있으면 앞의 요청은 취소로 칩니다.
  if (pending) pending.resolve(null);

  $('setup-url-input').value = initial?.url ?? '';
  $('setup-key-input').value = initial?.key ?? '';
  $('setup-close-btn').hidden = !closable;
  setBusy(false);
  showError(error);

  return new Promise(resolve => {
    pending = { resolve, closable };
    showModal(MODAL_ID);
    (initial?.url ? $('setup-key-input') : $('setup-url-input')).focus();
  });
}
