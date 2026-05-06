---
name: character-svg
description: 아스테리아 6캐릭터 SVG 작업 규칙. avatar-svgs.js 수정 시 반드시 참조.
---

# 아스테리아 캐릭터 SVG 스킬

## 캐릭터 코드 매핑 (절대 변경 금지)
- m1 = 루카 (남성, 차분하고 신뢰감)
- m2 = 제이 (남성, 활발하고 에너지 넘침)
- m3 = 코코 (남성, 귀엽고 장난기 많음)
- f1 = 아리 (여성, 우아하고 강인함)
- f2 = 세나 (여성, 밝고 사교적)
- f3 = 루나 (여성, 신비롭고 감성적)

## 파일 위치
- SVG 정의: /public/js/avatar-svgs.js
- 아바타 페이지: /public/avatar.html
- 캐릭터 페이지: /public/character.html

## 색상 변수화 규칙
- 모든 색상은 AVATAR_COLOR_MAP에서 관리
- 헤어 색상: hairColor 변수
- 의상 색상: outfitColor 변수
- 피부 색상: skinColor 변수
- SVG 내부에 색상 하드코딩 절대 금지

## 레이어 구조
1. 몸체 (body) — 피부색
2. 의상 (outfit) — AVATAR_OUTFIT_SVGS
3. 헤어 (hair) — HAIR_STYLES
4. 얼굴 (face) — 현재 본체에 포함 (분리 작업 예정)
5. 악세서리 (accessory)
6. 오라 (aura) — 스탯 기반

## 6명 일관성 검사 (작업 후 필수)
- 모든 캐릭터 동일 함수 구조 적용 확인
- AVATAR_COLOR_MAP에 6명 전원 정의 확인
- getStyledSVG 함수 동작 확인
- localStorage 키: asteria_avatar_hairColor, asteria_avatar_outfitColor, asteria_avatar_skin

## 알려진 버그 (deferred)
- avatar.html: 색상 팔레트 선택 시 SVG 미반영
- room3d.html: 아바타 뒷벽 등반
- room3d.html: edit-toolbar 좌측 정렬 문제
