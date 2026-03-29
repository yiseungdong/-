---
name: asteria-project
description: 아스테리아 케이팝 팬덤 플랫폼 프로젝트 전용 스킬. HTML/CSS/JS 파일 생성/수정, 디자인, Claude API 연동, 리그/캐릭터/아바타/팬덤마을 시스템, server.js 수정 시 사용.
---

# 아스테리아 프로젝트 스킬

## 프로젝트 개요
- 도메인: asteria.me.kr
- 호스팅: Render.com
- DB: PostgreSQL
- GitHub: github.com/yiseungdong/-
- 로컬경로: C:\Users\이승동\클로드코드\asteria

## 파일 구조
- intro.html: 인트로 애니메이션
- index.html: 메인 홈 (리그 맵)
- fandom.html: 팬덤 마을 (드라마 세트장, 7개 건물, 아바타 이동)
- astra.html: 아바타 성장
- avatar.html: 아바타 꾸미기
- nebula.html: 아스트라 성궤
- room3d.html: Three.js 3D 방
- shop.html: 상점
- chat.html: 아티스트 1:1 대화
- league.html: 리그 시스템
- admin.html: 관리자 패널
- server.js: Node.js+Express 백엔드

## 네비게이션 (7개 메뉴)
팬덤(🏘️)/홈(🏠)/아스트라(⭐)/내방(🏡)/성궤(🌌)/아바타(🎭)/상점(🛒)

## CSS 변수
--void:#030308, --panel:rgba(10,10,22,0.96), --border:rgba(180,150,255,0.13)
--gold:#f0c040, --accent:#c084fc, --accent2:#818cf8, --accent3:#38bdf8
--text:#e8e4f0, --muted:rgba(200,190,220,0.5)
마을전용: --ground:#1a1a2e, --grass:#0d2818, --road:#2a2540

## 리그 테마색
더스트(#94a3b8), 스타(#fbbf24), 플래닛(#34d399), 노바(#c084fc), 퀘이사(#f0c040)

## 폰트
Noto Sans KR(기본), Orbitron(숫자/타이틀)

## 코드 규칙
1. 주석 한글
2. CSS변수 필수
3. 별빛배경 모든페이지
4. 네비 7개 메뉴 (팬덤/홈/아스트라/내방/성궤/아바타/상점) 통일
5. 반응형 모바일퍼스트
6. Three.js r128
7. UI텍스트 한/영 병행
