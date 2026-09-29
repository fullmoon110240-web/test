/*
 * 항상 위에 떠 있는 작은 창 (컴퓨터 전용).
 *
 * 브라우저에는 창을 '항상 위'로 고정하는 방법이 하나뿐입니다.
 * Document Picture-in-Picture — 원래 영상 띄우기용으로 만들어졌지만,
 * 안에 아무 화면이나 넣을 수 있고 그 창은 다른 창들 위에 뜹니다.
 *
 * 크롬·엣지(컴퓨터)에서만 됩니다.
 * 파이어폭스·사파리·휴대폰에는 이 기능이 없어서, 그런 곳에서는
 * 단추 자체가 만들어지지 않습니다. 화면이 지저분해지지 않도록요.
 *
 * 띄운 창 안에는 이 앱을 ?pip=1 로 한 벌 더 띄웁니다.
 * 화면 조각만 옮겨 담으면 끌어놓기나 창 좌표 계산이 어긋나는데,
 * 통째로 띄우면 원래와 똑같이 동작합니다.
 */

import { pauseMusic } from './player.js';

const WINDOW_SIZE = { width: 380, height: 560 };

let popped = null;

/* ------------------------------------------------------------------ 단추 */

function makeButton(onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'ontop-btn';
  button.className = 'ontop-btn';
  button.title = '항상 위에 작은 창으로 띄우기';
  button.setAttribute('aria-label', '항상 위에 작은 창으로 띄우기');
  // 압정 모양입니다. 20px 에서도 또렷하게 보이도록 굵게 잡았습니다.
  const PIN = 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5'
    + 'c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z';

  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PIN}"/></svg>`;
  button.addEventListener('click', onClick);

  // 효과음·AUTO 단추와 한 줄에 서도록, 그 칸 맨 앞에 끼웁니다.
  const bar = document.getElementById('top-controls');
  if (bar) bar.prepend(button);
  else document.body.appendChild(button);

  return button;
}

function makeNotice(onReturn) {
  const box = document.createElement('div');
  box.className = 'ontop-notice';
  box.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = '작은 창으로 띄웠어요';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'ontop-notice-btn';
  back.textContent = '돌아오기';
  back.addEventListener('click', onReturn);

  box.append(text, back);
  document.body.appendChild(box);
  return box;
}

/* ------------------------------------------------------ 띄운 창 꾸미기 */

/*
 * 새로 연 창을 앱으로 채웁니다.
 * requestWindow() 가 준 창이든 시험용 창이든 똑같이 동작하도록,
 * 창 하나만 받아서 처리합니다.
 */
function fillWindow(win) {
  const doc = win.document;

  // 제목은 원래 창(index.html 의 <title>)을 그대로 따릅니다.
  doc.title = document.title;

  const style = doc.createElement('style');
  style.textContent =
    'html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#f7f7f8}' +
    'iframe{display:block;width:100%;height:100%;border:0}';
  doc.head.appendChild(style);

  const frame = doc.createElement('iframe');
  // ?pip=1 이 붙으면 노래·커서 캐릭터·업데이트 알림은 켜지 않습니다.
  // 원래 창에서 이미 돌고 있으니 두 번 돌 필요가 없습니다.
  frame.src = './?pip=1';
  frame.title = document.title;
  doc.body.appendChild(frame);

  return frame;
}

/* ------------------------------------------------------------------ 시작 */

export function initializeAlwaysOnTop() {
  // 이 기능이 없는 브라우저에서는 단추를 만들지 않습니다.
  if (!('documentPictureInPicture' in window)) return;

  const button = makeButton(popOut);

  function restore() {
    document.body.classList.remove('is-popped-out');
    if (popped?.notice) popped.notice.remove();
    popped = null;
    button.hidden = false;

    /*
     * 작은 창은 이 앱을 한 벌 더 띄운 것이라, 거기서 대사를 고쳐도
     * 이 창은 모르고 있습니다. 돌아올 때 한 번 다시 읽어 옵니다.
     *
     * 어차피 접혀 있던 창이라 눈에 거슬리지 않고,
     * 이게 없으면 작은 창에서 추가한 대사가 여기서는 안 보입니다.
     */
    location.reload();
  }

  async function popOut() {
    if (popped) return;

    let win;
    try {
      win = await window.documentPictureInPicture.requestWindow(WINDOW_SIZE);
    } catch (error) {
      console.warn('[ontop] 작은 창을 열지 못했습니다:', error.message);
      return;
    }

    fillWindow(win);

    // 노래는 작은 창이 맡습니다. 두 창에서 겹쳐 나오지 않게 여기서 멈춥니다.
    pauseMusic();

    // 같은 화면이 두 군데 떠 있으면 헷갈리니, 원래 창은 접어 둡니다.
    document.body.classList.add('is-popped-out');
    button.hidden = true;
    popped = { win, notice: makeNotice(() => win.close()) };

    win.addEventListener('pagehide', restore, { once: true });
  }
}
