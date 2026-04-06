---
name: unlisted-research
description: 비상장 리서치 시스템 전용 스킬. 비상장, 리포트, 수집, 크롤링, 뉴스, DART, KIPRIS, 38커뮤니케이션, 증권플러스, VC투자, 특허, 허가, 스케줄러 관련 작업 시 자동 활성화.
---

# 비상장 리서치 시스템 스킬

## 이 프로젝트란
비상장 유망 종목을 자동 발굴하여 매일 오후 4시에 종목별 .md 리포트를 생성하는 Node.js 시스템.

## 즉시 확인할 것
1. .env 파일에 API 키 5개 모두 있는지 확인
   (CLAUDE_API_KEY, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, DART_API_KEY, KIPRIS_API_KEY)
2. reports/ 폴더 존재하는지 확인 (없으면 자동 생성)
3. node_modules 설치 여부 확인 (없으면 npm install 실행)

## 리포트 섹션 체크리스트 (작성 완료 후 반드시 확인)
[ ] 1. 기업 기본정보
[ ] 2. VC 투자 이력 (라운드 테이블 + VC 리스트 + 밸류 상승률 + 누적 총액)
[ ] 3. 특허·인증
[ ] 4. 허가·규제 진행
[ ] 5. 비상장 거래가격 (38 + 증권플러스, 없으면 "거래 없음" 명시)
[ ] 6. AI 종합의견 + 출처 링크

## 수집 실패 처리
각 섹션별로 독립 try-catch. 실패해도 다음 섹션 계속 진행.
실패 표시: > ⚠️ 수집 실패: [에러 이유]

## 크롤링 주의사항
- 요청 간격 최소 2초
- User-Agent 헤더 반드시 포함
- 38커뮤니케이션: https://www.38.co.kr
- 증권플러스 비상장: https://www.kstockplus.com

## 코드 작성 완료 후 순서
1. coder-reviewer 코드 검토
2. coder-tester 실행 테스트
3. 문제 없으면 git 커밋 (반드시 세 줄로 분리):
   git add .
   git commit -m "메시지"
   git push

## 에이전트 호출 순서 (코딩 작업)
coder-(해당담당) 작성 → coder-reviewer 검토 → coder-tester 테스트

## 에이전트 호출 순서 (런타임)
scheduler → collector → analyzer → reporter
