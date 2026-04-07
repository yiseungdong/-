// VC 티어 판단
function getVCTier(investors) {
  const TOP_TIER = ['소프트뱅크', 'imm', '카카오벤처스', '네이버', 'kdb', '한국투자파트너스',
    '스톤브릿지', 'kb인베스트먼트', '한화', 'lg테크놀로지', '삼성벤처',
    'sk', '현대', '알토스', '본드', '세쿼이아', 'softbank'];
  const MID_TIER = ['스파크랩', '블루포인트', '퓨처플레이', '본엔젤스', '캡스톤',
    '매쉬업', '프라이머', '해시드', '디캠프', '롯데', '신한'];

  const names = (investors || []).map(v => v.toLowerCase());
  if (names.some(v => TOP_TIER.some(t => v.includes(t)))) return 4;
  if (names.some(v => MID_TIER.some(t => v.includes(t)))) return 3;
  if (names.length > 0) return 2;
  return 0;
}

function getRoundScore(roundName, maxScore) {
  const r = (roundName || '').toLowerCase();
  if (r.includes('프리ipo') || r.includes('브릿지')) return maxScore;
  if (r.includes('시리즈c') || r.includes('series c')) return Math.round(maxScore * 0.87);
  if (r.includes('시리즈b') || r.includes('series b')) return Math.round(maxScore * 0.67);
  if (r.includes('시리즈a') || r.includes('series a')) return Math.round(maxScore * 0.4);
  if (r.includes('시드') || r.includes('seed') || r.includes('엔젤')) return Math.round(maxScore * 0.2);
  return 0;
}

function getAmountScore(amount, maxScore) {
  if (!amount) return 0;
  const a = parseFloat(amount);
  if (a >= 300) return maxScore;
  if (a >= 100) return Math.round(maxScore * 0.8);
  if (a >= 50) return Math.round(maxScore * 0.6);
  if (a >= 10) return Math.round(maxScore * 0.4);
  return Math.round(maxScore * 0.2);
}

function getValuationGrowthScore(growthStr, maxScore) {
  const g = parseFloat((growthStr || '0').replace('%', '').replace('+', ''));
  if (g < 0) return -Math.round(maxScore * 0.5);
  if (g >= 500) return maxScore;
  if (g >= 200) return Math.round(maxScore * 0.8);
  if (g >= 100) return Math.round(maxScore * 0.6);
  if (g >= 30) return Math.round(maxScore * 0.4);
  return Math.round(maxScore * 0.25);
}

function getRoundSpeedScore(rounds, maxScore) {
  if (!rounds || rounds.length < 2) return Math.round(maxScore * 0.5);
  const latest = new Date(rounds[0].date);
  const prev = new Date(rounds[1].date);
  if (isNaN(latest.getTime()) || isNaN(prev.getTime())) return Math.round(maxScore * 0.5);
  const months = (latest - prev) / (1000 * 60 * 60 * 24 * 30);
  if (months <= 6) return maxScore;
  if (months <= 12) return Math.round(maxScore * 0.67);
  if (months <= 24) return Math.round(maxScore * 0.33);
  return 0;
}

function getLastInvestmentScore(rounds, maxScore) {
  if (!rounds || rounds.length === 0) return 0;
  const lastDate = new Date(rounds[0].date);
  if (isNaN(lastDate.getTime())) return Math.round(maxScore * 0.5); // 날짜 없으면 중간값
  const now = new Date();
  const months = (now - lastDate) / (1000 * 60 * 60 * 24 * 30);
  if (months <= 6) return maxScore;
  if (months <= 12) return Math.round(maxScore * 0.67);
  if (months <= 24) return Math.round(maxScore * 0.33);
  return 0;
}

function getRevenueGrowthScore(growth, maxScore) {
  if (growth === null || growth === undefined) return 0;
  if (growth >= 100) return maxScore;
  if (growth >= 50) return Math.round(maxScore * 0.8);
  if (growth >= 30) return Math.round(maxScore * 0.6);
  if (growth >= 10) return Math.round(maxScore * 0.4);
  if (growth >= 0) return Math.round(maxScore * 0.2);
  return 0;
}

function getPatentScore(count, maxScore) {
  if (count >= 21) return maxScore;
  if (count >= 6) return Math.round(maxScore * 0.6);
  if (count >= 1) return Math.round(maxScore * 0.4);
  return 0;
}

// ─── 섹터별 점수 계산 ───

function scoreCommerce(company) {
  const breakdown = {};
  let total = 0;
  const fin = company.financials?.financials?.[0];
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};

  // A. 기본 재무 지표 (25점)
  const revenue = fin?.revenue || 0;
  breakdown.매출규모 = revenue >= 1000 ? 8 : revenue >= 500 ? 7 : revenue >= 200 ? 5 : revenue >= 50 ? 4 : revenue > 0 ? 2 : 0;
  breakdown.매출성장률 = getRevenueGrowthScore(fin?.revenueGrowth, 10);
  breakdown.흑자여부 = fin?.netIncome > 0 ? 4 : fin?.netIncome === 0 ? 2 : 0;
  breakdown.손익분기시점 = fin?.netIncome > 0 ? 3 : 2;

  // B. 매출 구조 (10점)
  breakdown.반복매출비중 = 3;
  breakdown.고객집중도 = 3;

  // C. VC 투자 관련 (30점)
  breakdown.투자라운드 = getRoundScore(latestRound.roundName, 5);
  breakdown.투자금액 = getAmountScore(latestRound.amount, 4);
  breakdown.밸류상승추이 = getValuationGrowthScore(vc?.valuationGrowth, 4);
  breakdown.참여VC티어 = getVCTier(latestRound.investors);
  breakdown.전략적투자자 = 0;
  breakdown.라운드텀 = getRoundSpeedScore(rounds, 3);
  breakdown.마지막투자경과 = getLastInvestmentScore(rounds, 3);
  breakdown.후속참여 = rounds.length > 1 ? 2 : 0;

  // D. 기술·경쟁력 (15점)
  breakdown.독점기술 = (company.patents?.totalCount || 0) >= 10 ? 4 : 2;
  breakdown.진입장벽 = 2;
  breakdown.수익모델명확성 = revenue > 0 ? 4 : 1;
  breakdown.레퍼런스고객 = 0;

  // E. 시장·성장성 (10점)
  breakdown.시장크기 = 3;
  breakdown.글로벌확장성 = 1;
  breakdown.경쟁구도 = 2;

  // F. 팀·운영 (5점)
  breakdown.창업팀퀄리티 = 2;
  breakdown.창업경과시간 = 1;

  // G. 대외신뢰도 (5점)
  breakdown.계약신뢰도 = 1;
  breakdown.미디어노출 = 1;
  breakdown.대외수상 = 0;

  total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.max(0, Math.min(100, total)), breakdown };
}

function scoreFintech(company) {
  const breakdown = {};
  const fin = company.financials?.financials?.[0];
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const revenue = fin?.revenue || 0;

  // A. 기본 재무 지표 (20점)
  breakdown.매출규모 = getRevenueGrowthScore(revenue, 8);
  breakdown.매출성장률 = getRevenueGrowthScore(fin?.revenueGrowth, 7);
  breakdown.흑자여부 = fin?.netIncome > 0 ? 5 : 0;

  // B. 규제·허가 (20점)
  breakdown.핵심인허가 = 5;
  breakdown.인허가종류 = 3;
  breakdown.규제리스크 = 3;

  // C. 매출 구조 (15점)
  breakdown.수익모델안정성 = revenue > 0 ? 6 : 2;
  breakdown.고객집중도 = 4;
  breakdown.손익분기 = fin?.netIncome > 0 ? 3 : 1;

  // D. VC 투자 관련 (25점)
  breakdown.투자라운드 = getRoundScore(latestRound.roundName, 5);
  breakdown.투자금액 = getAmountScore(latestRound.amount, 4);
  breakdown.참여VC티어 = getVCTier(latestRound.investors);
  breakdown.전략적투자자 = 3;
  breakdown.밸류상승추이 = getValuationGrowthScore(vc?.valuationGrowth, 4);
  breakdown.마지막투자경과 = getLastInvestmentScore(rounds, 3);

  // E. 기술·경쟁력 (10점)
  breakdown.핵심기술 = 2;
  breakdown.진입장벽 = 3;
  breakdown.레퍼런스고객 = 2;

  // F. 시장·성장성 (5점)
  breakdown.시장크기 = 3;
  breakdown.글로벌확장성 = 2;

  // G. 팀·운영 (5점)
  breakdown.창업팀퀄리티 = 3;
  breakdown.창업경과시간 = 2;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.max(0, Math.min(100, total)), breakdown };
}

function scoreMobility(company) {
  const breakdown = {};
  const fin = company.financials?.financials?.[0];
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};

  // A. 기본 재무 지표 (20점)
  breakdown.매출규모 = fin?.revenue >= 1000 ? 7 : fin?.revenue >= 500 ? 6 : fin?.revenue >= 200 ? 4 : 2;
  breakdown.매출성장률 = getRevenueGrowthScore(fin?.revenueGrowth, 8);
  breakdown.흑자여부 = fin?.netIncome > 0 ? 5 : 0;

  // B. 인프라·운영 효율 (20점)
  breakdown.인프라규모 = 5;
  breakdown.운영효율성 = 5;
  breakdown.단위경제성 = 5;

  // C. ESG·정책 수혜 (15점)
  breakdown.친환경전환 = 5;
  breakdown.정부정책수혜 = 3;
  breakdown.탄소중립인증 = 2;

  // D. VC 투자 관련 (25점)
  breakdown.투자라운드 = getRoundScore(latestRound.roundName, 5);
  breakdown.투자금액 = getAmountScore(latestRound.amount, 5);
  breakdown.참여VC티어 = getVCTier(latestRound.investors);
  breakdown.전략적투자자 = 3;
  breakdown.밸류상승추이 = getValuationGrowthScore(vc?.valuationGrowth, 3);
  breakdown.마지막투자경과 = getLastInvestmentScore(rounds, 3);

  // E. 기술·경쟁력 (10점)
  breakdown.핵심기술 = (company.patents?.totalCount || 0) >= 10 ? 5 : 2;
  breakdown.진입장벽 = 3;

  // F. 시장·성장성 (5점)
  breakdown.시장크기 = 3;
  breakdown.글로벌확장성 = 2;

  // G. 팀·운영 (5점)
  breakdown.창업팀퀄리티 = 3;
  breakdown.창업경과시간 = 2;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.max(0, Math.min(100, total)), breakdown };
}

function scoreB2BSaaS(company) {
  const breakdown = {};
  const fin = company.financials?.financials?.[0];
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};

  // A. 반복매출 지표 (25점)
  breakdown.ARR규모 = fin?.revenue >= 100 ? 10 : fin?.revenue >= 50 ? 8 : fin?.revenue >= 20 ? 6 : 3;
  breakdown.NRR순수익유지율 = 6;
  breakdown.고객이탈률 = 5;

  // B. 고객 구조 (20점)
  breakdown.계약고객수 = 4;
  breakdown.고객집중도 = 7;
  breakdown.계약대상신뢰도 = 7;

  // C. 전환비용·진입장벽 (15점)
  breakdown.전환비용 = 6;
  breakdown.독점기술 = getPatentScore(company.patents?.totalCount, 4);
  breakdown.데이터네트워크효과 = 2;

  // D. VC 투자 관련 (20점)
  breakdown.투자라운드 = getRoundScore(latestRound.roundName, 4);
  breakdown.투자금액 = getAmountScore(latestRound.amount, 3);
  breakdown.참여VC티어 = Math.min(getVCTier(latestRound.investors), 4);
  breakdown.전략적투자자 = 3;
  breakdown.밸류상승추이 = getValuationGrowthScore(vc?.valuationGrowth, 3);
  breakdown.마지막투자경과 = getLastInvestmentScore(rounds, 2);

  // E. 글로벌 확장성 (10점)
  breakdown.해외매출비중 = 3;
  breakdown.글로벌계약고객 = 5;

  // F. 팀·운영 (5점)
  breakdown.창업팀퀄리티 = 3;
  breakdown.창업경과시간 = 2;

  // G. 대외신뢰도 (5점)
  breakdown.레퍼런스고객공개 = 3;
  breakdown.미디어노출 = 1;
  breakdown.대외수상 = 1;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.max(0, Math.min(100, total)), breakdown };
}

function scoreEntertainment(company) {
  const breakdown = {};
  const fin = company.financials?.financials?.[0];
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};

  // A. 기본 재무 지표 (15점)
  breakdown.매출규모 = fin?.revenue >= 1000 ? 6 : fin?.revenue >= 500 ? 5 : fin?.revenue >= 200 ? 4 : 2;
  breakdown.매출성장률 = getRevenueGrowthScore(fin?.revenueGrowth, 6);
  breakdown.흑자여부 = fin?.netIncome > 0 ? 3 : 0;

  // B. IP 가치 (25점)
  breakdown.IP보유규모 = 7;
  breakdown.IP확장성 = 8;
  breakdown.IP지식재산권 = 7;

  // C. 팬덤·플랫폼 (20점)
  breakdown.팬덤규모 = 8;
  breakdown.플랫폼채널 = 7;
  breakdown.굿즈MD매출 = 5;

  // D. VC 투자 관련 (20점)
  breakdown.투자라운드 = getRoundScore(latestRound.roundName, 4);
  breakdown.투자금액 = getAmountScore(latestRound.amount, 3);
  breakdown.참여VC티어 = Math.min(getVCTier(latestRound.investors), 4);
  breakdown.전략적투자자 = 5;
  breakdown.밸류상승추이 = getValuationGrowthScore(vc?.valuationGrowth, 2);
  breakdown.마지막투자경과 = getLastInvestmentScore(rounds, 2);

  // E. 글로벌 확장성 (10점)
  breakdown.해외매출비중 = 5;
  breakdown.글로벌수상인정 = 5;

  // F. 팀·운영 (5점)
  breakdown.창업팀퀄리티 = 3;
  breakdown.창업경과시간 = 2;

  // G. 대외신뢰도 (5점)
  breakdown.미디어노출 = 3;
  breakdown.대외수상 = 2;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.max(0, Math.min(100, total)), breakdown };
}

function scoreBio(company) {
  const breakdown = {};
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const patentCount = company.patents?.totalCount || 0;
  const regulations = company.regulations?.regulations || [];

  // A. VC 투자 밸류 등급 (35점)
  breakdown.VC밸류등급 = company.valuation?.undervalueRate <= -30 ? 35
    : company.valuation?.undervalueRate <= 30 ? 25
    : company.valuation?.undervalueRate <= 100 ? 15 : 5;
  breakdown.시장규모보정 = 3;

  // B. 임상 파이프라인 (25점)
  const hasPhase3 = regulations.some(r => r.title?.includes('3상') || r.title?.includes('phase 3'));
  const hasPhase2 = regulations.some(r => r.title?.includes('2상') || r.title?.includes('phase 2'));
  const hasPhase1 = regulations.some(r => r.title?.includes('1상') || r.title?.includes('phase 1'));

  breakdown.최고단계파이프라인 = hasPhase3 ? 15 : hasPhase2 ? 9 : hasPhase1 ? 4 : 1;
  breakdown.파이프라인수 = regulations.length >= 5 ? 10 : regulations.length >= 3 ? 7 : regulations.length >= 2 ? 4 : 2;

  // C. 기술력·특허 (15점)
  breakdown.핵심특허 = getPatentScore(patentCount, 8);
  breakdown.기술독창성 = 5;
  breakdown.기술이전실적 = 0;

  // E. 재무 생존력 (10점)
  breakdown.런웨이추정 = rounds.length > 0 ? 5 : 0;
  breakdown.매출여부 = company.financials?.financials?.[0]?.revenue > 0 ? 3 : 0;

  // F. VC 투자 구조 (10점)
  breakdown.참여VC티어 = Math.min(getVCTier(latestRound.investors), 4);
  breakdown.전략적투자자 = 4;
  breakdown.기존투자자후속 = rounds.length > 1 ? 2 : 0;

  // G. 팀·전문성 (5점)
  breakdown.창업팀퀄리티 = 2;
  breakdown.임상경험 = 1;

  // 가산점 (바이오 특수)
  let bonus = 0;
  const hasFDA = regulations.some(r => r.title?.includes('FDA'));
  const hasGlobal = regulations.some(r => r.title?.includes('글로벌') || r.title?.includes('해외'));
  if (hasFDA) bonus += 5;
  if (hasGlobal) bonus += 3;

  const baseTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const total = Math.max(0, Math.min(115, baseTotal + bonus));
  return { total, breakdown, bonus };
}

function scoreMedicalDevice(company) {
  const breakdown = {};
  const fin = company.financials?.financials?.[0];
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const patentCount = company.patents?.totalCount || 0;
  const regulations = company.regulations?.regulations || [];

  // A. VC 투자 밸류 등급 (30점)
  breakdown.VC밸류등급 = company.valuation?.undervalueRate <= -30 ? 30
    : company.valuation?.undervalueRate <= 30 ? 22
    : company.valuation?.undervalueRate <= 100 ? 14 : 5;

  // B. 인허가·매출 (25점)
  const hasFDA = regulations.some(r => r.title?.includes('FDA') || r.source?.includes('FDA'));
  const hasCE = regulations.some(r => r.title?.includes('CE'));
  const hasKFDA = regulations.some(r => r.source?.includes('식약처'));
  breakdown.인허가현황 = hasFDA ? 15 : hasCE ? 12 : hasKFDA ? 10 : 2;
  breakdown.매출발생여부 = fin?.revenue > 0 ? (fin?.revenue >= 100 ? 10 : 7) : 0;

  // C. 기술력·특허 (20점)
  breakdown.핵심특허 = getPatentScore(patentCount, 8);
  breakdown.기술독창성 = 5;
  breakdown.임상데이터우월성 = 5;

  // D. 시장·영업력 (10점)
  breakdown.유통망영업네트워크 = 3;
  breakdown.병원레퍼런스 = 5;

  // E. VC 투자 구조 (10점)
  breakdown.참여VC티어 = Math.min(getVCTier(latestRound.investors), 4);
  breakdown.전략적투자자 = 4;
  breakdown.기존투자자후속 = rounds.length > 1 ? 2 : 0;

  // F. 재무 생존력 (5점)
  breakdown.런웨이추정 = rounds.length > 0 ? 3 : 0;
  breakdown.수익성 = fin?.netIncome > 0 ? 2 : 0;

  // 가산점
  let bonus = 0;
  if (hasFDA) bonus += 4;
  if (hasCE) bonus += 3;
  const hasCES = company.source?.includes('CES') || company.reason?.includes('CES');
  if (hasCES) bonus += 3;

  const baseTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.max(0, Math.min(115, baseTotal + bonus)), breakdown, bonus };
}

function scoreBeauty(company) {
  const breakdown = {};
  const fin = company.financials?.financials?.[0];
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};

  // A. 브랜드·매출 (30점)
  breakdown.매출규모 = fin?.revenue >= 1000 ? 10 : fin?.revenue >= 500 ? 8 : fin?.revenue >= 200 ? 6 : 3;
  breakdown.매출성장률 = getRevenueGrowthScore(fin?.revenueGrowth, 10);
  breakdown.브랜드인지도 = 5;

  // B. 글로벌 수출 (20점)
  breakdown.해외매출비중 = 5;
  breakdown.진출국가채널 = 8;

  // C. 제품·성분 경쟁력 (15점)
  breakdown.독자성분기술 = getPatentScore(company.patents?.totalCount, 7);
  breakdown.인증수상 = 5;
  breakdown.제품라인업 = 3;

  // D. VC 투자 밸류 등급 (15점)
  breakdown.VC밸류등급 = company.valuation?.undervalueRate <= -30 ? 15
    : company.valuation?.undervalueRate <= 30 ? 10
    : company.valuation?.undervalueRate <= 100 ? 6 : 2;

  // E. VC 투자 구조 (10점)
  breakdown.투자라운드 = getRoundScore(latestRound.roundName, 3);
  breakdown.참여VC티어 = Math.min(getVCTier(latestRound.investors), 3);
  breakdown.전략적투자자 = 4;

  // F. 디지털·커머스 역량 (5점)
  breakdown.SNS인플루언서 = 3;
  breakdown.자사몰D2C = 2;

  // G. 팀·운영 (5점)
  breakdown.창업팀퀄리티 = 3;
  breakdown.창업경과시간 = 2;

  // 가산점
  let bonus = 0;
  const hasSephora = company.source?.includes('세포라') || company.reason?.includes('세포라');
  if (hasSephora) bonus += 5;

  const baseTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.max(0, Math.min(115, baseTotal + bonus)), breakdown, bonus };
}

function scoreDeepTech(company) {
  const breakdown = {};
  const fin = company.financials?.financials?.[0];
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const patentCount = company.patents?.totalCount || 0;

  // A. 기술력·데이터 (30점)
  breakdown.핵심기술수준 = patentCount >= 20 ? 12 : patentCount >= 10 ? 9 : patentCount >= 5 ? 6 : 3;
  breakdown.데이터자산 = 8;
  breakdown.SCI논문 = patentCount >= 10 ? 4 : 2;
  breakdown.핵심AI특허 = getPatentScore(patentCount, 4);

  // B. VC 투자 밸류 등급 (25점)
  breakdown.VC밸류등급 = company.valuation?.undervalueRate <= -30 ? 25
    : company.valuation?.undervalueRate <= 30 ? 18
    : company.valuation?.undervalueRate <= 100 ? 10 : 3;

  // C. 고객·매출 구조 (20점)
  breakdown.고객퀄리티 = 8;
  breakdown.매출구조 = fin?.revenue > 0 ? 10 : 3;

  // D. 진입장벽 (15점)
  breakdown.기술재현불가능성 = 7;
  breakdown.네트워크데이터효과 = 5;
  breakdown.전환비용 = 3;

  // E. VC 투자 구조 (10점)
  breakdown.참여VC티어 = Math.min(getVCTier(latestRound.investors), 4);
  breakdown.전략적투자자 = 4;
  breakdown.기존투자자후속 = rounds.length > 1 ? 2 : 0;

  // F. 팀·연구역량 (5점)
  breakdown.창업팀퀄리티 = 3;
  breakdown.연구역량 = 2;

  // 가산점
  let bonus = 0;
  const hasNvidia = company.source?.includes('엔비디아') || company.reason?.includes('엔비디아');
  const hasGoogle = company.source?.includes('구글') || company.reason?.includes('구글');
  if (hasNvidia || hasGoogle) bonus += 5;

  const baseTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.max(0, Math.min(115, baseTotal + bonus)), breakdown, bonus };
}

// ─── 메인 점수 계산 ───

async function calculateScore(company) {
  try {
    const sectorCode = company.sectorCode;
    let scoreResult;

    switch (sectorCode) {
      case 'COMMERCE':       scoreResult = scoreCommerce(company); break;
      case 'FINTECH':        scoreResult = scoreFintech(company); break;
      case 'MOBILITY':       scoreResult = scoreMobility(company); break;
      case 'B2B_SAAS':       scoreResult = scoreB2BSaaS(company); break;
      case 'ENTERTAINMENT':  scoreResult = scoreEntertainment(company); break;
      case 'BIO':            scoreResult = scoreBio(company); break;
      case 'MEDICAL_DEVICE': scoreResult = scoreMedicalDevice(company); break;
      case 'BEAUTY':         scoreResult = scoreBeauty(company); break;
      case 'DEEPTECH':       scoreResult = scoreDeepTech(company); break;
      default:               scoreResult = scoreCommerce(company); break;
    }

    // rawScore를 100점으로 cap 후 섹터 프리미엄 적용
    const sectorPremium = company.peerGroup?.sectorPremium || 1.0;
    const rawScore = scoreResult.total;
    const cappedRaw = Math.min(100, rawScore);
    const premiumScore = cappedRaw * sectorPremium;

    // 10점 만점 환산 (프리미엄 적용 후 최대 13점 → 10점 cap)
    const finalScore = Math.round((premiumScore / 100) * 10 * 10) / 10;
    const cappedScore = Math.min(10, Math.max(0, finalScore));

    // 점수 세부내역 문자열 생성
    const breakdownStr = Object.entries(scoreResult.breakdown)
      .map(([k, v]) => `${k}:${v}`)
      .join(' | ');

    return {
      score: cappedScore,
      rawScore,
      sectorPremium,
      premiumScore: Math.round(premiumScore),
      breakdown: scoreResult.breakdown,
      breakdownStr,
      bonus: scoreResult.bonus || 0
    };
  } catch (err) {
    console.error('[scoreEngine] 점수 계산 실패:', err.message);
    return { score: 0, rawScore: 0, sectorPremium: 1.0, premiumScore: 0, breakdown: {}, breakdownStr: '', bonus: 0 };
  }
}

module.exports = { calculateScore };
