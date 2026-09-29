import { getCursorImage } from '../settings.js';

/*
 * 마우스를 따라오는 캐릭터.
 *
 * A가 커서를 따라가고, B가 A를 따라갑니다. 기차처럼 줄줄이 붙습니다.
 * 그림은 [설정 → 기타 → 마우스를 따라다니는 캐릭터]에서 넣습니다.
 * 넣지 않은 캐릭터는 보이지 않고, 둘 다 비어 있으면 아무것도 따라다니지 않습니다.
 *
 * 각자 '앞사람에게서 일정 거리 떨어진 자리'를 목표로 잡고,
 * 한 프레임에 그 거리의 EASE 만큼만 다가갑니다.
 * 한 번에 다 가지 않기 때문에 쫓아오는 느낌이 납니다.
 *
 * 떨어지는 거리는 그림의 실제 가로폭에서 계산합니다.
 * 좌표는 그림의 한가운데라서, 고정된 숫자로 두면
 * 가로로 넓은 그림일수록 서로 겹쳐 버립니다.
 */

/*
 * 그림과 그림 사이에 남길 틈(px). 키우면 더 벌어집니다.
 * 그림이 서로 닿을락 말락 하게 하려면 0 으로 두세요.
 */
const GAP = 12;

// 커서와 첫 번째 그림 사이에 남길 틈(px).
const CURSOR_GAP = 10;

// 그림이 아직 안 떴을 때 임시로 쓸 가로폭(px).
const FALLBACK_WIDTH = 46;

// 따라붙는 속도(0~1). 키우면 빠릿하게, 줄이면 느긋하게 따라옵니다.
// 뒷사람을 조금 더 빠르게 둬야 줄이 늘어지지 않습니다.
const EASE = [0.12, 0.13];

// 화면의 .cursor-trail 전부, 그중 지금 그림이 있어 줄에 선 것들.
const allFollowers = [];
const followers = [];

let mouseX = 0;
let mouseY = 0;
let frame = 0;
let visible = false;
let placed = false;

function place(follower) {
  // translate(-50%, -50%) 로 그림의 한가운데가 좌표에 오게 합니다.
  follower.element.style.transform =
    `translate3d(${follower.x}px, ${follower.y}px, 0) translate(-50%, -50%)`;
}

// 앞사람(targetX, targetY)에게서 keep 만큼 떨어진, 지금 자리에서 가장 가까운 지점.
function goalFrom(targetX, targetY, currentX, currentY, keep) {
  const dx = currentX - targetX;
  const dy = currentY - targetY;
  const distance = Math.hypot(dx, dy);

  // 완전히 겹쳐 있으면 방향을 정할 수 없으니 왼쪽으로 빼 둡니다.
  if (distance === 0) return { x: targetX - keep, y: targetY };

  return {
    x: targetX + (dx / distance) * keep,
    y: targetY + (dy / distance) * keep
  };
}

// 그림 반쪽 폭. 그림이 뜰 때 한 번 재 두고 그대로 씁니다.
function halfWidth(follower) {
  return (follower.width || FALLBACK_WIDTH) / 2;
}

/*
 * 앞사람과 둘 거리.
 *
 * 좌표는 그림의 한가운데이므로, 두 그림이 닿지 않으려면
 * 서로의 반쪽 폭을 더해야 합니다. 거기에 GAP 만큼 더 벌립니다.
 * 맨 앞은 앞사람이 마우스 커서(폭 0)라서 자기 반쪽만 셉니다.
 */
function keepDistance(follower, leader) {
  return leader
    ? halfWidth(leader) + halfWidth(follower) + GAP
    : halfWidth(follower) + CURSOR_GAP;
}

function step() {
  let leadX = mouseX;
  let leadY = mouseY;

  followers.forEach((follower, index) => {
    const keep = keepDistance(follower, followers[index - 1]);
    const goal = goalFrom(leadX, leadY, follower.x, follower.y, keep);
    const ease = EASE[index] ?? EASE[EASE.length - 1];

    follower.x += (goal.x - follower.x) * ease;
    follower.y += (goal.y - follower.y) * ease;
    place(follower);

    // 다음 사람은 이 사람을 따라갑니다.
    leadX = follower.x;
    leadY = follower.y;
  });

  frame = requestAnimationFrame(step);
}

function start() {
  if (frame) return;
  frame = requestAnimationFrame(step);
}

function stop() {
  if (!frame) return;
  cancelAnimationFrame(frame);
  frame = 0;
}

function show() {
  if (visible || !followers.length) return;
  visible = true;
  for (const follower of followers) follower.element.classList.remove('is-hidden');
}

function hide() {
  if (!visible) return;
  visible = false;
  for (const follower of allFollowers) follower.element.classList.add('is-hidden');

  stop();

  // 다시 들어올 때 화면 구석에서 날아오지 않도록, 자리를 다시 잡게 합니다.
  placed = false;
}

function handleMove(event) {
  mouseX = event.clientX;
  mouseY = event.clientY;

  if (!placed) {
    placed = true;
    // 처음엔 커서 왼쪽에 한 줄로 세워 둡니다. 거리를 차곡차곡 더해 갑니다.
    let offset = 0;
    followers.forEach((follower, index) => {
      offset += keepDistance(follower, followers[index - 1]);
      follower.x = mouseX - offset;
      follower.y = mouseY;
      place(follower);
    });
  }

  if (!followers.length) return;
  show();
  start();
}

/*
 * 그림을 넣은 캐릭터만 줄에 세웁니다.
 * [설정 → 기타]에서 그림을 바꾸면 다시 부릅니다.
 */
function syncImages() {
  followers.length = 0;

  for (const follower of allFollowers) {
    const src = getCursorImage(follower.id);
    const { element } = follower;

    if (!src) {
      element.removeAttribute('src');
      element.classList.add('is-hidden');
      continue;
    }

    if (element.getAttribute('src') !== src) {
      follower.width = 0;
      element.src = src;
    }
    if (visible) element.classList.remove('is-hidden');
    followers.push(follower);
  }

  // 줄이 바뀌었으니 다음에 마우스가 움직일 때 자리를 다시 잡습니다.
  placed = false;

  // 따라올 그림이 하나도 없으면 돌 필요가 없습니다.
  if (!followers.length) {
    stop();
    visible = false;
  }
}

export function initializeCursorTrail() {
  /*
   * 마우스가 없는 기기와 '동작 줄이기'를 켠 경우에는 아예 켜지 않습니다.
   * CSS에서도 숨기지만, 여기서 막아야 애니메이션 자체가 돌지 않습니다.
   */
  const hasMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const wantsMotion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!hasMouse || !wantsMotion) return;

  for (const element of document.querySelectorAll('.cursor-trail')) {
    const follower = { id: element.dataset.cursorFor, element, x: 0, y: 0, width: 0 };

    // 그림이 뜨면 실제 가로폭을 한 번 재 둡니다. 이 값으로 간격을 잡습니다.
    element.addEventListener('load', () => {
      follower.width = element.offsetWidth;
    });

    // 주소가 살아 있는지 조용히 넘어가지 않고 콘솔에 남깁니다.
    element.addEventListener('error', () => {
      if (!element.getAttribute('src')) return;
      console.warn(`[cursor] 그림을 불러오지 못했습니다: ${element.src}`);
      element.classList.add('is-hidden');
    });

    allFollowers.push(follower);
  }

  syncImages();
  document.addEventListener('dialogue:settings-change', syncImages);

  window.addEventListener('mousemove', handleMove, { passive: true });
  document.addEventListener('mouseleave', hide);

  // 다른 탭에 가 있는 동안은 돌리지 않습니다.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (visible) start();
  });
}
