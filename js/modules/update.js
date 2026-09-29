/*
 * 앱으로 설치하기 + 새 버전 알림.
 *
 * 깃허브에 코드를 올리고 sw.js 의 VERSION 을 바꾸면,
 * 이미 설치된 앱에서 이 줄이 뜹니다.
 *
 *     새 버전이 있어요   [ 새로고침 ]
 *
 * 누르기 전에는 화면이 바뀌지 않습니다. 쓰던 게 끊기지 않게 하려는 것입니다.
 */

// 앱을 켜 둔 채로 며칠 두는 경우를 대비해, 가끔 새 버전이 있는지 물어봅니다.
const CHECK_EVERY = 30 * 60 * 1000;

let bar = null;

function buildBar(onApply) {
  const box = document.createElement('div');
  box.className = 'update-bar';
  box.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.className = 'update-bar-text';
  text.textContent = '새 버전이 있어요';

  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'update-bar-btn';
  apply.textContent = '새로고침';
  apply.addEventListener('click', onApply);

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'update-bar-close';
  later.setAttribute('aria-label', '나중에');
  later.textContent = '✕';
  later.addEventListener('click', () => box.remove());

  box.append(text, apply, later);
  document.body.appendChild(box);
  return box;
}

function showBar(worker) {
  if (bar) return;
  bar = buildBar(() => {
    bar.querySelector('.update-bar-btn').disabled = true;
    // 새 워커에게 '이제 네가 맡아라'라고 알립니다.
    // 넘겨받으면 controllerchange 가 오고, 그때 화면을 다시 엽니다.
    worker.postMessage('skip-waiting');
  });
}

export function initializeUpdates() {
  if (!('serviceWorker' in navigator)) return;

  // 파일로 직접 열었을 때(file://)는 서비스 워커를 쓸 수 없습니다.
  if (!location.protocol.startsWith('http')) return;

  /*
   * 맨 처음 설치될 때도 '맡은 일꾼이 바뀜' 신호가 한 번 옵니다.
   * 그때 새로고침하면 처음 들어온 사람의 화면이 까닭 없이 한 번 깜빡입니다.
   * 그래서 '원래 맡고 있던 일꾼이 있었는지'를 먼저 기억해 둡니다.
   */
  const hadController = Boolean(navigator.serviceWorker.controller);

  window.addEventListener('load', async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register('./sw.js', {
        // sw.js 만큼은 저장본 말고 늘 새로 받아 와야 새 버전을 알아챕니다.
        updateViaCache: 'none'
      });
    } catch (error) {
      console.warn('[update] 서비스 워커를 등록하지 못했습니다:', error.message);
      return;
    }

    // 이미 기다리고 있는 새 버전이 있으면 바로 알립니다.
    if (registration.waiting && navigator.serviceWorker.controller) {
      showBar(registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
      const incoming = registration.installing;
      if (!incoming) return;

      incoming.addEventListener('statechange', () => {
        // controller 가 있다는 건 '처음 설치'가 아니라 '갈아타기'라는 뜻입니다.
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          showBar(incoming);
        }
      });
    });

    // 새 워커가 맡는 순간 화면을 다시 엽니다. 한 번만 돕니다.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // 첫 설치라면 지금 떠 있는 게 이미 최신입니다. 새로고침하지 않습니다.
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });

    const check = () => registration.update().catch(() => {});
    setInterval(check, CHECK_EVERY);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  });
}
