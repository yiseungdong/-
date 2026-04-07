# 비상장 리서치 시스템 마스터플랜
> 최종 업데이트: 2026-04-07

---

## 프로젝트 개요

**목적:** 매일 오전 10시에 오늘 뉴스/VC동향/박람회에 노출된 비상장 회사를 자동 발굴하여 종목별 리포트(.md) + 누적 엑셀 파일 자동 생성

**경로:**
- 프로젝트: `C:\Users\이승동\Desktop\프로그래밍\비상장\`
- 리포트: `C:\Users\이승동\Desktop\프로그래밍\비상장\reports\YYYY-MM-DD\`
- 엑셀: `C:\Users\이승동\Desktop\프로그래밍\비상장\reports\excel\`
- 로그: `C:\Users\이승동\Desktop\프로그래밍\비상장\logs\`

---

## 기술 스택

```
Node.js + axios
Puppeteer (크롤링)
node-cron → Windows 작업 스케줄러로 대체
Claude API (claude-sonnet-4-6)
ExcelJS (엑셀 생성)
fs-extra (파일 저장)
```

---

## API 키 현황

| 키 | 상태 | 사이트 |
|---|---|---|
| CLAUDE_API_KEY | ✅ 완료 | console.anthropic.com |
| NAVER_CLIENT_ID | ✅ 완료 | developers.naver.com |
| NAVER_CLIENT_SECRET | ✅ 완료 | developers.naver.com |
| DART_API_KEY | ✅ 완료 | opendart.fss.or.kr |
| KIPRIS_API_KEY | ✅ 완료 | plus.kipris.or.kr |

---

## 자동 실행 설정

- **Windows 작업 스케줄러** 등록 완료
- 작업 이름: `비상장리서치_오전10시`
- 실행 시간: 매일 오전 10:00
- 실행 명령: `node C:\Users\이승동\Desktop\프로그래밍\비상장\index.js`
- 수동 실행: `run.bat` 더블클릭

---

## 에이전트 구조 (10개)

### 코딩팀
| 에이전트 | 담당 |
|---|---|
| coder-collector | src/collectors/ 수집 코드 |
| coder-analyzer | src/analyzer.js 분석 코드 |
| coder-reporter | src/reportWriter.js 리포트 코드 |
| coder-infra | scheduler.js, index.js 인프라 |
| coder-reviewer | 코드 검토·버그 발견 (Read 전용) |
| coder-tester | 실행 테스트·검증 |

### 런타임팀
| 에이전트 | 담당 |
|---|---|
| collector | 수집 실행 |
| analyzer | 분석 실행 |
| reporter | 리포트 생성 |
| scheduler | 전체 파이프라인 조율 |

---

## 전체 파이프라인

```
① 뉴스 수집 (naverNews.js + vcTrends.js)
   네이버 뉴스 API — 투자유치/비상장 키워드

② 회사명 추출 (companyExtractor.js)
   Claude API 하루 1~2번 호출 (비용 최소화)

③ 상장/비상장 판단 (listingChecker.js)
   KRX 상장 목록 비교 → DART 최종 확인

④ 보조 정보 수집 (비상장 확정 회사만, 병렬)
   dartApi.js — 재무제표 + 투자자추출 + 발행주식수
   priceTracker.js — 38/증권플러스 거래가격 + 시총환산
   companyInfo.js — 특허/허가 정보
   thevcCrawler.js — THE VC 투자 라운드 (신규)
   innoforestCrawler.js — 혁신의숲 기업 정보 (신규)
   nextunicornCrawler.js — 넥스트유니콘 데이터 (신규)

⑤ 밸류 히스토리 소급 검색 (새 회사만, 최대 10개)
   valuationHistorySearch.js — 과거 기사 전체 기간 검색
   Claude API로 라운드별 밸류 추출 + 크로스체크

⑥ 섹터 분류 (sectorClassifier.js)
   9개 섹터 키워드 매칭 + Claude AI 판단

⑦ 밸류 크로스체크 (crossChecker.js)
   다소스 밸류 비교, 편차 20% 이상 불일치 플래그

⑧ 시세기반 밸류 계산
   38커뮤 가격 × DART 발행주식수 = 시가총액

⑨ 투자자 티어 분류 (vcTierClassifier.js)
   T1/T2/T3/CVC/정책금융 자동 분류 + 점수 산출

⑩ 후속투자 추적 (followOnTracker.js)
   같은 VC 연속 투자 패턴 + 자동 태그

⑪ VC 포트폴리오 유사기업 연결 (vcPortfolioLinker.js)

⑫ 피어그룹 매칭 + 적정 밸류 산출 (기존)

⑬ 매력도 점수 계산 (scoreEngine.js)
   9개 섹터별 배점 + 투자자티어/밸류상승률/후속투자/크로스체크 가감점

⑭ AI 분석 (analyzer.js)
   Claude API — 사업요약/시장경쟁/핵심강점/핵심리스크/IPO전망

⑮ 리포트 생성 (reportWriter.js)
   8개 섹션 .md 파일 (밸류 크로스체크/투자자 티어 포함)

⑯ 엑셀 업데이트 (excelWriter.js)
   4개 시트 누적 저장

⑰ VC DB 업데이트 (vcDatabaseManager.js)
   신규 VC 자동 추가
```

---

## 소스 파일 구조

```
비상장/
├── .claude/
│   ├── agents/          ← 에이전트 10개
│   ├── commands/        ← 슬래시 커맨드 3개
│   ├── settings.json    ← 훅 + MCP 설정
│   └── SKILL.md         ← 프로젝트 스킬
├── src/
│   ├── collectors/
│   │   ├── index.js                  ← 수집 파이프라인 조율
│   │   ├── naverNews.js              ← 네이버 뉴스 수집 (+9개 키워드 추가)
│   │   ├── vcTrends.js               ← VC/박람회 뉴스
│   │   ├── companyExtractor.js       ← Claude AI 회사명+밸류+VC 동시추출
│   │   ├── dartApi.js                ← DART 재무+투자자+발행주식수
│   │   ├── priceTracker.js           ← 38/증권플러스 가격+시총환산
│   │   ├── companyInfo.js            ← 특허/허가 정보
│   │   ├── thevcCrawler.js           ← THE VC 크롤링 (신규)
│   │   ├── innoforestCrawler.js      ← 혁신의숲 크롤링 (신규)
│   │   ├── nextunicornCrawler.js     ← 넥스트유니콘 크롤링 (신규)
│   │   ├── vcsCrawler.js             ← 벤처투자종합포털 (신규)
│   │   ├── kvcaCrawler.js            ← KVCA VC목록 (신규)
│   │   └── valuationHistorySearch.js ← 밸류 히스토리 소급검색 (신규)
│   ├── sectorClassifier.js    ← 9개 섹터 분류 + 성장성 등급
│   ├── peerGroupMatcher.js    ← 네이버 금융 + 피어그룹 매칭
│   ├── valuationEngine.js     ← 적정 밸류 산출
│   ├── scoreEngine.js         ← 9개 섹터 매력도 점수 + 가감점
│   ├── analyzer.js            ← Claude AI 분석 (사업요약/강점/리스크)
│   ├── reportWriter.js        ← .md 리포트 생성 (8섹션)
│   ├── excelWriter.js         ← 엑셀 4시트 생성 (ExcelJS)
│   ├── scheduler.js           ← 전체 파이프라인 (3Phase)
│   ├── crossChecker.js        ← 밸류 크로스체크 (신규)
│   ├── vcDatabaseManager.js   ← VC DB 관리 (신규)
│   ├── vcTierClassifier.js    ← 투자자 티어 분류 (신규)
│   ├── followOnTracker.js     ← 후속투자 추적 (신규)
│   ├── vcPortfolioLinker.js   ← 포트폴리오 유사기업 (신규)
│   └── coInvestmentNetwork.js ← 공동투자 패턴 (신규)
├── reports/
│   ├── YYYY-MM-DD/            ← 일별 .md 리포트
│   └── excel/                 ← 주차별 누적 엑셀
├── logs/                      ← 실행 로그
├── .env                       ← API 키
├── index.js                   ← 진입점
├── run.bat                    ← 수동 실행
├── setup-scheduler.bat        ← 스케줄러 등록
└── register-task.bat          ← 작업 재등록
```

---

## 리포트 구조 (8개 섹션)

```
# 🏢 회사명
> 분석일 | 섹터 | 성장성등급 | 투자 매력도

1. 기업 기본정보
2. VC 투자 이력 (라운드 테이블 + VC 리스트 + 밸류 상승률)
3. 밸류에이션 분석 ← 신규
   - 성장성 등급 산출
   - 피어그룹 매칭 (동일 성장성 등급 상장사)
   - 적정 밸류 산출 + 저평가/고평가 판단
4. 특허·인증 (KIPRIS)
5. 허가·규제 진행 (업종별 자동 판단)
6. 비상장 거래가격 (38 + 증권플러스)
7. 매력도 점수 상세 ← 신규
   - 섹터별 항목별 점수 + 근거
   - 섹터 프리미엄 배수
8. AI 종합의견
   - 한줄 요약, 강점/리스크, IPO전망
```

---

## 엑셀 구조 (4개 시트)

### Sheet1: 비상장_누적 (18컬럼 A~R)
```
A. 날짜           J. 누적투자총액(억)
B. 회사명         K. 참여VC ← [리드] 형식
C. 섹터           L. 38커뮤니케이션
D. 매력도점수 ★   M. 증권플러스
E. 최신라운드     N. 특허수
F. 투자금액(억)   O. 핵심강점 ← 통합
G. 직전밸류(억)   P. 핵심리스크 ← 통합
H. 현재밸류(억)   Q. IPO전망
I. 밸류소스       R. 출처링크

★ D열 노란색 강조
현재밸류 형식: "3000억 (▲200%)"
밸류소스: VC-직접 / VC-역산 / 시세기반
```

### Sheet2: 회사프로파일 (5컬럼)
```
A. 날짜    D. 사업요약 ← 통합
B. 회사명  E. 시장/경쟁 ← 통합
C. 섹터
```

### Sheet3: 가격변동알림
```
가격변동: 전영업일 대비 10% 이상 변동 종목
VC밸류변동: 직전 대비 50%+ 상승/다운라운드 알림
```

### Sheet4: VC밸류히스토리 (신규)
```
A. 회사명  F. 리드투자자
B. 날짜    G. 전체참여VC
C. 라운드   H. 투자형태
D. 밸류(억) I. 밸류소스
E. 투자금액  J. 출처
```

---

## 9개 섹터 + 배점 기준

### 매출 기반 섹터 (5개)
| 섹터 | 핵심 배점 항목 |
|---|---|
| 커머스·플랫폼 | 재무/매출 25점, VC투자 30점, 기술 15점 |
| 핀테크·금융 | 규제·허가 20점, 재무 20점, VC투자 25점 |
| 모빌리티·물류 | 인프라·운영 20점, ESG·정책 15점, VC투자 25점 |
| B2B·SaaS | 반복매출(ARR) 25점, 고객구조 20점, 전환비용 15점 |
| 엔터·콘텐츠 | IP가치 25점, 팬덤·플랫폼 20점, VC투자 20점 |

### 기술/파이프라인 기반 섹터 (3개)
| 섹터 | 핵심 배점 항목 |
|---|---|
| 바이오·신약 | VC밸류등급 35점, 임상파이프라인 25점, 기술·특허 15점 |
| 의료기기 | VC밸류등급 30점, 인허가·매출 25점, 기술·특허 20점 |
| 뷰티·헬스케어 | 브랜드·매출 30점, 글로벌수출 20점, 제품·성분 15점 |

### AI·딥테크 기반 섹터 (1개)
| 섹터 | 핵심 배점 항목 |
|---|---|
| 딥테크·AI | 기술력·데이터 30점, VC밸류등급 25점, 고객·매출 20점 |

**공통:**
- 가산점: 최대 +15점 (글로벌 인허가, 빅테크 파트너십 등)
- 감산점: 최대 -10점 (다운라운드, 리스크 요인 등)
- 섹터 프리미엄 배수: × 0.7 ~ × 1.3 (상장사 PER 기반 자동 계산)

---

## 밸류에이션 산출 방식

```
① 비상장사 성장성 등급 산출 (S/A/B/C/D)
   매출성장률 + 밸류상승률 + 라운드텀 종합

② 상장사 피어그룹도 성장성 등급으로 분류
   PER + 3개월 주가 모멘텀 기준

③ 동일 성장성 등급 상장사 매칭
   없으면 인접 등급 또는 해외 피어 사용

④ 피어 멀티플 적용
   매출기반: PSR
   기술기반: PER 또는 파이프라인 가치

⑤ 비상장 할인율 적용
   프리IPO 10% / 시리즈C 20% / 시리즈B 30%
   시리즈A 40% / 시드 50%

⑥ 최종 적정 밸류 산출
   현재 VC 밸류와 비교
   → 저평가/적정/고평가/버블 판단

⑦ 섹터 프리미엄 배수 적용 (네이버 금융 자동 수집)
```

---

## 섹터별 피어그룹

| 섹터 | 상장사 |
|---|---|
| 커머스 | 네이버, 카카오, 오아시스, 현대홈쇼핑, GS홈쇼핑 |
| 핀테크 | 카카오뱅크, 카카오페이, 한국금융지주, JB금융, SK증권 |
| 모빌리티 | 현대차, 기아, 현대글로비스, 쏘카, 한국해양진흥 |
| B2B SaaS | 더존비즈온, NHN, 영림원소프트랩, 가비아, 한글과컴퓨터 |
| 엔터 | 하이브, SM, JYP, YG, 키이스트 |
| 바이오 | 삼성바이오로직스, 셀트리온, 유한양행, 한미약품, 보령 |
| 의료기기 | 인바디, 루닛, 뷰웍스, 오스템임플란트, 레이 |
| 뷰티 | 아모레퍼시픽, LG생활건강, 코스맥스, 클리오, 브이티 |
| 딥테크·AI | 한미반도체, HPSP, 리노공업, 레인보우로보틱스, 에스피지 |

---

## 슬래시 커맨드

| 커맨드 | 기능 |
|---|---|
| /run-daily | 오늘 날짜 리포트 전체 생성 |
| /add-company [회사명] | 특정 회사 즉시 리포트 생성 |
| /check-price [회사명] | 비상장 거래가격만 즉시 조회 |

---

## MCP 설정

| MCP | 용도 |
|---|---|
| Puppeteer MCP | 38커뮤니케이션, 증권플러스 크롤링 |
| Fetch MCP | 네이버 API, DART API, KIPRIS API |
| Filesystem MCP | reports/ 폴더 파일 생성·저장 |

---

## 훅 설정

| 훅 | 동작 |
|---|---|
| PostToolUse(Write) | 파일 저장 후 자동 lint |
| PreToolUse(Bash) | rm -rf 등 위험 명령어 차단 |
| Stop | 세션 종료 시 logs/에 기록 |

---

## 완료 현황

```
✅ Part 1: 프로젝트 세팅 (에이전트/훅/MCP/스킬)
✅ Part 2: 수집기 (뉴스/DART/KIPRIS/가격/규제)
✅ Part 3: 분석기 + 리포트 작성기
✅ Part 4: 엑셀 생성 (주차별 누적)
✅ 스케줄러: 매일 오전 10시 자동 실행 등록
✅ API 키: 5개 모두 완료
✅ excel-restructure-v2: 엑셀 3시트 구조 개편
✅ Part A-1: 섹터분류 + 성장성등급 + 피어그룹 매칭
✅ Part A-2: 9개 섹터 매력도 점수 계산 엔진
✅ Part A-3: 리포트 8섹션 + 엑셀 3시트 최종 완성
✅ Part 1/5: 엑셀구조변경 (컬럼삭제/통합/추가, Sheet4 VC밸류히스토리 신설)
✅ Part 2/5: Claude API 프롬프트확장 (밸류+VC+투자형태 동시추출)
✅ Part 2/5: 밸류히스토리 소급검색 (기간제한없음)
✅ Part 2/5: DART 투자자추출 + 발행주식수 + 시총환산
✅ Part 3/5: VC데이터베이스(JSON) 구축 (60개 초기등록)
✅ Part 3/5: 투자자티어 자동분류 (T1/T2/T3/CVC/정책금융)
✅ Part 3/5: 후속투자추적 + 자동태그
✅ Part 3/5: VC포트폴리오 유사기업연결
✅ Part 3/5: 공동투자네트워크 패턴분석
✅ Part 4/5: 밸류변동알림 (VC밸류 변동 포함)
✅ Part 4/5: 동일라운드 크로스체크 시스템
✅ Part 4/5: 회사프로파일 재구성 (12칸→5칸)
✅ Part 4/5: 리포트(.md) 구조 수정
✅ Part 5/5: 매력도점수 새 가감점 반영
✅ Part 5/5: 전체 파이프라인 연결
✅ 신규 수집기: THE VC, 혁신의숲, 넥스트유니콘, VCS, KVCA, 전문매체뉴스
```

---

## 코딩 규칙

- 모든 API 키는 .env에서만 관리
- 에러 시 해당 섹션 "수집 실패 - [이유]" 표시 후 계속 진행
- 크롤링 간격 최소 2초 (봇 차단 방지)
- User-Agent 헤더 필수
- git 커밋은 항상 세 줄로 분리:
  git add .
  git commit -m "메시지"
  git push

---

## 다음 작업 예정

```
[ ] 전체 파이프라인 실데이터 검증
[ ] 리포트 품질 검토 후 프롬프트 개선
[ ] 바이오/의료기기 섹터 임상 데이터 소스 추가
[ ] KIPRIS API 특허 분류 고도화
[ ] THE VC / 혁신의숲 크롤링 차단 시 대체 로직
[ ] VC 데이터베이스 수동 보완 (티어 검증)
[ ] 매력도 점수 새 가감점 밸런스 튜닝
```
