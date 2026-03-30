---
name: coding-assistant
description: |
  아스테리아 프로젝트 코딩 어시스턴트 스킬.
  에러 해결, 코드 리뷰, 디버깅, 최적화 등 코드 관련 작업에 사용.
  에러, 버그, 디버깅, 오류, 작동, 코드 리뷰 등의 키워드가 나오면 즉시 이 스킬을 사용하세요.
---

# 아스테리아 코딩 어시스턴트

## 프로젝트 환경
- OS: Windows PC
- 에디터: VS Code + Claude Code 터미널
- Node.js: v24
- 서버: Express + PostgreSQL
- 호스팅: Render.com
- 로컬 경로: C:\Users\이승동\클로드코드\asteria
- 로컬 DB 연결 불가: Render.com 라이브 서버에서만 테스트

## 사용자 수준
- 프로그래밍 완전 초보
- 모든 설명을 상세하게 해야 함
- 터미널 명령어 복사-붙여넣기 방식으로 안내

## PowerShell 주의사항
- && 연결 안됨 → 명령어 한 줄씩 따로 실행
- curl 안됨 → Invoke-RestMethod 사용
- 파일명에 (2) 붙는 문제 → Copy-Item -Force로 덮어쓰기
- 한글 인코딩 문제 → 코드는 ASCII 영문으로

## Git 저장 (항상 3줄 따로 안내)
```
git add .
```
```
git commit -m "설명"
```
```
git push
```

## 프롬프트 작성 규칙
- 긴 프롬프트는 2개로 분리 (Part 1/Part 2)- 1번: masterplan.md 업데이트
- 2번: server.js API 추가
- 클로드 코드가 "이미 있다"고 하면 더 구체적으로 줄 번호 지정하여 지시
- 프롬프트는 아티팩트 파일로 제공 (복사-붙여넣기 용이하게)

## 에러 디버깅 순서
1. 에러 메시지/스크린샷 확인
2. grep으로 관련 코드 검색
3. sed로 해당 줄 확인
4. 원인 파악 후 수정 프롬프트 제공
5. git push 후 2~3분 대기 → Ctrl+Shift+R 강력 새로고침

## 자주 발생하는 문제와 해결법

### Render.com 배포 지연
- 증상: push 했는데 사이트 안 바뀜
- 해결: 2~3분 대기 후 Ctrl+Shift+R

### 브라우저 캐시
- 증상: 코드 변경했는데 화면 그대로
- 해결: Ctrl+Shift+R (강력 새로고침)

### localStorage 잔여 데이터
- 증상: 인트로가 스킵됨, 이전 데이터 남아있음
- 해결: F12 → Console → localStorage.removeItem('키이름')

### 코드 변경 안 반영
- 증상: 프롬프트 실행했는데 코드 안 바뀜
- 해결: git status로 push 확인 → git log --oneline -5로 커밋 확인

### 클로드 코드가 수정 안 함
- 증상: "이미 있다", "구조상 문제 없다"고 판단
- 해결: "아니야, 반드시 수정해줘" + 구체적 줄 번호 지정 + 정확한 변경 내용 명시

### Render.com 서버 재시작 화면- 증상: 사이트 접속 시 Render 로고 + "서비스 시작 중"
- 해결: 정상. 2~3분 대기

### 콘솔 에러 확인
- F12 → Console 탭에서 에러 확인
- "allow pasting" 먼저 타이핑해야 붙여넣기 가능

## server.js 구조 (5300+ 줄)
- DB 테이블 자동 생성 (서버 시작 시)
- authenticateToken 미들웨어 (JWT 인증)
- 주요 API 그룹:
  - /api/auth/* (인증: register/login/refresh/logout)
  - /api/users/* (프로필/스탯/활동/출석/아키타입)
  - /api/activity/* (활동기록/콤보/시너지/PoP)
  - /api/leagues/* (리그/랭킹/시즌)
  - /api/organizations/* (조직CRUD/주간평가/MVP)
  - /api/shop/* (상점/인벤토리/거래소/뽑기)
  - /api/economy/* (지갑/선물/원장/일일보상)
  - /api/wishes/* (소원의 성궤)
  - /api/votes/* (국민 투표)  - /api/rivals/* (라이벌 매칭)
  - /api/stat-kings/* (스탯킹)
  - /api/org-wars/* (모임 워즈)
  - /api/firepower/* (화력 전선)
  - /api/mirror-match/* (미러 매치)
  - /api/season-mvp/* (시즌 MVP)
  - /api/archetype/* (아키타입 재계산)
  - /api/sovereign/* (소버린)
  - /api/catchup/* (캐치업)
  - /api/onboarding/* (온보딩 퀘스트)
  - /api/honor-wall (명예의 벽)
  - /api/ranking/* (순위 알림)
  - /api/moderation/* (AI 모더레이션)
  - /api/mood/* (감정 온도계)
  - /api/insight/* (주간 인사이트)
  - /api/bugs (버그 리포트)
  - /api/feedback (피드백)
  - /api/events/* (오픈 이벤트)
- 배치 스케줄러:
  - 매일 자정: 에너지파이프라인, 순위요약, 화력기록, 명예의벽체크, 감정분석, 소원파이프라인
  - 매시간: 미러매치체크, 투표자동처리
  - 월/목 자정: 아키타입재계산, 소버린체크
  - 매주 월요일: 주간평가, 데이터정리
  - 매월 첫째주: 모임워즈 생성
  - 매월 셋째주: 라이벌 매칭
  - 시즌 종료 시: MVP산출, 승격강등, 소원정산

## 저장 타이밍 안내 규칙
- 프롬프트 3~4개 쌓이면 → "🔴 지금 저장하세요!" 알림 + git 명령어 제공
- 채팅방 꽉 차기 전 → "🚨 반드시 저장!" 알림 + masterplan 업데이트 프롬프트 + git 명령어
- 저장 시 항상 3줄 따로 제공 (git add / git commit / git push)
