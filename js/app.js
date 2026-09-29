import { connectSupabase, fetchAllData } from './supabase.js';
import { getConnection, getStoredConnection } from './connection.js';
import { setLoadedData } from './state.js';
import { applyTheme, loadSettings } from './settings.js';
import { initializeCharacters, setupGlobalGuideTimer } from './modules/characters.js';
import { initializeItems } from './modules/items.js';
import { initializeModals } from './modules/modals.js';
import { initializeCustomize } from './modules/customize.js';
import { openSetupModal } from './modules/setup.js';
import { initializeWorldview, restoreWorldviewSelection } from './modules/worldview.js';
import { initializeCursorTrail } from './modules/cursor.js';
import { initializeMusicPlayer } from './modules/player.js';
import { initializeUpdates } from './modules/update.js';
import { initializeAlwaysOnTop } from './modules/ontop.js';
import { initializeSfx } from './modules/sfx.js';
import { initializeControls } from './modules/controls.js';
import { hideLoading, setLoadingMessage, showLoading } from './ui.js';

// 주소에 ?pip=1 이 붙어 있으면 '항상 위에 띄운 작은 창' 안입니다.
const EMBEDDED = new URLSearchParams(location.search).has('pip');

// config.js 연결이 실패했을 때처럼, 로딩창에 안내를 남겨 둬야 할 때 채웁니다.
let blockingMessage = '';

const EMPTY_DATA = Object.freeze({
  quotes: [], expressions: [], settings: [], worldviews: [], worldviewImages: [], worldviewSupported: false
});

/*
 * DB에 연결해 데이터를 모두 받아 옵니다.
 *
 * 연결 정보가 없거나, 저장해 둔 연결로 불러오기에 실패하면
 * 입력창을 띄우고 성공할 때까지 기다립니다.
 * (js/config.js 에 적힌 연결이 실패하면 입력창 대신 안내만 남깁니다 - 입력해도 바뀌지 않으므로)
 */
async function connectAndLoad() {
  let connection = getConnection();
  let error = '';

  for (;;) {
    if (!connection) {
      hideLoading();
      connection = await openSetupModal({ initial: getStoredConnection(), error });
      showLoading('데이터를 불러오는 중...');
    }

    connectSupabase(connection);

    try {
      return await fetchAllData();
    } catch (failure) {
      console.error('Supabase 데이터 로드 실패:', failure);

      if (connection.source === 'config') {
        blockingMessage =
          '데이터를 불러오지 못했습니다. js/config.js 의 연결 정보와 supabase/schema.sql 실행 여부를 확인해 주세요.' +
          `\n(${failure.message || failure})`;
        return EMPTY_DATA;
      }

      error = `저장된 연결로 데이터를 불러오지 못했습니다.\n(${failure.message || failure})`;
      connection = null;
    }
  }
}

async function boot() {
  // 설정을 받기 전에도 회색 기본 컬러가 CSS 에 있으므로, 여기서는 변수만 맞춰 둡니다.
  applyTheme();

  try {
    const data = await connectAndLoad();
    setLoadedData(data);
    loadSettings(data.settings);
  } catch (error) {
    console.error('데이터 준비 실패:', error);
    setLoadingMessage('데이터를 불러오지 못했습니다. F12 콘솔의 빨간 오류를 확인해 주세요.');
    setLoadedData(EMPTY_DATA);
  }

  try {
    // 캐릭터를 만들기 전에 복원해야 첫 화면부터 세계관 기본 이미지가 맞습니다.
    restoreWorldviewSelection();

    // 효과음은 캐릭터를 만들기 전에 준비해 둡니다.
    initializeSfx();

    initializeModals();
    initializeCustomize();
    initializeCharacters();
    initializeItems();
    initializeWorldview();

    // 왼쪽 위 효과음 · AUTO 단추. 캐릭터를 만든 뒤라야 말을 시킬 수 있습니다.
    initializeControls();
    setupGlobalGuideTimer();

    /*
     * 아래 셋은 '항상 위에 띄운 작은 창' 안에서는 켜지 않습니다.
     * 그 창은 이 앱을 ?pip=1 로 한 벌 더 띄운 것이라,
     * 커서 캐릭터가 두 쌍이 되고 알림도 두 번 뜨기 때문입니다.
     */
    // 오른쪽 위 음악 재생바. 작은 창에서도 씁니다.
    // (원래 창의 노래는 작은 창을 띄울 때 멈춥니다 - modules/ontop.js)
    initializeMusicPlayer();

    if (!EMBEDDED) {
      // 마우스를 따라다니는 캐릭터. 그림은 [설정 → 기타]에서 넣고, 넣지 않으면 보이지 않습니다.
      initializeCursorTrail();

      // 앱으로 설치하기 + 새 버전 알림.
      initializeUpdates();

      // 왼쪽 위 '항상 위에 띄우기' 단추. 크롬·엣지(컴퓨터)에서만 나옵니다.
      initializeAlwaysOnTop();
    }
  } catch (error) {
    console.error('화면 초기화 실패:', error);
    setLoadingMessage('화면을 준비하는 중 문제가 발생했습니다.');
  } finally {
    if (blockingMessage) setLoadingMessage(blockingMessage);
    else hideLoading();
  }
}

document.addEventListener('DOMContentLoaded', boot, { once: true });
