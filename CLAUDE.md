# 비상장 리서치 시스템

## 프로젝트 목적
비상장 유망 종목을 자동 발굴하여 매일 오후 4시에 종목별 리포트(.md)를 자동 생성하는 시스템.

## 경로
- 프로젝트 루트: C:\Users\이승동\Desktop\프로그래밍\비상장\
- 리포트 저장: C:\Users\이승동\Desktop\프로그래밍\비상장\reports\YYYY-MM-DD\회사명.md
- 로그: C:\Users\이승동\Desktop\프로그래밍\비상장\logs\

## 기술 스택
- Node.js + axios
- Puppeteer (크롤링)
- node-cron (스케줄러)
- Claude API (claude-sonnet-4-6)
- fs-extra (파일 저장)

## API 키 관리
모든 키는 반드시 .env에서만 관리. 코드에 직접 입력 절대 금지.
- CLAUDE_API_KEY
- NAVER_CLIENT_ID
- NAVER_CLIENT_SECRET
- DART_API_KEY
- KIPRIS_API_KEY

## 리포트 구조 (반드시 이 6개 섹션 순서로)

### 1. 기업 기본정보
- 회사명, 설립연도, 업종, 대표자, 주요 제품·서비스
- 추정 기업가치 (최신 라운드 기준)

### 2. VC 투자 이력 ★핵심
- 라운드별 테이블: 라운드명 / 투자금액 / 밸류에이션 / 날짜
- 참여 VC 리스트 (라운드별 전체)
- 직전 라운드 대비 밸류 상승률 (%)
- 누적 투자유치 총액

### 3. 특허·인증
- 보유 특허 목록 (특허명 / 출원일 / 등록번호) — KIPRIS API
- 국내외 인증 (ISO, KC, CE 등)
- 수상 이력 (정부 과제, 기술 대상 등)

### 4. 허가·규제 진행
- 업종 자동 판단 후 해당 소스 선택:
  - 바이오/의료기기 → 식약처 공고 + 임상 정보
  - 핀테크/금융 → 금융위원회 보도자료
  - 통신/IT → 과기부 공고
  - 그 외 → 뉴스 기반 Claude 판단
- 진행 중 허가 현황 + 예상 완료 시점
- 규제 리스크 메모

### 5. 비상장 거래가격
- 38커뮤니케이션: 거래가 + 최근 거래일
- 증권플러스 비상장: 거래가 + 호가 스프레드
- 미등록 시: "거래 없음 (38/증권플러스 모두 미등록)"

### 6. AI 종합의견
- 투자 매력도 점수 (1~10)
- 핵심 강점 3가지
- 주요 리스크 3가지
- IPO 가능성 및 예상 시점
- 출처 링크 전체 목록

## 수집 소스 우선순위
1순위: 더벨, 한국경제, 매일경제 (네이버 뉴스 API + 직접 크롤)
2순위: KVCA, 투자유치 관련 기사 전체
3순위: CES, MWC, AWS re:Invent, 국내 데모데이
4순위: DART 공시, KIPRIS 특허청

## 핵심 키워드 (뉴스 수집 시 사용)
투자유치, 시리즈A, 시리즈B, 시리즈C, 프리IPO, 비상장, VC투자,
신기술인증, 특허등록, 임상승인, 식약처허가, 금융위인가, 기업가치

## 에이전트 구조

### 코딩팀 (코드 작성·검증) — .claude/agents/
| 에이전트 | 담당 |
|---|---|
| coder-collector | src/collectors/ 수집 코드 전담 |
| coder-analyzer | src/analyzer.js 분석 코드 전담 |
| coder-reporter | src/reportWriter.js 리포트 코드 전담 |
| coder-infra | scheduler.js, index.js, .env 인프라 전담 |
| coder-reviewer | 전체 코드 검토·버그 발견 (Read 전용) |
| coder-tester | 실행 테스트·API 연결 검증 |

### 런타임팀 (실제 실행) — .claude/agents/
| 에이전트 | 담당 |
|---|---|
| collector | 뉴스·VC트렌드·DART·가격·특허/허가 수집 실행 |
| analyzer | Claude AI 분석·스코어링 실행 |
| reporter | .md 리포트 생성·저장 실행 |
| scheduler | 매일 오후 4시 전체 파이프라인 조율 |

## MCP 설정
- Puppeteer MCP: 38커뮤니케이션, 증권플러스 브라우저 크롤링
- Fetch MCP: 네이버 뉴스 API, DART API, KIPRIS API 호출
- Filesystem MCP: reports/ 폴더 파일 생성·저장

## 훅 동작 (settings.json)
- PostToolUse(Write): 파일 저장 직후 자동 lint
- PostToolUse(수집완료): analyzer 자동 시작
- PostToolUse(분석완료): reporter 자동 시작
- PreToolUse(Bash): rm -rf 등 위험 명령어 차단
- Stop: 세션 종료 시 logs/에 실행 결과 기록

## 슬래시 커맨드
- /run-daily: 오늘 날짜 리포트 전체 생성
- /add-company [회사명]: 특정 회사 즉시 리포트 생성
- /check-price [회사명]: 비상장 거래가격만 즉시 조회

## 코딩 규칙
- 모든 에러는 콘솔 출력 후 해당 섹션 "수집 실패 - [이유]"로 표시하고 계속 진행 (전체 중단 금지)
- 크롤링 요청 간격 최소 2초 (봇 차단 방지)
- User-Agent 헤더 반드시 포함
- 날짜별 폴더 자동 생성 (없으면 생성)
- git 명령어는 항상 세 줄로 분리 (PowerShell && 미지원):
  git add .
  git commit -m "메시지"
  git push
- 코드 작성 완료 시 반드시 coder-reviewer 검토 → coder-tester 테스트 순서 준수
- 파일 저장 후 자동 lint 실행 (PostToolUse 훅)

## 절대 금지
- API 키 코드에 직접 하드코딩
- 수집 실패 시 전체 프로세스 중단
- 크롤링 딜레이 없이 연속 요청
- 서브에이전트에서 다른 서브에이전트 직접 호출
- rm -rf 명령어 사용
