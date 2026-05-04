---
name: asteria-character-svg
description: |
  아스테리아 프로젝트의 캐릭터 SVG 작업 전용 스킬.
  6명의 캐릭터(루카/제이/코코/아리/세나/루나)의 외형을 다루는 SVG 코드 작업에 사용.
  다음 상황에서 반드시 이 스킬을 사용하세요:
  - asteria/public/js/avatar-svgs.js 파일 수정/추가
  - 캐릭터 표정, 포즈, 의상, 헤어, 색상 변경
  - 신규 캐릭터 부위(얼굴 표정, 신발 등) 레이어 분리 작업
  - HAIR_STYLES, AVATAR_OUTFIT_SVGS, AVATAR_SVGS 객체 수정
  - getStyledHairSVG(), getStyledOutfitSVG() 함수 수정
  - character.html, avatar.html, room3d.html 의 캐릭터 SVG 렌더링 부분
  avatar-svgs, 아바타 SVG, 캐릭터 외형, 표정, 포즈, 헤어, 의상 등의 키워드가
  나오면 즉시 이 스킬을 사용하세요.
---

# 아스테리아 캐릭터 SVG 구현 스킬

## 핵심 원칙

이 스킬의 역할은 **엔젤(채팅)이 만든 사양서를 정확히 코드로 구현**하는 것.
디자인 결정권 없음. 의문 생기면 작업 멈추고 사용자에게 확인 요청.

---

## 1. 절대 깨면 안 되는 구조

### 1-1. 캐릭터 코드 매핑 (영구 고정)
```
m1 = 루카 (남성)
m2 = 제이 (남성)
m3 = 코코 (남성)
f1 = 아리 (여성)
f2 = 세나 (여성)
f3 = 루나 (여성)
```

이 매핑은 **절대 변경 금지**. 코드 어디서든 이 키로 캐릭터 식별.

### 1-2. 핵심 객체 구조
```javascript
// 메인 SVG 저장소
const AVATAR_SVGS = {
  m1: '<svg>...</svg>',  // 루카 기본 외형
  m2: '...',
  m3: '...',
  f1: '...',
  f2: '...',
  f3: '...'
};

// 헤어 스타일 (분리됨)
const HAIR_STYLES = { ... };
const HAIR_ID_MAP = { ... };
function getStyledHairSVG(hairId, color) { ... }

// 의상 (분리됨)
const AVATAR_OUTFIT_SVGS = { ... };
const OUTFIT_ID_MAP = { ... };
function getStyledOutfitSVG(outfitId, color) { ... }
```

이 객체/함수 이름과 시그니처는 절대 변경 금지. 다른 파일에서 import해서 씀.

### 1-3. 현재 분리 상태
- ✅ 헤어: 분리됨 (HAIR_STYLES)
- ✅ 의상: 분리됨 (AVATAR_OUTFIT_SVGS)
- ❌ 얼굴: 본체 SVG에 박힘 (분리 작업 필요)
- ❌ 신발: 본체 SVG에 박힘 (분리 작업 필요)

---

## 2. 작업 시작 전 필수 체크 (매번)

### 2-1. 파일 위치 확인
- 메인 파일: `asteria/public/js/avatar-svgs.js` (현재 540줄)
- 사용처 파일들:
  - `asteria/public/character.html` (1,145줄)
  - `asteria/public/avatar.html`
  - `asteria/public/room3d.html` (L2533에서 로드)
  - `asteria/public/astra.html`
  - `asteria/public/avatar-select.html`

수정 전 사용처 영향 범위 파악할 것.

### 2-2. 사양서 확인
엔젤이 보낸 프롬프트에 다음이 명확한지:
- [ ] 변경 대상 캐릭터 코드 (m1~f3 중 무엇)
- [ ] 변경할 객체/함수 이름
- [ ] 색상 HEX 코드 (있다면)
- [ ] SVG viewBox 좌표
- [ ] 다른 캐릭터에도 같이 적용할 건지

하나라도 빠지면 작업 멈추고 사용자에게 확인.

### 2-3. 기존 코드 읽기
어떤 줄을 어떻게 바꿀지 결정하기 전에:
1. avatar-svgs.js 전체 읽기 (Read 도구로)
2. 영향받을 함수/객체의 현재 상태 파악
3. 그 다음 수정 시작

---

## 3. 표정 추가 작업 (얼굴 레이어 분리)

현재 얼굴은 AVATAR_SVGS의 본체 SVG 안에 박혀있음. 표정 추가하려면 분리 필요.

### 3-1. 분리 전략
새 객체 추가:
```javascript
const FACE_EXPRESSIONS = {
  neutral: '<g class="face">...</g>',  // 기본
  happy: '...',
  sad: '...',
  angry: '...',
  surprised: '...',
  shy: '...'
};

const FACE_ID_MAP = {
  m1: { neutral: '...', happy: '...', ... },  // 캐릭터별 표정 다름
  m2: { ... },
  // ...
};

function getStyledFaceSVG(charCode, expression) {
  // 캐릭터별 표정 SVG 반환
}
```

### 3-2. 본체 SVG에서 얼굴 부위 제거
- AVATAR_SVGS의 각 캐릭터 SVG에서 얼굴 부위(눈/입) 제거
- 그 자리에 placeholder `<g class="face-slot"></g>` 삽입
- 렌더링 시 getStyledFaceSVG() 결과를 이 슬롯에 주입

### 3-3. 6명 일관성
한 명에게만 표정 추가하지 않음. 6명 전원에게 동시에 같은 표정 종류 적용. 그래야 시스템이 일관됨.

---

## 4. 색상 처리 규칙

### 4-1. 색상 변수화 필수
SVG 안에 색상 하드코딩 금지. 반드시 변수로:

❌ 나쁨:
```javascript
'<path d="..." fill="#ff0000"/>'
```

✅ 좋음:
```javascript
'<path d="..." fill="${color || \'#default\'}"/>'
```

### 4-2. 기본 색상 팔레트 (참고)
- 헤어 기본: `#3a2a1a` (다크브라운)
- 스킨 기본: `#ffe0b2`
- 입술: `#d8696a`

새 색상 추가 시 사양서의 HEX 코드 그대로 사용. 임의 변경 금지.

---

## 5. 작업 후 검증

### 5-1. 깨진 사용처 확인
수정 후 다음 페이지들이 정상 작동하는지 확인:
- character.html
- avatar.html
- room3d.html (3D 렌더링과 연동됨!)
- astra.html
- avatar-select.html

### 5-2. 6명 모두 렌더링 테스트
한 명만 수정해도 6명 다 깨지지 않았는지 확인. avatar-select.html 열면 6명 모두 한눈에 보임.

### 5-3. 콘솔 에러 확인
브라우저 콘솔에 에러 없는지 확인.

---

## 6. 알려진 deferred 버그 (작업 시 같이 해결할 것)

### 6-1. avatar.html 색상 팔레트 미반영 버그
- 위치: `asteria/public/avatar.html`
- 증상: 헤어/의상/스킨 색상 팔레트에서 색을 골라도 SVG에 반영 안 됨
- 추정 원인: `getStyledHairSVG()`/`getStyledOutfitSVG()` 호출 시 color 인자 누락 또는 전달 후 SVG 갱신 미발생
- 작업 시 발견하면 같이 수정. 단 사용자에게 "이거 같이 고칠까?" 확인 후.

### 6-2. room3d.html 아바타 뒷벽 등반 버그
- 위치: `asteria/public/room3d.html`
- 증상: 3D 아바타가 뒷벽을 타고 올라감
- SVG 자체 문제는 아니지만, 아바타 좌표 계산 로직과 연관됨

---

## 7. git push 규칙

작업 완료 후 자동 push 필수:
```bash
cd asteria
git add public/js/avatar-svgs.js [기타수정파일]
git commit -m "feat/fix: [변경 내용 한 줄]"
git push origin main
```

push하면 Render Auto-Deploy가 자동으로 사이트 반영.

---

## 8. 사용자에게 보고할 내용

작업 끝나면 다음을 사용자에게 알림:

1. **수정한 파일 목록**
2. **변경된 함수/객체**
3. **6명 캐릭터 영향 (1명만? 6명 전원?)**
4. **테스트 권장 페이지**: "asteria.me.kr/avatar-select.html 열어서 6명 다 정상 렌더링되는지 확인해줘"
5. **git push 결과**

---

## 9. 절대 하지 말 것

- ❌ 캐릭터 코드 매핑 변경 (m1~f3)
- ❌ AVATAR_SVGS, HAIR_STYLES 등 핵심 객체 이름 변경
- ❌ 함수 시그니처 변경 (다른 파일에서 import 중)
- ❌ 한 명만 수정하고 6명 일관성 안 맞춰놓기
- ❌ 사양서에 없는 디자인 결정 (색상 임의 선택, 모양 임의 변경)
- ❌ 알려진 deferred 버그를 사용자 확인 없이 같이 수정
- ❌ git push 빼먹기

---

**버전: v1.0 (2026-05-04)**
