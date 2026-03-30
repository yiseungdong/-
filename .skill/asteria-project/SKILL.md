---
name: asteria-project
description: |
  아스테리아(Asteria) 케이팝 팬덤 플랫폼 프로젝트 전용 스킬.
  아스테리아 관련 작업이라면 반드시 사용.
  HTML/CSS/JS 생성수정, 디자인, Claude API, 리그/캐릭터/아바타, 네비게이션, 별빛배경, server.js 수정 시 사용.
---

# 아스테리아 프로젝트 전용 스킬

## 프로젝트 개요
- 도메인: asteria.me.kr
- 호스팅: Render.com (무료)
- DB: PostgreSQL
- GitHub: github.com/yiseungdong/-
- 로컬 경로: C:\Users\이승동\클로드코드\asteria
- 목표: 케이팝 팬덤 전용 APP 기반 플랫폼 (현재 웹으로 구현 중)
- 진행률: 81/81 = 100% 기획 완료, UI 테스트 및 개선 진행 중

## 핵심 철학
"먼지에서 은하로, 팬이 주권을 갖는 우주: 아스테리아"
- 팬이 먼저 모이면 기획사가 찾아오는 구조
- 상향식 거버넌스, 데이터 주권, 모든 구역 경쟁심 자극

## 파일 구조 (2026.03.30 최신)
asteria/
├── server.js (5300+ 줄)
├── test-api.js (API 점검 20개)
├── test-security.js (보안 점검 8개)
├── check-deploy.js (배포 환경 점검)
└── public/
    ├── intro.html (별 모임→폭발 연출, 항상 풀버전)
    ├── index.html (모바일앱 스타일, 리그맵 전체화면, 5개 리그 전환)
    ├── astra.html, avatar.html, nebula.html, room3d.html
    ├── shop.html, chat.html, league.html, stats.html, archetype.html
    ├── admin.html, privacy.html, feedback.html
    └── data/ (ideas-masterplan.md, ideas-and-roadmap.json, operation-guide.md, test-checklist.md)

## 디자인 시스템
CSS 변수: --void:#030308, --gold:#f0c040, --accent:#c084fc, --accent2:#818cf8, --accent3:#38bdf8, --text:#e8e4f0
리그 색상: 더스트 #94a3b8 / 스타 #fbbf24 / 플래닛 #34d399 / 노바 #c084fc / 퀘이사 #f0c040
폰트: Noto Sans KR + Orbitron

## 레이아웃 (모바일 앱 스타일)
- 상단 헤더: ASTERIA + 🔔 + 로그인 (fixed)
- 중앙: 메인 컨텐츠
- 하단 네비: 홈/아스트라/내방/성궤/아바타/상점 (fixed)

## 인트로 (intro.html)
- 항상 풀버전 (방문횟수 분기 없음)
- 별 탄생(2초)→원형 모임(4초)→폭발(1초)→대기
- 클릭으로만 이동, 문구: "먼지에서 은하로, 팬이 주권을 갖는 우주"

## 메인 페이지 (index.html)
- 5개 리그 전환 탭
- 퀘이사: 1등 중앙 + 2~5등 접점 배치- 노바~더스트: 나선형 배치
- 팬클럽별 다양한 색상, 승격/강등 비교 바

## 리그 조직 구조
- 퀘이사(5개): 팬클럽→엠파이어→도미니언→섹터→클러스터→오빗→아스트라
- 노바(10개): 팬클럽→프로빈스→디스트릭트→스퀘어→라운지→아스트라
- 플래닛(20개): 팬클럽→테리토리→베이스→유닛→아스트라
- 스타(40개): 팬클럽→테리토리→베이스→유닛→아스트라
- 더스트(나머지): 팬클럽→게더링→포인트→아스트라

## 백엔드 주요 API
인증, 6대스탯, 에너지파이프라인, 시즌/승격/강등, 오라클감시자, 재판소, 소원의성궤, 국민투표, 경쟁시스템(4개), 성장엔진, 뉴비케어, AI모더레이션, 버그리포트, 피드백, 오픈이벤트

## 코드 규칙
1. 모든 주석 한글
2. CSS 변수 필수
3. 별빛 배경 모든 페이지
4. 하단 네비 6개 통일
5. 상단 헤더 통일
6. 한/영 병행
7. 반응형 모바일 퍼스트
8. Three.js r128 고정

## 배포: git add . → git commit → git push (한 줄씩 따로)
