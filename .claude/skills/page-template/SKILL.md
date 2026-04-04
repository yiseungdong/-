---
name: page-template
description: 아스테리아 새 HTML 페이지 생성 시 사용하는 템플릿. 새 페이지를 만들거나 html 파일을 생성할 때 자동 적용.
---

# Asteria Page Template

새 HTML 페이지 생성 시 반드시 다음 구조를 따를 것:

## 필수 포함 요소
1. 별빛 배경 (starfield)
2. 네비게이션 바 (nav-bar)
3. 이중 언어 지원 (ko/en)
4. 리그별 테마 색상 대응
5. 반응형 레이아웃

## HTML 기본 구조
- DOCTYPE html, lang="ko"
- meta charset UTF-8, viewport 설정
- 공통 CSS 링크: /css/common.css
- 공통 JS: /js/nav.js, /js/starfield.js
- 페이지별 CSS/JS 분리

## 네비게이션 연결
- nav.js의 기존 메뉴 구조에 맞춰 추가
- 현재 페이지 활성화 표시

## 인증 체크
- 로그인 필요 페이지는 상단에서 JWT 토큰 확인
- 비로그인 시 login.html로 리다이렉트
