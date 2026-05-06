---
name: coding-convention
description: 아스테리아 프로젝트 코딩 컨벤션. HTML/CSS/JS/Node.js 작업 시 반드시 준수.
---

# 아스테리아 코딩 컨벤션

## 프로젝트 스택
- Frontend: HTML5, CSS3, Vanilla JS (ES6+)
- Backend: Node.js + Express
- DB: PostgreSQL
- 실시간: Socket.IO
- 배포: Render (asteria.me.kr)
- 로컬 경로: C:\Users\이승동\클로드코드\asteria\

## CSS 변수 (반드시 사용)
```css
--gold: #f0c040
--white: #e8e4f0
--purple: #c084fc
--dark: #0a0a1a
--star-blue: #60a5fa
```

## 색상 규칙
- 다크 배경에서 텍스트: #e8e4f0 이상만 사용
- 골드 강조: #f0c040
- 보라 강조: #c084fc
- 절대 인라인 색상값 하드코딩 금지 → CSS 변수 사용

## 폰트
- 영문 제목: Orbitron
- 한글 본문: Noto Sans KR
- Google Fonts CDN 사용

## Member ID (성궤번호) 규칙
- 형식: 6자리 영숫자 AA0001~ZZ9999
- 표시: 보라색 글자 + 금색 숫자
- DB 컬럼명: astra_id

## 인증 규칙
- JWT 토큰: localStorage의 'asteria_token' 키
- 로그인 필요 페이지: 최상단에서 토큰 확인 후 없으면 /login.html 리다이렉트
- 팬클럽 ID: localStorage의 'fandomId'
- 리그: localStorage의 'league'

## API 규칙
- 모든 인증 API: Authorization: Bearer {token} 헤더 필수
- 응답 형식: { success: true/false, data: {}, message: '' }
- 에러 응답: { success: false, error: '메시지' }

## 리그 색상 테마
- 더스트: #9ca3af (회색)
- 스타: #c0c0c0 (은색)
- 플래닛: #34d399 (에메랄드)
- 노바: #a78bfa (보라)
- 퀘이사: #f0c040 (골드)

## 조직 계층 (리그별)
- 더스트: 팬클럽 → 게더링 → 포인트 → 아스트라
- 스타: 팬클럽 → 테리토리 → 베이스 → 유닛 → 아스트라
- 플래닛: 팬클럽 → 테리토리 → 베이스 → 유닛 → 아스트라
- 노바: 팬클럽 → 프로빈스 → 디스트릭트 → 스퀘어 → 라운지 → 아스트라
- 퀘이사: 팬클럽 → 엠파이어 → 도미니언 → 섹터 → 클러스터 → 오빗 → 아스트라

## Git 규칙
- 커밋 메시지: 한국어로 작성
- 명령어는 반드시 3줄 분리 (&&연결 금지)
