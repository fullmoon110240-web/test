/*
 * 캐릭터 두 명의 '자리'입니다.
 *
 * 이름 · 컬러 · 기본 이미지는 화면의 [설정]에서 바꾸고, DB의 settings 표에 저장됩니다.
 * 여기 적힌 defaultName 은 아무것도 설정하지 않았을 때 보이는 이름입니다.
 *
 * id 는 DB에 character_id 로 저장됩니다. 쓰기 시작한 뒤에는 바꾸지 마세요.
 * slot 은 CSS 변수 이름(--color-a, --color-b)과 화면 요소 id 에 쓰입니다.
 */
export const CHARACTER_DATA = Object.freeze({
  'char-a': Object.freeze({
    id: 'char-a', slot: 'a', defaultName: 'A',
    cardId: 'card-a', avatarId: 'avatar-a', imageId: 'img-a', bubbleId: 'bubble-a',
    addButtonId: 'btn-a', listButtonId: 'list-btn-a'
  }),
  'char-b': Object.freeze({
    id: 'char-b', slot: 'b', defaultName: 'B',
    cardId: 'card-b', avatarId: 'avatar-b', imageId: 'img-b', bubbleId: 'bubble-b',
    addButtonId: 'btn-b', listButtonId: 'list-btn-b'
  })
});

export const CHARACTER_IDS = Object.freeze(Object.keys(CHARACTER_DATA));

// 컬러를 정하지 않았을 때 쓰는 회색.
export const DEFAULT_COLOR = '#6b7280';
