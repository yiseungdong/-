const fs = require('fs');
const path = require('path');

// vc-database.json에서 티어 목록 동적 로드
function loadVCTiers() {
  try {
    const dbPath = path.join(__dirname, '..', 'public', 'data', 'vc-database.json');
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const t1Names = db.vcList
      .filter(v => v.tier === 'T1')
      .flatMap(v => [v.name, ...(v.aliases || [])])
      .map(n => n.toLowerCase());
    const t2Names = db.vcList
      .filter(v => v.tier === 'T2')
      .flatMap(v => [v.name, ...(v.aliases || [])])
      .map(n => n.toLowerCase());
    return { t1Names, t2Names };
  } catch (err) {
    console.error('[scoreEngine] vc-database.json 로드 실패, 기본값 사용:', err.message);
    return {
      t1Names: ['소프트뱅크', 'imm', '한국투자파트너스', 'kb인베스트먼트', '알토스'],
      t2Names: ['스파크랩', '블루포인트', '퓨처플레이', '본엔젤스']
    };
  }
}

// 캐싱 (매번 파일 읽기 방지)
let _vcTiers = null;
function getVCTiers() {
  if (!_vcTiers) _vcTiers = loadVCTiers();
  return _vcTiers;
}

// VC 티어 판단
function getVCTier(investors) {
  const { t1Names, t2Names } = getVCTiers();
  const names = (investors || []).map(v => v.toLowerCase());
  if (names.some(v => t1Names.some(t => v.includes(t)))) return 4;
  if (names.some(v => t2Names.some(t => v.includes(t)))) return 3;
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

/**
 * 데이터 상황별 100점 환산 함수 (전 섹터 공통)
 *
 * 우선순위:
 * 1순위: VC 투자 데이터
 * 2순위: DART 기반 재무 데이터
 *
 * 처리 방식:
 * - VC + DART 둘 다 없음 → 점수 미정 (null 반환)
 * - VC만 있음 → 없는 항목 0점, VC 점수 비례로 채워서 100점 환산
 * - VC + DART 둘 다 있음 → 없는 항목 0점, VC+DART 점수 비례로 채워서 100점 환산
 * - DART만 있음 → 없는 항목 0점, DART 점수 비례로 채워서 100점 환산
 *
 * @param {Object} breakdown - 항목별 점수 객체 (null = 데이터 없음)
 * @param {Object} maxScores - 항목별 최대 배점 객체
 * @param {Object} dataFlags - { hasVC: bool, hasDart: bool }
 * @param {Object} vcKeys - VC 관련 항목 키 배열
 * @param {Object} dartKeys - DART 관련 항목 키 배열
 * @returns {{ total: number|null, breakdown: Object, dataStatus: string }}
 */
function normalizeScore(breakdown, maxScores, dataFlags, vcKeys, dartKeys) {
  const { hasVC, hasDart } = dataFlags;

  // VC도 DART도 없으면 미정
  if (!hasVC && !hasDart) {
    return { total: null, breakdown, dataStatus: '데이터부족' };
  }

  // 각 항목 점수 계산
  let totalScore = 0;        // 실제 획득 점수 합계
  let totalMaxAvail = 0;     // 데이터 있는 항목의 최대 배점 합계
  let totalMaxAll = 0;       // 전체 최대 배점 합계
  let vcScore = 0;           // VC 항목 획득 점수
  let vcMax = 0;             // VC 항목 최대 배점
  let dartScore = 0;         // DART 항목 획득 점수
  let dartMax = 0;           // DART 항목 최대 배점

  for (const [key, maxVal] of Object.entries(maxScores)) {
    totalMaxAll += Math.abs(maxVal);
    const score = breakdown[key];

    if (score !== null && score !== undefined) {
      totalScore += score;
      totalMaxAvail += Math.abs(maxVal);

      if (vcKeys.includes(key)) {
        vcScore += score;
        vcMax += Math.abs(maxVal);
      }
      if (dartKeys.includes(key)) {
        dartScore += score;
        dartMax += Math.abs(maxVal);
      }
    }
  }

  // 없는 항목 배점 = 전체 최대 - 데이터 있는 항목 최대
  const missingMax = totalMaxAll - totalMaxAvail;

  // 비례 보정 점수 계산
  let filledScore = totalScore;

  if (missingMax > 0) {
    if (hasVC && hasDart) {
      // VC + DART 비례로 채움
      const vcDartTotal = vcScore + dartScore;
      const vcDartMax = vcMax + dartMax;
      const fillRate = vcDartMax > 0 ? vcDartTotal / vcDartMax : 0;
      filledScore = totalScore + (missingMax * fillRate);
    } else if (hasVC) {
      // VC 비례로 채움
      const fillRate = vcMax > 0 ? vcScore / vcMax : 0;
      filledScore = totalScore + (missingMax * fillRate);
    } else if (hasDart) {
      // DART 비례로 채움
      const fillRate = dartMax > 0 ? dartScore / dartMax : 0;
      filledScore = totalScore + (missingMax * fillRate);
    }
  }

  // 100점 환산
  const normalized = totalMaxAll > 0
    ? Math.round((filledScore / totalMaxAll) * 100 * 10) / 10
    : 0;

  const dataStatus = hasVC && hasDart ? 'VC+DART'
    : hasVC ? 'VC만'
    : 'DART만';

  return {
    total: Math.max(-20, Math.min(100, normalized)),
    breakdown,
    dataStatus,
  };
}

// ─── 섹터별 점수 계산 ───

function scoreCommerce(company) {
  const breakdown = {};
  const allFin = company.financials?.financials || [];
  const fin = allFin.length > 0 ? allFin[allFin.length - 1] : null; // 가장 최근
  const prevFin = allFin.length >= 2 ? allFin[allFin.length - 2] : null;
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};

  // 데이터 보유 여부 판단
  const hasVC = rounds.length > 0;
  const hasDart = allFin.length > 0;

  // ── A. 기본 재무 ──

  // 매출규모 (최대 12점)
  if (!hasDart || fin?.revenue === null || fin?.revenue === undefined) {
    breakdown.매출규모 = null;
  } else {
    const r = fin.revenue;
    breakdown.매출규모 = r >= 500000000000 ? 12
      : r >= 200000000000 ? 8
      : r >= 100000000000 ? 6
      : r >= 50000000000  ? 4
      : r > 0             ? 2
      : 0;
  }

  // 매출성장률 (최대 10점) — 3개년 CAGR, 2개년 전년대비, 1개년 절대값
  if (!hasDart) {
    breakdown.매출성장률 = null;
  } else if (allFin.length >= 3) {
    const oldest = allFin[0].revenue || 0;
    const newest = allFin[allFin.length - 1].revenue || 0;
    const yrs = allFin.length - 1;
    const cagr = oldest > 0 ? (Math.pow(newest / oldest, 1 / yrs) - 1) * 100 : null;
    if (cagr === null) breakdown.매출성장률 = null;
    else if (cagr >= 100) breakdown.매출성장률 = 6;
    else if (cagr >= 70)  breakdown.매출성장률 = 5;
    else if (cagr >= 50)  breakdown.매출성장률 = 4;
    else if (cagr >= 30)  breakdown.매출성장률 = 3;
    else if (cagr >= 20)  breakdown.매출성장률 = 2;
    else if (cagr >= 10)  breakdown.매출성장률 = 1;
    else if (cagr >= 0)   breakdown.매출성장률 = 0;
    else breakdown.매출성장률 = Math.max(-6, Math.round(cagr / 10));
  } else if (allFin.length === 2) {
    const prev = allFin[0].revenue || 0;
    const curr = allFin[1].revenue || 0;
    const g = prev > 0 ? ((curr - prev) / prev) * 100 : null;
    if (g === null) breakdown.매출성장률 = null;
    else if (g >= 100) breakdown.매출성장률 = 6;
    else if (g >= 70)  breakdown.매출성장률 = 5;
    else if (g >= 50)  breakdown.매출성장률 = 4;
    else if (g >= 30)  breakdown.매출성장률 = 3;
    else if (g >= 20)  breakdown.매출성장률 = 2;
    else if (g >= 10)  breakdown.매출성장률 = 1;
    else if (g >= 0)   breakdown.매출성장률 = 0;
    else breakdown.매출성장률 = Math.max(-6, Math.round(g / 10));
  } else {
    // 1개년 — 절대값 기준
    const r = allFin[0].revenue || 0;
    breakdown.매출성장률 = r >= 500000000000 ? 6
      : r >= 200000000000 ? 4
      : r >= 50000000000  ? 2
      : r > 0             ? 1
      : 0;
  }

  // 영업이익률 (최대 5점, 감점 있음)
  if (!hasDart || fin?.operatingProfit === null || fin?.operatingProfit === undefined || !fin?.revenue) {
    breakdown.영업이익률 = null;
  } else {
    const margin = fin.revenue > 0 ? (fin.operatingProfit / fin.revenue) * 100 : null;
    if (margin === null) breakdown.영업이익률 = null;
    else if (margin >= 20)  breakdown.영업이익률 = 5;
    else if (margin >= 10)  breakdown.영업이익률 = 3;
    else if (margin >= 5)   breakdown.영업이익률 = 1;
    else if (margin >= 0)   breakdown.영업이익률 = 0;
    else if (margin >= -10) breakdown.영업이익률 = -1;
    else if (margin >= -20) breakdown.영업이익률 = -2;
    else                    breakdown.영업이익률 = -3;
  }

  // 매출채권 (매출액 대비 비율, 최대 2점, 감점 있음)
  if (!hasDart || !fin?.receivables || !fin?.revenue) {
    breakdown.매출채권 = null;
  } else {
    const ratio = (fin.receivables / fin.revenue) * 100;
    breakdown.매출채권 = ratio <= 30 ? 2
      : ratio <= 50 ? 1
      : ratio <= 70 ? 0
      : -2;
  }

  // ── C. VC 투자 ──

  // 투자라운드 (최대 5점) — 기존 그대로
  breakdown.투자라운드 = hasVC ? getRoundScore(latestRound.roundName, 5) : null;

  // 밸류상승추이 — 절대 밸류에이션 기준 (최대 6점)
  if (!hasVC) {
    breakdown.밸류상승추이 = null;
  } else {
    const val = parseFloat(latestRound.valuation) || 0;
    breakdown.밸류상승추이 = val >= 300000000000 ? 6
      : val >= 200000000000 ? 5
      : val >= 100000000000 ? 4
      : val >= 50000000000  ? 3
      : val >= 10000000000  ? 2
      : val >= 5000000000   ? 1
      : 0;
  }

  // 참여VC티어 (최대 4점) — 기존 그대로
  breakdown.참여VC티어 = hasVC ? getVCTier(latestRound.investors) : null;

  // 라운드텀 (최대 5점) — 기존 그대로
  breakdown.라운드텀 = hasVC ? getRoundSpeedScore(rounds, 5) : null;

  // 투자금액 상승 — 전라운드 대비 (최대 5점, 별도 항목)
  if (!hasVC || rounds.length < 2) {
    breakdown.투자금액상승 = hasVC ? 0 : null; // VC 있지만 전라운드 없으면 0점
  } else {
    const curr = parseFloat(rounds[0].amount) || 0;
    const prev = parseFloat(rounds[1].amount) || 0;
    const diff = curr - prev;
    breakdown.투자금액상승 = diff >= 100000000000 ? 5
      : diff >= 50000000000  ? 4
      : diff >= 30000000000  ? 3
      : diff >= 10000000000  ? 2
      : diff >= 5000000000   ? 1
      : 0;
  }

  // 라운드별 투자금액 — 최고 라운드 1개만 적용 (최대 15점)
  if (!hasVC) {
    breakdown.라운드별투자금액 = null;
  } else {
    let bestLevel = 99;
    let bestScore = 0;

    for (const round of rounds) {
      const rn = (round.roundName || '').toLowerCase();
      const amt = parseFloat(round.amount) || 0;
      let level = 99;
      let score = 0;

      if (rn.includes('프리ipo') || rn.includes('pre-ipo') || rn.includes('브릿지')) {
        level = 1;
        score = amt >= 300000000000 ? 15 : amt >= 200000000000 ? 12 : amt >= 100000000000 ? 10 : amt >= 50000000000 ? 8 : amt >= 10000000000 ? 6 : amt >= 5000000000 ? 4 : 0;
      } else if (rn.includes('시리즈c') || rn.includes('series c')) {
        level = 2;
        score = amt >= 200000000000 ? 15 : amt >= 150000000000 ? 12 : amt >= 100000000000 ? 11 : amt >= 50000000000 ? 9 : amt >= 20000000000 ? 7 : amt >= 10000000000 ? 6 : amt >= 5000000000 ? 3 : 0;
      } else if (rn.includes('시리즈b') || rn.includes('series b')) {
        level = 3;
        score = amt >= 100000000000 ? 15 : amt >= 80000000000 ? 12 : amt >= 50000000000 ? 11 : amt >= 30000000000 ? 9 : amt >= 10000000000 ? 7 : amt >= 5000000000 ? 6 : amt >= 2000000000 ? 4 : 0;
      } else if (rn.includes('시리즈a') || rn.includes('series a')) {
        level = 4;
        score = amt >= 80000000000 ? 12 : amt >= 50000000000 ? 10 : amt >= 30000000000 ? 9 : amt >= 10000000000 ? 8 : amt >= 5000000000 ? 6 : amt >= 2000000000 ? 4 : amt >= 1000000000 ? 3 : 0;
      } else if (rn.includes('시드') || rn.includes('seed') || rn.includes('엔젤')) {
        level = 5;
        score = amt >= 10000000000 ? 10 : amt >= 8000000000 ? 9 : amt >= 6000000000 ? 8 : amt >= 4000000000 ? 6 : amt >= 2000000000 ? 4 : amt >= 1000000000 ? 3 : amt >= 500000000 ? 2 : 0;
      }

      if (level < bestLevel) {
        bestLevel = level;
        bestScore = score;
      }
    }
    breakdown.라운드별투자금액 = bestScore;
  }

  // 후속참여 (최대 5점)
  breakdown.후속참여 = hasVC
    ? (rounds.length >= 3 ? 5 : rounds.length >= 2 ? 3 : 2)
    : null;

  // ── D. 기술·경쟁력 ──

  // 독점기술 — 특허수 기준 (최대 4점)
  const patentCount = company.patents?.totalCount || 0;
  breakdown.독점기술 = patentCount >= 5 ? 4 : patentCount >= 3 ? 3 : patentCount >= 1 ? 2.5 : 2;

  // 유저수 (최대 4점)
  const userCount = company.userCount || null;
  breakdown.유저수 = userCount === null ? null
    : userCount >= 5000000 ? 4
    : userCount >= 3000000 ? 3
    : userCount >= 1000000 ? 2
    : userCount >= 500000  ? 1
    : 0;

  // ── E. 시장·성장성 ──

  // 시장크기 — Claude AI 섹터 분석 기반 (최대 3점)
  const sectorName = company.sectorName || company.industry || '';
  const largeTAM = ['이커머스', '커머스', '리테일', '플랫폼'];
  breakdown.시장크기 = largeTAM.some(k => sectorName.includes(k)) ? 3 : 2;

  // 경쟁구도 — Claude AI marketCompetition 기반 (최대 2점)
  const competition = company.profile?.marketCompetition || '';
  breakdown.경쟁구도 = competition.length > 50 ? 2 : competition.length > 0 ? 1 : 0;

  // ── F. 팀·운영 (통합) ──

  // 창업팀퀄리티 + 창업경과시간 → 설립일 기준 통합 (최대 3점)
  const estDate = company.financials?.establishedDate || null;
  if (!estDate) {
    breakdown.팀운영 = null;
  } else {
    const estYear = parseInt(String(estDate).slice(0, 4));
    const elapsed = new Date().getFullYear() - estYear;
    breakdown.팀운영 = elapsed >= 7 ? 3
      : elapsed >= 5 ? 2
      : elapsed >= 3 ? 2
      : elapsed >= 1 ? 1
      : 0;
  }

  // ── G. 대외신뢰도 (통합) ──

  // 계약신뢰도 + 미디어노출 + 대외수상 → 뉴스 수집 기반 통합 (최대 3점)
  const newsCount = company.newsCount || 0;
  breakdown.미디어노출 = newsCount >= 5 ? 3 : newsCount >= 2 ? 2 : newsCount >= 1 ? 1 : 0;

  // ── 주요주주 ──
  const shareholders = company.financials?.shareholders || [];
  const majorHolder = shareholders.find(s => s.relation?.includes('최대주주') || s.relation?.includes('본인'));
  const instHolder = shareholders.find(s => s.relation?.includes('기관'));

  breakdown.대주주지분율 = !majorHolder ? null
    : majorHolder.ratio >= 50 ? 5
    : majorHolder.ratio >= 40 ? 4
    : majorHolder.ratio >= 30 ? 3
    : majorHolder.ratio >= 20 ? 2
    : 1;

  breakdown.기관주주지분율 = !instHolder ? null
    : instHolder.ratio >= 30 ? 5
    : instHolder.ratio >= 20 ? 4
    : instHolder.ratio >= 10 ? 3
    : instHolder.ratio >= 5  ? 2
    : 1;

  const otherRatio = majorHolder ? (100 - (majorHolder.ratio || 0)) : null;
  breakdown.기타주주지분율 = otherRatio === null ? null
    : otherRatio <= 10 ? 5
    : otherRatio <= 20 ? 4
    : otherRatio <= 30 ? 3
    : otherRatio <= 40 ? 1
    : -2;

  // ── 부채비율 ──
  const debtRatio = fin?.debtRatio || null;
  const prevDebtRatio = prevFin?.debtRatio || null;

  breakdown.부채비율절대 = debtRatio === null ? null
    : debtRatio <= 20 ? 5
    : debtRatio <= 30 ? 4
    : debtRatio <= 40 ? 3
    : debtRatio <= 50 ? 2
    : debtRatio <= 70 ? 1
    : -2;

  if (debtRatio !== null && prevDebtRatio !== null) {
    const dc = ((debtRatio - prevDebtRatio) / prevDebtRatio) * 100;
    breakdown.부채비율변화 = dc < 0
      ? (dc <= -70 ? 5 : dc <= -50 ? 4 : dc <= -40 ? 3 : dc <= -30 ? 2.5 : dc <= -20 ? 2 : 1.5)
      : (dc >= 70 ? -5 : dc >= 50 ? -4 : dc >= 40 ? -3 : dc >= 30 ? -2.5 : dc >= 20 ? -2 : -1.5);
  } else {
    breakdown.부채비율변화 = null;
  }

  // ── 현금흐름 ──
  const cashFlows = company.financials?.cashFlows || [];
  const latestCF = cashFlows.length > 0 ? cashFlows[cashFlows.length - 1] : null;
  const prevCF = cashFlows.length >= 2 ? cashFlows[cashFlows.length - 2] : null;

  breakdown.기말현금 = !latestCF?.cashAndEquivalents ? null
    : latestCF.cashAndEquivalents >= 100000000000 ? 5
    : latestCF.cashAndEquivalents >= 70000000000  ? 4
    : latestCF.cashAndEquivalents >= 50000000000  ? 3
    : latestCF.cashAndEquivalents >= 20000000000  ? 2.5
    : latestCF.cashAndEquivalents >= 10000000000  ? 2
    : latestCF.cashAndEquivalents >= 5000000000   ? 1
    : 0;

  if (latestCF?.cashAndEquivalents && prevCF?.cashAndEquivalents) {
    const diff = latestCF.cashAndEquivalents - prevCF.cashAndEquivalents;
    breakdown.현금흐름변화 = diff >= 0
      ? (diff >= 100000000000 ? 5 : diff >= 70000000000 ? 4 : diff >= 50000000000 ? 3 : diff >= 20000000000 ? 2.5 : diff >= 10000000000 ? 2 : 1)
      : (diff <= -100000000000 ? -5 : diff <= -70000000000 ? -4 : diff <= -50000000000 ? -3 : diff <= -20000000000 ? -2.5 : diff <= -10000000000 ? -2 : -1);
  } else {
    breakdown.현금흐름변화 = null;
  }

  // ── 최대 배점 정의 ──
  const maxScores = {
    // DART 기반
    매출규모: 12, 매출성장률: 10, 영업이익률: 5, 매출채권: 2,
    부채비율절대: 5, 부채비율변화: 5,
    기말현금: 5, 현금흐름변화: 5,
    대주주지분율: 5, 기관주주지분율: 5, 기타주주지분율: 5,
    팀운영: 3,
    // VC 기반
    투자라운드: 5, 밸류상승추이: 6, 참여VC티어: 4, 라운드텀: 5,
    투자금액상승: 5, 라운드별투자금액: 15, 후속참여: 5,
    // 기타 (항상 계산)
    독점기술: 4, 유저수: 4, 시장크기: 3, 경쟁구도: 2, 미디어노출: 3,
  };

  const vcKeys = ['투자라운드', '밸류상승추이', '참여VC티어', '라운드텀', '투자금액상승', '라운드별투자금액', '후속참여'];
  const dartKeys = ['매출규모', '매출성장률', '영업이익률', '매출채권', '부채비율절대', '부채비율변화', '기말현금', '현금흐름변화', '대주주지분율', '기관주주지분율', '기타주주지분율', '팀운영'];

  return normalizeScore(breakdown, maxScores, { hasVC, hasDart }, vcKeys, dartKeys);
}

function scoreFintech(company) {
  const breakdown = {};
  const allFin = company.financials?.financials || [];
  const fin = allFin.length > 0 ? allFin[allFin.length - 1] : null;
  const prevFin = allFin.length >= 2 ? allFin[allFin.length - 2] : null;
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const regulations = company.regulations?.regulations || [];
  const shareholders = company.financials?.shareholders || [];
  const cashFlows = company.financials?.cashFlows || [];

  const hasVC = rounds.length > 0;
  const hasDart = allFin.length > 0;

  // ── A. 기본 재무 ──

  // 매출규모 (최대 15점)
  if (!hasDart || fin?.revenue === null || fin?.revenue === undefined) {
    breakdown.매출규모 = null;
  } else {
    const r = fin.revenue;
    breakdown.매출규모 = r >= 500000000000 ? 15
      : r >= 200000000000 ? 12
      : r >= 100000000000 ? 9
      : r >= 50000000000  ? 6
      : r > 0             ? 3
      : 0;
  }

  // 매출성장률 (최대 15점) — 3개년 CAGR, 2개년 전년대비, 1개년 절대값
  if (!hasDart) {
    breakdown.매출성장률 = null;
  } else if (allFin.length >= 3) {
    const oldest = allFin[0].revenue || 0;
    const newest = allFin[allFin.length - 1].revenue || 0;
    const yrs = allFin.length - 1;
    const cagr = oldest > 0 ? (Math.pow(newest / oldest, 1 / yrs) - 1) * 100 : null;
    if (cagr === null) breakdown.매출성장률 = null;
    else if (cagr >= 100) breakdown.매출성장률 = 15;
    else if (cagr >= 70)  breakdown.매출성장률 = 12;
    else if (cagr >= 50)  breakdown.매출성장률 = 10;
    else if (cagr >= 30)  breakdown.매출성장률 = 8;
    else if (cagr >= 20)  breakdown.매출성장률 = 6;
    else if (cagr >= 10)  breakdown.매출성장률 = 4;
    else if (cagr >= 0)   breakdown.매출성장률 = 0;
    else breakdown.매출성장률 = Math.max(-10, Math.round(cagr / 10));
  } else if (allFin.length === 2) {
    const prev = allFin[0].revenue || 0;
    const curr = allFin[1].revenue || 0;
    const g = prev > 0 ? ((curr - prev) / prev) * 100 : null;
    if (g === null) breakdown.매출성장률 = null;
    else if (g >= 100) breakdown.매출성장률 = 15;
    else if (g >= 70)  breakdown.매출성장률 = 12;
    else if (g >= 50)  breakdown.매출성장률 = 10;
    else if (g >= 30)  breakdown.매출성장률 = 8;
    else if (g >= 20)  breakdown.매출성장률 = 6;
    else if (g >= 10)  breakdown.매출성장률 = 4;
    else if (g >= 0)   breakdown.매출성장률 = 0;
    else breakdown.매출성장률 = Math.max(-10, Math.round(g / 10));
  } else {
    const r = allFin[0].revenue || 0;
    breakdown.매출성장률 = r >= 500000000000 ? 15
      : r >= 200000000000 ? 12
      : r >= 50000000000  ? 8
      : r > 0             ? 4
      : 0;
  }

  // 영업이익률 (최대 5점, 감점 있음)
  if (!hasDart || fin?.operatingProfit === null || fin?.operatingProfit === undefined || !fin?.revenue) {
    breakdown.영업이익률 = null;
  } else {
    const margin = fin.revenue > 0 ? (fin.operatingProfit / fin.revenue) * 100 : null;
    if (margin === null) breakdown.영업이익률 = null;
    else if (margin >= 20)  breakdown.영업이익률 = 5;
    else if (margin >= 10)  breakdown.영업이익률 = 3;
    else if (margin >= 5)   breakdown.영업이익률 = 1;
    else if (margin >= 0)   breakdown.영업이익률 = 0;
    else if (margin >= -10) breakdown.영업이익률 = -1;
    else if (margin >= -20) breakdown.영업이익률 = -2;
    else                    breakdown.영업이익률 = -3;
  }

  // ── B. 규제·허가 ──

  // 인허가등급 (최대 10점)
  const hasRegulation = regulations.length > 0;
  if (!hasRegulation) {
    breakdown.인허가등급 = null;
  } else {
    const regText = regulations.map(r => r.title || '').join(' ').toLowerCase();
    breakdown.인허가등급 = regText.includes('은행') || regText.includes('종합금융') ? 10
      : regText.includes('증권') || regText.includes('보험') ? 8
      : regText.includes('전자금융') || regText.includes('전자지급') ? 6
      : regText.includes('대부') || regText.includes('p2p') ? 4
      : 0;
  }

  // 인허가수 (최대 5점)
  breakdown.인허가수 = !hasRegulation ? null
    : regulations.length >= 3 ? 5
    : regulations.length >= 2 ? 3
    : regulations.length >= 1 ? 2
    : 0;

  // 규제리스크 (최대 5점, 감점 있음)
  if (!hasRegulation) {
    breakdown.규제리스크 = null;
  } else {
    const regText = regulations.map(r => r.title || '').join(' ');
    const hasStop = regText.includes('영업정지') || regText.includes('인가취소');
    const hasFine = regText.includes('과태료') || regText.includes('과징금');
    const hasWarn = regText.includes('경고') || regText.includes('주의');
    breakdown.규제리스크 = hasStop ? -3 : hasFine ? 1 : hasWarn ? 3 : 5;
  }

  // ── C. 매출 구조 ──

  // 수익모델안정성 (최대 8점)
  if (!hasDart || fin?.revenue === null || fin?.revenue === undefined) {
    breakdown.수익모델안정성 = null;
  } else {
    const r = fin.revenue;
    breakdown.수익모델안정성 = r >= 100000000000 ? 8
      : r >= 50000000000  ? 6
      : r >= 20000000000  ? 4
      : r >= 5000000000   ? 2
      : r > 0             ? 1
      : 0;
  }

  // 매출채권회전율 (최대 4점, 감점 있음)
  if (!hasDart || !fin?.receivables || !fin?.revenue) {
    breakdown.매출채권회전율 = null;
  } else {
    const ratio = (fin.receivables / fin.revenue) * 100;
    breakdown.매출채권회전율 = ratio <= 30 ? 4
      : ratio <= 50 ? 2
      : ratio <= 70 ? 0
      : -2;
  }

  // ── D. VC 투자 (커머스 동일) ──

  breakdown.투자라운드 = hasVC ? getRoundScore(latestRound.roundName, 5) : null;

  const val = parseFloat(latestRound.valuation) || 0;
  breakdown.밸류상승추이 = !hasVC ? null
    : val >= 300000000000 ? 6 : val >= 200000000000 ? 5 : val >= 100000000000 ? 4
    : val >= 50000000000  ? 3 : val >= 10000000000  ? 2 : val >= 5000000000 ? 1 : 0;

  breakdown.참여VC티어 = hasVC ? getVCTier(latestRound.investors) : null;
  breakdown.라운드텀 = hasVC ? getRoundSpeedScore(rounds, 5) : null;

  if (!hasVC || rounds.length < 2) {
    breakdown.투자금액상승 = hasVC ? 0 : null;
  } else {
    const curr = parseFloat(rounds[0].amount) || 0;
    const prev = parseFloat(rounds[1].amount) || 0;
    const diff = curr - prev;
    breakdown.투자금액상승 = diff >= 100000000000 ? 5 : diff >= 50000000000 ? 4
      : diff >= 30000000000 ? 3 : diff >= 10000000000 ? 2 : diff >= 5000000000 ? 1 : 0;
  }

  // 라운드별 투자금액 — 최고 라운드 1개만
  if (!hasVC) {
    breakdown.라운드별투자금액 = null;
  } else {
    let bestLevel = 99;
    let bestScore = 0;
    for (const round of rounds) {
      const rn = (round.roundName || '').toLowerCase();
      const amt = parseFloat(round.amount) || 0;
      let level = 99;
      let score = 0;
      if (rn.includes('프리ipo') || rn.includes('pre-ipo') || rn.includes('브릿지')) {
        level = 1;
        score = amt >= 300000000000 ? 15 : amt >= 200000000000 ? 12 : amt >= 100000000000 ? 10 : amt >= 50000000000 ? 8 : amt >= 10000000000 ? 6 : amt >= 5000000000 ? 4 : 0;
      } else if (rn.includes('시리즈c') || rn.includes('series c')) {
        level = 2;
        score = amt >= 200000000000 ? 15 : amt >= 150000000000 ? 12 : amt >= 100000000000 ? 11 : amt >= 50000000000 ? 9 : amt >= 20000000000 ? 7 : amt >= 10000000000 ? 6 : amt >= 5000000000 ? 3 : 0;
      } else if (rn.includes('시리즈b') || rn.includes('series b')) {
        level = 3;
        score = amt >= 100000000000 ? 15 : amt >= 80000000000 ? 12 : amt >= 50000000000 ? 11 : amt >= 30000000000 ? 9 : amt >= 10000000000 ? 7 : amt >= 5000000000 ? 6 : amt >= 2000000000 ? 4 : 0;
      } else if (rn.includes('시리즈a') || rn.includes('series a')) {
        level = 4;
        score = amt >= 80000000000 ? 12 : amt >= 50000000000 ? 10 : amt >= 30000000000 ? 9 : amt >= 10000000000 ? 8 : amt >= 5000000000 ? 6 : amt >= 2000000000 ? 4 : amt >= 1000000000 ? 3 : 0;
      } else if (rn.includes('시드') || rn.includes('seed') || rn.includes('엔젤')) {
        level = 5;
        score = amt >= 10000000000 ? 10 : amt >= 8000000000 ? 9 : amt >= 6000000000 ? 8 : amt >= 4000000000 ? 6 : amt >= 2000000000 ? 4 : amt >= 1000000000 ? 3 : amt >= 500000000 ? 2 : 0;
      }
      if (level < bestLevel) { bestLevel = level; bestScore = score; }
    }
    breakdown.라운드별투자금액 = bestScore;
  }

  breakdown.후속참여 = !hasVC ? null
    : rounds.length >= 3 ? 5 : rounds.length >= 2 ? 3 : 2;

  // ── E. 기술·경쟁력 ──

  // 핵심특허 (최대 5점)
  const patentCount = company.patents?.totalCount || 0;
  breakdown.핵심특허 = patentCount >= 5 ? 5 : patentCount >= 3 ? 4 : patentCount >= 2 ? 3 : patentCount >= 1 ? 2 : 0;

  // 영업현금흐름비율 (최대 5점, 감점 있음)
  const latestCF = cashFlows.length > 0 ? cashFlows[cashFlows.length - 1] : null;
  if (!hasDart || !latestCF?.operatingCashFlow || !fin?.revenue) {
    breakdown.영업현금흐름비율 = null;
  } else {
    const ratio = (latestCF.operatingCashFlow / fin.revenue) * 100;
    breakdown.영업현금흐름비율 = ratio >= 20 ? 5 : ratio >= 10 ? 4 : ratio >= 5 ? 3 : ratio >= 0 ? 1 : -2;
  }

  // ── F. 시장·성장성 ──

  // 시장크기 (Claude AI 기반, 최대 5점)
  const sectorName = company.sectorName || company.industry || '';
  const fintechTAM = ['핀테크', '결제', '보험', '대출', '금융', '투자'];
  breakdown.시장크기 = fintechTAM.some(k => sectorName.includes(k)) ? 5 : 3;

  // ── G. 팀·운영 (커머스 동일) ──
  const estDate = company.financials?.establishedDate || null;
  if (!estDate) {
    breakdown.팀운영 = null;
  } else {
    const elapsed = new Date().getFullYear() - parseInt(String(estDate).slice(0, 4));
    breakdown.팀운영 = elapsed >= 7 ? 3 : elapsed >= 5 ? 2 : elapsed >= 3 ? 2 : elapsed >= 1 ? 1 : 0;
  }

  // ── H. 신규추가 (커머스 동일) ──

  // 매출채권 (최대 5점)
  if (!hasDart || !fin?.receivables || !fin?.revenue) {
    breakdown.매출채권 = null;
  } else {
    const ratio = (fin.receivables / fin.revenue) * 100;
    breakdown.매출채권 = ratio <= 30 ? 2 : ratio <= 50 ? 1 : ratio <= 70 ? 0 : -2;
  }

  // 대주주지분율 (최대 5점)
  const majorHolder = shareholders.find(s => s.relation?.includes('최대주주') || s.relation?.includes('본인'));
  breakdown.대주주지분율 = !majorHolder ? null
    : majorHolder.ratio >= 50 ? 5 : majorHolder.ratio >= 40 ? 4
    : majorHolder.ratio >= 30 ? 3 : majorHolder.ratio >= 20 ? 2 : 1;

  // 부채비율 (최대 5점, 감점 있음)
  const debtRatio = fin?.debtRatio || null;
  const prevDebtRatio = prevFin?.debtRatio || null;
  breakdown.부채비율절대 = debtRatio === null ? null
    : debtRatio <= 20 ? 5 : debtRatio <= 30 ? 4 : debtRatio <= 40 ? 3
    : debtRatio <= 50 ? 2 : debtRatio <= 70 ? 1 : -2;

  if (debtRatio !== null && prevDebtRatio !== null) {
    const dc = ((debtRatio - prevDebtRatio) / prevDebtRatio) * 100;
    breakdown.부채비율변화 = dc < 0
      ? (dc <= -70 ? 5 : dc <= -50 ? 4 : dc <= -40 ? 3 : dc <= -30 ? 2.5 : dc <= -20 ? 2 : 1.5)
      : (dc >= 70 ? -5 : dc >= 50 ? -4 : dc >= 40 ? -3 : dc >= 30 ? -2.5 : dc >= 20 ? -2 : -1.5);
  } else {
    breakdown.부채비율변화 = null;
  }

  // 현금흐름 (최대 5점)
  const prevCF = cashFlows.length >= 2 ? cashFlows[cashFlows.length - 2] : null;
  breakdown.기말현금 = !latestCF?.cashAndEquivalents ? null
    : latestCF.cashAndEquivalents >= 100000000000 ? 5
    : latestCF.cashAndEquivalents >= 70000000000  ? 4
    : latestCF.cashAndEquivalents >= 50000000000  ? 3
    : latestCF.cashAndEquivalents >= 20000000000  ? 2.5
    : latestCF.cashAndEquivalents >= 10000000000  ? 2
    : latestCF.cashAndEquivalents >= 5000000000   ? 1 : 0;

  if (latestCF?.cashAndEquivalents && prevCF?.cashAndEquivalents) {
    const diff = latestCF.cashAndEquivalents - prevCF.cashAndEquivalents;
    breakdown.현금흐름변화 = diff >= 0
      ? (diff >= 100000000000 ? 5 : diff >= 70000000000 ? 4 : diff >= 50000000000 ? 3 : diff >= 20000000000 ? 2.5 : diff >= 10000000000 ? 2 : 1)
      : (diff <= -100000000000 ? -5 : diff <= -70000000000 ? -4 : diff <= -50000000000 ? -3 : diff <= -20000000000 ? -2.5 : diff <= -10000000000 ? -2 : -1);
  } else {
    breakdown.현금흐름변화 = null;
  }

  // ── 최대 배점 정의 ──
  const maxScores = {
    // DART 기반
    매출규모: 15, 매출성장률: 15, 영업이익률: 5,
    인허가등급: 10, 인허가수: 5, 규제리스크: 5,
    수익모델안정성: 8, 매출채권회전율: 4,
    핵심특허: 5, 영업현금흐름비율: 5,
    팀운영: 3,
    매출채권: 5, 대주주지분율: 5, 부채비율절대: 5, 부채비율변화: 5, 기말현금: 5, 현금흐름변화: 5,
    // VC 기반
    투자라운드: 5, 밸류상승추이: 6, 참여VC티어: 4, 라운드텀: 5,
    투자금액상승: 5, 라운드별투자금액: 15, 후속참여: 5,
    // 기타
    시장크기: 5,
  };

  const vcKeys = ['투자라운드', '밸류상승추이', '참여VC티어', '라운드텀', '투자금액상승', '라운드별투자금액', '후속참여'];
  const dartKeys = ['매출규모', '매출성장률', '영업이익률', '인허가등급', '인허가수', '규제리스크', '수익모델안정성', '매출채권회전율', '핵심특허', '영업현금흐름비율', '팀운영', '매출채권', '대주주지분율', '부채비율절대', '부채비율변화', '기말현금', '현금흐름변화'];

  return normalizeScore(breakdown, maxScores, { hasVC, hasDart }, vcKeys, dartKeys);
}

function scoreMobility(company) {
  const breakdown = {};
  const allFin = company.financials?.financials || [];
  const fin = allFin.length > 0 ? allFin[allFin.length - 1] : null;
  const prevFin = allFin.length >= 2 ? allFin[allFin.length - 2] : null;
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const regulations = company.regulations?.regulations || [];
  const shareholders = company.financials?.shareholders || [];
  const cashFlows = company.financials?.cashFlows || [];

  const hasVC = rounds.length > 0;
  const hasDart = allFin.length > 0;

  // ── A. 기본 재무 ──

  // 매출규모 (최대 15점)
  if (!hasDart || fin?.revenue === null || fin?.revenue === undefined) {
    breakdown.매출규모 = null;
  } else {
    const r = fin.revenue;
    breakdown.매출규모 = r >= 500000000000 ? 15
      : r >= 200000000000 ? 12
      : r >= 100000000000 ? 9
      : r >= 50000000000  ? 6
      : r > 0             ? 3
      : 0;
  }

  // 매출성장률 (최대 15점) — 3개년 CAGR, 2개년 전년대비, 1개년 절대값
  if (!hasDart) {
    breakdown.매출성장률 = null;
  } else if (allFin.length >= 3) {
    const oldest = allFin[0].revenue || 0;
    const newest = allFin[allFin.length - 1].revenue || 0;
    const yrs = allFin.length - 1;
    const cagr = oldest > 0 ? (Math.pow(newest / oldest, 1 / yrs) - 1) * 100 : null;
    if (cagr === null) breakdown.매출성장률 = null;
    else if (cagr >= 100) breakdown.매출성장률 = 15;
    else if (cagr >= 70)  breakdown.매출성장률 = 12;
    else if (cagr >= 50)  breakdown.매출성장률 = 10;
    else if (cagr >= 30)  breakdown.매출성장률 = 8;
    else if (cagr >= 20)  breakdown.매출성장률 = 6;
    else if (cagr >= 10)  breakdown.매출성장률 = 4;
    else if (cagr >= 0)   breakdown.매출성장률 = 0;
    else breakdown.매출성장률 = Math.max(-10, Math.round(cagr / 10));
  } else if (allFin.length === 2) {
    const prev = allFin[0].revenue || 0;
    const curr = allFin[1].revenue || 0;
    const g = prev > 0 ? ((curr - prev) / prev) * 100 : null;
    if (g === null) breakdown.매출성장률 = null;
    else if (g >= 100) breakdown.매출성장률 = 15;
    else if (g >= 70)  breakdown.매출성장률 = 12;
    else if (g >= 50)  breakdown.매출성장률 = 10;
    else if (g >= 30)  breakdown.매출성장률 = 8;
    else if (g >= 20)  breakdown.매출성장률 = 6;
    else if (g >= 10)  breakdown.매출성장률 = 4;
    else if (g >= 0)   breakdown.매출성장률 = 0;
    else breakdown.매출성장률 = Math.max(-10, Math.round(g / 10));
  } else {
    const r = allFin[0].revenue || 0;
    breakdown.매출성장률 = r >= 500000000000 ? 15
      : r >= 200000000000 ? 12
      : r >= 50000000000  ? 8
      : r > 0             ? 4
      : 0;
  }

  // 영업이익률 (최대 5점, 감점 있음)
  if (!hasDart || fin?.operatingProfit === null || fin?.operatingProfit === undefined || !fin?.revenue) {
    breakdown.영업이익률 = null;
  } else {
    const margin = fin.revenue > 0 ? (fin.operatingProfit / fin.revenue) * 100 : null;
    if (margin === null) breakdown.영업이익률 = null;
    else if (margin >= 20)  breakdown.영업이익률 = 5;
    else if (margin >= 10)  breakdown.영업이익률 = 3;
    else if (margin >= 5)   breakdown.영업이익률 = 1;
    else if (margin >= 0)   breakdown.영업이익률 = 0;
    else if (margin >= -10) breakdown.영업이익률 = -1;
    else if (margin >= -20) breakdown.영업이익률 = -2;
    else                    breakdown.영업이익률 = -3;
  }

  // ── B. 기술·특허 (모빌리티 특화) ──

  // 핵심특허 (최대 10점)
  const patentCount = company.patents?.totalCount || 0;
  breakdown.핵심특허 = patentCount >= 5 ? 10
    : patentCount >= 3 ? 8
    : patentCount >= 2 ? 6
    : patentCount >= 1 ? 4
    : 0;

  // 정부 R&D 과제 수혜 (최대 5점) — DART 공시 파싱
  const hasRegulation = regulations.length > 0;
  if (!hasRegulation) {
    breakdown.정부RD과제 = null;
  } else {
    const rdCount = regulations.filter(r =>
      (r.title || '').includes('R&D') ||
      (r.title || '').includes('연구개발') ||
      (r.title || '').includes('과제') ||
      (r.title || '').includes('정부지원')
    ).length;
    breakdown.정부RD과제 = rdCount >= 3 ? 5 : rdCount >= 2 ? 3 : rdCount >= 1 ? 2 : 0;
  }

  // 영업현금흐름비율 (최대 5점, 감점 있음)
  const latestCF = cashFlows.length > 0 ? cashFlows[cashFlows.length - 1] : null;
  if (!hasDart || !latestCF?.operatingCashFlow || !fin?.revenue) {
    breakdown.영업현금흐름비율 = null;
  } else {
    const ratio = (latestCF.operatingCashFlow / fin.revenue) * 100;
    breakdown.영업현금흐름비율 = ratio >= 20 ? 5 : ratio >= 10 ? 4 : ratio >= 5 ? 3 : ratio >= 0 ? 1 : -2;
  }

  // ── C. 매출 구조 ──

  // 수익모델안정성 (최대 8점)
  if (!hasDart || fin?.revenue === null || fin?.revenue === undefined) {
    breakdown.수익모델안정성 = null;
  } else {
    const r = fin.revenue;
    breakdown.수익모델안정성 = r >= 100000000000 ? 8
      : r >= 50000000000  ? 6
      : r >= 20000000000  ? 4
      : r >= 5000000000   ? 2
      : r > 0             ? 1
      : 0;
  }

  // 매출채권회전율 (최대 4점, 감점 있음)
  if (!hasDart || !fin?.receivables || !fin?.revenue) {
    breakdown.매출채권회전율 = null;
  } else {
    const ratio = (fin.receivables / fin.revenue) * 100;
    breakdown.매출채권회전율 = ratio <= 30 ? 4
      : ratio <= 50 ? 2
      : ratio <= 70 ? 0
      : -2;
  }

  // ── D. VC 투자 (커머스/핀테크 동일) ──

  breakdown.투자라운드 = hasVC ? getRoundScore(latestRound.roundName, 5) : null;

  const val = parseFloat(latestRound.valuation) || 0;
  breakdown.밸류상승추이 = !hasVC ? null
    : val >= 300000000000 ? 6 : val >= 200000000000 ? 5 : val >= 100000000000 ? 4
    : val >= 50000000000  ? 3 : val >= 10000000000  ? 2 : val >= 5000000000 ? 1 : 0;

  breakdown.참여VC티어 = hasVC ? getVCTier(latestRound.investors) : null;
  breakdown.라운드텀 = hasVC ? getRoundSpeedScore(rounds, 5) : null;

  if (!hasVC || rounds.length < 2) {
    breakdown.투자금액상승 = hasVC ? 0 : null;
  } else {
    const curr = parseFloat(rounds[0].amount) || 0;
    const prev = parseFloat(rounds[1].amount) || 0;
    const diff = curr - prev;
    breakdown.투자금액상승 = diff >= 100000000000 ? 5 : diff >= 50000000000 ? 4
      : diff >= 30000000000 ? 3 : diff >= 10000000000 ? 2 : diff >= 5000000000 ? 1 : 0;
  }

  // 라운드별 투자금액 — 최고 라운드 1개만
  if (!hasVC) {
    breakdown.라운드별투자금액 = null;
  } else {
    let bestLevel = 99;
    let bestScore = 0;
    for (const round of rounds) {
      const rn = (round.roundName || '').toLowerCase();
      const amt = parseFloat(round.amount) || 0;
      let level = 99;
      let score = 0;
      if (rn.includes('프리ipo') || rn.includes('pre-ipo') || rn.includes('브릿지')) {
        level = 1;
        score = amt >= 300000000000 ? 15 : amt >= 200000000000 ? 12 : amt >= 100000000000 ? 10 : amt >= 50000000000 ? 8 : amt >= 10000000000 ? 6 : amt >= 5000000000 ? 4 : 0;
      } else if (rn.includes('시리즈c') || rn.includes('series c')) {
        level = 2;
        score = amt >= 200000000000 ? 15 : amt >= 150000000000 ? 12 : amt >= 100000000000 ? 11 : amt >= 50000000000 ? 9 : amt >= 20000000000 ? 7 : amt >= 10000000000 ? 6 : amt >= 5000000000 ? 3 : 0;
      } else if (rn.includes('시리즈b') || rn.includes('series b')) {
        level = 3;
        score = amt >= 100000000000 ? 15 : amt >= 80000000000 ? 12 : amt >= 50000000000 ? 11 : amt >= 30000000000 ? 9 : amt >= 10000000000 ? 7 : amt >= 5000000000 ? 6 : amt >= 2000000000 ? 4 : 0;
      } else if (rn.includes('시리즈a') || rn.includes('series a')) {
        level = 4;
        score = amt >= 80000000000 ? 12 : amt >= 50000000000 ? 10 : amt >= 30000000000 ? 9 : amt >= 10000000000 ? 8 : amt >= 5000000000 ? 6 : amt >= 2000000000 ? 4 : amt >= 1000000000 ? 3 : 0;
      } else if (rn.includes('시드') || rn.includes('seed') || rn.includes('엔젤')) {
        level = 5;
        score = amt >= 10000000000 ? 10 : amt >= 8000000000 ? 9 : amt >= 6000000000 ? 8 : amt >= 4000000000 ? 6 : amt >= 2000000000 ? 4 : amt >= 1000000000 ? 3 : amt >= 500000000 ? 2 : 0;
      }
      if (level < bestLevel) { bestLevel = level; bestScore = score; }
    }
    breakdown.라운드별투자금액 = bestScore;
  }

  breakdown.후속참여 = !hasVC ? null
    : rounds.length >= 3 ? 5 : rounds.length >= 2 ? 3 : 2;

  // ── E. 시장·성장성 ──

  // 시장크기 (Claude AI 기반, 최대 5점) — 모빌리티 키워드
  const sectorName = company.sectorName || company.industry || '';
  const mobilityTAM = ['모빌리티', '전기차', '자율주행', '물류', '배터리', '운송'];
  breakdown.시장크기 = mobilityTAM.some(k => sectorName.includes(k)) ? 5 : 3;

  // ── F. 팀·운영 (커머스 동일) ──
  const estDate = company.financials?.establishedDate || null;
  if (!estDate) {
    breakdown.팀운영 = null;
  } else {
    const elapsed = new Date().getFullYear() - parseInt(String(estDate).slice(0, 4));
    breakdown.팀운영 = elapsed >= 7 ? 3 : elapsed >= 5 ? 2 : elapsed >= 3 ? 2 : elapsed >= 1 ? 1 : 0;
  }

  // ── G. 신규추가 (커머스 동일) ──

  // 매출채권 (최대 5점)
  if (!hasDart || !fin?.receivables || !fin?.revenue) {
    breakdown.매출채권 = null;
  } else {
    const ratio = (fin.receivables / fin.revenue) * 100;
    breakdown.매출채권 = ratio <= 30 ? 2 : ratio <= 50 ? 1 : ratio <= 70 ? 0 : -2;
  }

  // 대주주지분율 (최대 5점)
  const majorHolder = shareholders.find(s => s.relation?.includes('최대주주') || s.relation?.includes('본인'));
  breakdown.대주주지분율 = !majorHolder ? null
    : majorHolder.ratio >= 50 ? 5 : majorHolder.ratio >= 40 ? 4
    : majorHolder.ratio >= 30 ? 3 : majorHolder.ratio >= 20 ? 2 : 1;

  // 부채비율 (최대 5점, 감점 있음)
  const debtRatio = fin?.debtRatio || null;
  const prevDebtRatio = prevFin?.debtRatio || null;
  breakdown.부채비율절대 = debtRatio === null ? null
    : debtRatio <= 20 ? 5 : debtRatio <= 30 ? 4 : debtRatio <= 40 ? 3
    : debtRatio <= 50 ? 2 : debtRatio <= 70 ? 1 : -2;

  if (debtRatio !== null && prevDebtRatio !== null) {
    const dc = ((debtRatio - prevDebtRatio) / prevDebtRatio) * 100;
    breakdown.부채비율변화 = dc < 0
      ? (dc <= -70 ? 5 : dc <= -50 ? 4 : dc <= -40 ? 3 : dc <= -30 ? 2.5 : dc <= -20 ? 2 : 1.5)
      : (dc >= 70 ? -5 : dc >= 50 ? -4 : dc >= 40 ? -3 : dc >= 30 ? -2.5 : dc >= 20 ? -2 : -1.5);
  } else {
    breakdown.부채비율변화 = null;
  }

  // 현금흐름 (최대 5점)
  const prevCF = cashFlows.length >= 2 ? cashFlows[cashFlows.length - 2] : null;
  breakdown.기말현금 = !latestCF?.cashAndEquivalents ? null
    : latestCF.cashAndEquivalents >= 100000000000 ? 5
    : latestCF.cashAndEquivalents >= 70000000000  ? 4
    : latestCF.cashAndEquivalents >= 50000000000  ? 3
    : latestCF.cashAndEquivalents >= 20000000000  ? 2.5
    : latestCF.cashAndEquivalents >= 10000000000  ? 2
    : latestCF.cashAndEquivalents >= 5000000000   ? 1 : 0;

  if (latestCF?.cashAndEquivalents && prevCF?.cashAndEquivalents) {
    const diff = latestCF.cashAndEquivalents - prevCF.cashAndEquivalents;
    breakdown.현금흐름변화 = diff >= 0
      ? (diff >= 100000000000 ? 5 : diff >= 70000000000 ? 4 : diff >= 50000000000 ? 3 : diff >= 20000000000 ? 2.5 : diff >= 10000000000 ? 2 : 1)
      : (diff <= -100000000000 ? -5 : diff <= -70000000000 ? -4 : diff <= -50000000000 ? -3 : diff <= -20000000000 ? -2.5 : diff <= -10000000000 ? -2 : -1);
  } else {
    breakdown.현금흐름변화 = null;
  }

  // ── 최대 배점 정의 ──
  const maxScores = {
    // DART 기반
    매출규모: 15, 매출성장률: 15, 영업이익률: 5,
    핵심특허: 10, 정부RD과제: 5, 영업현금흐름비율: 5,
    수익모델안정성: 8, 매출채권회전율: 4,
    팀운영: 3,
    매출채권: 5, 대주주지분율: 5, 부채비율절대: 5, 부채비율변화: 5, 기말현금: 5, 현금흐름변화: 5,
    // VC 기반
    투자라운드: 5, 밸류상승추이: 6, 참여VC티어: 4, 라운드텀: 5,
    투자금액상승: 5, 라운드별투자금액: 15, 후속참여: 5,
    // 기타
    시장크기: 5,
  };

  const vcKeys = ['투자라운드', '밸류상승추이', '참여VC티어', '라운드텀', '투자금액상승', '라운드별투자금액', '후속참여'];
  const dartKeys = ['매출규모', '매출성장률', '영업이익률', '핵심특허', '정부RD과제', '영업현금흐름비율', '수익모델안정성', '매출채권회전율', '팀운영', '매출채권', '대주주지분율', '부채비율절대', '부채비율변화', '기말현금', '현금흐름변화'];

  return normalizeScore(breakdown, maxScores, { hasVC, hasDart }, vcKeys, dartKeys);
}

function scoreB2BSaaS(company) {
  const breakdown = {};
  const allFin = company.financials?.financials || [];
  const fin = allFin.length > 0 ? allFin[allFin.length - 1] : null;
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const cashFlows = company.financials?.cashFlows || [];

  const hasVC = rounds.length > 0;
  const hasDart = allFin.length > 0;

  // ── A. 기본재무 (30점) ──

  // 매출규모 (최대 15점)
  if (!hasDart || fin?.revenue === null || fin?.revenue === undefined) {
    breakdown.매출규모 = null;
  } else {
    const r = fin.revenue;
    breakdown.매출규모 = r >= 10000000000 ? 15
      : r >= 5000000000  ? 12
      : r >= 1000000000  ? 8
      : r >= 500000000   ? 5
      : 2;
  }

  // 매출성장률 (최대 15점)
  if (!hasDart) {
    breakdown.매출성장률 = null;
  } else if (allFin.length >= 3) {
    const oldest = allFin[0].revenue || 0;
    const newest = allFin[allFin.length - 1].revenue || 0;
    const yrs = allFin.length - 1;
    const cagr = oldest > 0 ? (Math.pow(newest / oldest, 1 / yrs) - 1) * 100 : null;
    if (cagr === null) breakdown.매출성장률 = null;
    else if (cagr >= 100) breakdown.매출성장률 = 15;
    else if (cagr >= 50)  breakdown.매출성장률 = 12;
    else if (cagr >= 30)  breakdown.매출성장률 = 9;
    else if (cagr >= 10)  breakdown.매출성장률 = 6;
    else if (cagr >= 0)   breakdown.매출성장률 = 3;
    else breakdown.매출성장률 = 0;
  } else if (allFin.length === 2) {
    const prev = allFin[0].revenue || 0;
    const curr = allFin[1].revenue || 0;
    const g = prev > 0 ? ((curr - prev) / prev) * 100 : null;
    if (g === null) breakdown.매출성장률 = null;
    else if (g >= 100) breakdown.매출성장률 = 15;
    else if (g >= 50)  breakdown.매출성장률 = 12;
    else if (g >= 30)  breakdown.매출성장률 = 9;
    else if (g >= 10)  breakdown.매출성장률 = 6;
    else if (g >= 0)   breakdown.매출성장률 = 3;
    else breakdown.매출성장률 = 0;
  } else {
    const r = allFin[0].revenue || 0;
    breakdown.매출성장률 = r >= 10000000000 ? 15
      : r >= 5000000000  ? 12
      : r >= 1000000000  ? 8
      : r > 0            ? 5
      : 0;
  }

  // ── B. 수익구조 (20점) ──

  // 영업이익률 (최대 10점)
  if (!hasDart || fin?.operatingProfit === null || fin?.operatingProfit === undefined || !fin?.revenue) {
    breakdown.영업이익률 = null;
  } else {
    const margin = fin.revenue > 0 ? (fin.operatingProfit / fin.revenue) * 100 : null;
    if (margin === null) breakdown.영업이익률 = null;
    else if (margin >= 10)  breakdown.영업이익률 = 10;
    else if (margin >= 0)   breakdown.영업이익률 = 7;
    else if (margin >= -10) breakdown.영업이익률 = 4;
    else                    breakdown.영업이익률 = 0;
  }

  // 매출채권회전율 (최대 5점)
  if (!hasDart || !fin?.receivables || !fin?.revenue) {
    breakdown.매출채권회전율 = null;
  } else {
    const turnover = fin.receivables > 0 ? fin.revenue / fin.receivables : 0;
    breakdown.매출채권회전율 = turnover >= 12 ? 5
      : turnover >= 6 ? 3
      : turnover >= 3 ? 1
      : 0;
  }

  // 현금흐름 (최대 5점)
  const latestCF = cashFlows.length > 0 ? cashFlows[cashFlows.length - 1] : null;
  if (!hasDart || !latestCF?.operatingCashFlow) {
    breakdown.현금흐름 = null;
  } else {
    breakdown.현금흐름 = latestCF.operatingCashFlow > 0 ? 5 : 0;
  }

  // ── C. VC 투자 (35점) ──

  // 투자라운드 — 최고 라운드 1개만 (최대 15점)
  if (!hasVC) {
    breakdown.투자라운드 = null;
  } else {
    let bestLevel = 99;
    let bestScore = 0;
    for (const round of rounds) {
      const rn = (round.roundName || '').toLowerCase();
      let level = 99;
      let score = 0;
      if (rn.includes('시리즈c') || rn.includes('series c') || rn.includes('프리ipo') || rn.includes('pre-ipo') || rn.includes('브릿지')) {
        level = 1; score = 15;
      } else if (rn.includes('시리즈b') || rn.includes('series b')) {
        level = 2; score = 12;
      } else if (rn.includes('시리즈a') || rn.includes('series a')) {
        level = 3; score = 9;
      } else if (rn.includes('프리a') || rn.includes('pre-a') || rn.includes('프리시리즈')) {
        level = 4; score = 6;
      } else if (rn.includes('시드') || rn.includes('seed') || rn.includes('엔젤')) {
        level = 5; score = 3;
      }
      if (level < bestLevel) { bestLevel = level; bestScore = score; }
    }
    breakdown.투자라운드 = bestScore;
  }

  // 투자금액 (최대 10점)
  if (!hasVC) {
    breakdown.투자금액 = null;
  } else {
    const amt = parseFloat(latestRound.amount) || 0;
    breakdown.투자금액 = amt >= 50000000000 ? 10
      : amt >= 20000000000 ? 8
      : amt >= 10000000000 ? 6
      : amt >= 5000000000  ? 4
      : 2;
  }

  // 투자자 티어 (최대 10점)
  if (!hasVC) {
    breakdown.투자자티어 = null;
  } else {
    const { t1Names, t2Names } = getVCTiers();
    const investors = (latestRound.investors || []).map(v => v.toLowerCase());
    const hasT1 = investors.some(v => t1Names.some(t => v.includes(t)));
    const hasT2 = investors.some(v => t2Names.some(t => v.includes(t)));
    // CVC 판단 — 대기업 키워드
    const cvcKeywords = ['삼성', '네이버', '카카오', 'lg', 'sk', '현대', 'kt', '롯데', 'gs', 'cj'];
    const hasCVC = investors.some(v => cvcKeywords.some(k => v.includes(k)));
    breakdown.투자자티어 = hasT1 ? 10 : hasT2 ? 7 : hasCVC ? 5 : investors.length > 0 ? 3 : 0;
  }

  // ── D. 기술경쟁력 (10점) ──

  // 핵심특허 (최대 5점)
  const patentCount = company.patents?.totalCount || 0;
  breakdown.핵심특허 = patentCount >= 5 ? 5 : patentCount >= 3 ? 3 : patentCount >= 1 ? 1 : 0;

  // 부채비율 (최대 5점)
  const debtRatio = fin?.debtRatio || null;
  breakdown.부채비율 = debtRatio === null ? null
    : debtRatio < 100 ? 5
    : debtRatio < 200 ? 3
    : 0;

  // ── E. 시장크기 (5점) ──
  const sectorName = company.sectorName || company.industry || '';
  const saasTAM = ['SaaS', 'saas', '클라우드', 'ERP', 'HR', 'CRM', '협업'];
  breakdown.시장크기 = saasTAM.some(k => sectorName.includes(k)) ? 5
    : sectorName.length > 0 ? 3
    : 1;

  // ── 최대 배점 정의 ──
  const maxScores = {
    // DART 기반
    매출규모: 15, 매출성장률: 15,
    영업이익률: 10, 매출채권회전율: 5, 현금흐름: 5,
    부채비율: 5,
    // VC 기반
    투자라운드: 15, 투자금액: 10, 투자자티어: 10,
    // 기타
    핵심특허: 5, 시장크기: 5,
  };

  const vcKeys = ['투자라운드', '투자금액', '투자자티어'];
  const dartKeys = ['매출규모', '매출성장률', '영업이익률', '매출채권회전율', '현금흐름', '부채비율'];

  return normalizeScore(breakdown, maxScores, { hasVC, hasDart }, vcKeys, dartKeys);
}

// ─── 엔터테인먼트 유형 자동 판별 ───

function detectEnterType(company) {
  const text = [
    company.description || '',
    company.newsText || '',
    company.sector || ''
  ].join(' ').toLowerCase();

  // 플랫폼형 우선 판별
  const platformKeywords = ['앱', '플랫폼', '구독', 'mau', '팬덤앱', '스트리밍', 'saas'];
  if (platformKeywords.some(k => text.includes(k))) return 'PLATFORM';

  // 제작사형
  const productionKeywords = ['드라마', '영화', '제작사', 'ott', '시즌', '콘텐츠제작', '납품'];
  if (productionKeywords.some(k => text.includes(k))) return 'PRODUCTION';

  // 기본값: 기획사형
  return 'AGENCY';
}

// ─── 엔터 공통: 기본재무 + 영업이익률 + 매출성장률 계산 ───

function getEnterFinancials(company) {
  const allFin = company.financials?.financials || [];
  const fin = allFin.length > 0 ? allFin[allFin.length - 1] : null;
  const hasDart = allFin.length > 0;
  const result = {};

  // 매출규모 (최대 15점)
  if (!hasDart || fin?.revenue === null || fin?.revenue === undefined) {
    result.매출규모 = null;
  } else {
    const r = fin.revenue;
    result.매출규모 = r >= 100000000000 ? 15
      : r >= 50000000000  ? 12
      : r >= 10000000000  ? 8
      : r >= 5000000000   ? 5
      : 2;
  }

  // 매출성장률 (최대 15점)
  if (!hasDart) {
    result.매출성장률 = null;
  } else if (allFin.length >= 3) {
    const oldest = allFin[0].revenue || 0;
    const newest = allFin[allFin.length - 1].revenue || 0;
    const yrs = allFin.length - 1;
    const cagr = oldest > 0 ? (Math.pow(newest / oldest, 1 / yrs) - 1) * 100 : null;
    if (cagr === null) result.매출성장률 = null;
    else if (cagr >= 100) result.매출성장률 = 15;
    else if (cagr >= 50)  result.매출성장률 = 12;
    else if (cagr >= 30)  result.매출성장률 = 9;
    else if (cagr >= 10)  result.매출성장률 = 6;
    else if (cagr >= 0)   result.매출성장률 = 3;
    else result.매출성장률 = 0;
  } else if (allFin.length === 2) {
    const prev = allFin[0].revenue || 0;
    const curr = allFin[1].revenue || 0;
    const g = prev > 0 ? ((curr - prev) / prev) * 100 : null;
    if (g === null) result.매출성장률 = null;
    else if (g >= 100) result.매출성장률 = 15;
    else if (g >= 50)  result.매출성장률 = 12;
    else if (g >= 30)  result.매출성장률 = 9;
    else if (g >= 10)  result.매출성장률 = 6;
    else if (g >= 0)   result.매출성장률 = 3;
    else result.매출성장률 = 0;
  } else {
    const r = allFin[0].revenue || 0;
    result.매출성장률 = r >= 100000000000 ? 15
      : r >= 50000000000  ? 12
      : r >= 10000000000  ? 8
      : r > 0             ? 5
      : 0;
  }

  // 영업이익률 (최대 10점)
  if (!hasDart || fin?.operatingProfit === null || fin?.operatingProfit === undefined || !fin?.revenue) {
    result.영업이익률 = null;
  } else {
    const margin = fin.revenue > 0 ? (fin.operatingProfit / fin.revenue) * 100 : null;
    if (margin === null) result.영업이익률 = null;
    else if (margin >= 10)  result.영업이익률 = 10;
    else if (margin >= 0)   result.영업이익률 = 7;
    else if (margin >= -10) result.영업이익률 = 4;
    else                    result.영업이익률 = 0;
  }

  return { result, hasDart };
}

// ─── 엔터 공통: VC 투자 점수 계산 ───

function getEnterVCScores(company, maxTotal) {
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const hasVC = rounds.length > 0;
  const result = {};

  if (!hasVC) {
    result.투자라운드 = null;
    result.투자금액 = null;
    result.참여VC티어 = null;
    result.투자금액상승 = null;
    result.후속참여 = null;
    return { result, hasVC };
  }

  // 라운드별 투자금액 — 최고 라운드 1개 (최대 비례환산)
  let bestLevel = 99;
  let bestScore = 0;
  for (const round of rounds) {
    const rn = (round.roundName || '').toLowerCase();
    const amt = parseFloat(round.amount) || 0;
    let level = 99;
    let score = 0;
    if (rn.includes('프리ipo') || rn.includes('pre-ipo') || rn.includes('브릿지') || rn.includes('시리즈c') || rn.includes('series c')) {
      level = 1;
      score = amt >= 200000000000 ? 15 : amt >= 100000000000 ? 12 : amt >= 50000000000 ? 9 : amt >= 10000000000 ? 6 : amt >= 5000000000 ? 4 : 2;
    } else if (rn.includes('시리즈b') || rn.includes('series b')) {
      level = 2;
      score = amt >= 100000000000 ? 15 : amt >= 50000000000 ? 11 : amt >= 30000000000 ? 9 : amt >= 10000000000 ? 7 : amt >= 5000000000 ? 5 : 2;
    } else if (rn.includes('시리즈a') || rn.includes('series a')) {
      level = 3;
      score = amt >= 50000000000 ? 12 : amt >= 30000000000 ? 9 : amt >= 10000000000 ? 7 : amt >= 5000000000 ? 5 : amt >= 1000000000 ? 3 : 1;
    } else if (rn.includes('시드') || rn.includes('seed') || rn.includes('엔젤')) {
      level = 4;
      score = amt >= 10000000000 ? 9 : amt >= 5000000000 ? 6 : amt >= 1000000000 ? 3 : 1;
    }
    if (level < bestLevel) { bestLevel = level; bestScore = score; }
  }
  result.투자라운드 = bestScore;

  // 참여VC티어 (최대 5점)
  result.참여VC티어 = Math.min(getVCTier(latestRound.investors), 4);

  // 투자금액상승 (최대 5점)
  if (rounds.length < 2) {
    result.투자금액상승 = 0;
  } else {
    const curr = parseFloat(rounds[0].amount) || 0;
    const prev = parseFloat(rounds[1].amount) || 0;
    const diff = curr - prev;
    result.투자금액상승 = diff >= 50000000000 ? 5 : diff >= 20000000000 ? 4 : diff >= 10000000000 ? 3 : diff >= 5000000000 ? 2 : diff > 0 ? 1 : 0;
  }

  // 후속참여 (최대 5점)
  result.후속참여 = rounds.length >= 3 ? 5 : rounds.length >= 2 ? 3 : 2;

  return { result, hasVC };
}

// ─── 기획사형 (AGENCY) ───

function scoreEnterAgency(company) {
  const breakdown = {};
  const { result: finScores, hasDart } = getEnterFinancials(company);
  Object.assign(breakdown, finScores);

  const newsText = (company.newsText || '').toLowerCase();

  // B. 아티스트 IP (20점)
  const artistKeywords = ['아티스트', '가수', '아이돌', '솔로', '그룹', '밴드', '래퍼', '보컬'];
  const artistCount = artistKeywords.reduce((cnt, k) => cnt + (newsText.includes(k) ? 1 : 0), 0);
  breakdown.소속아티스트 = artistCount >= 5 ? 5 : artistCount >= 3 ? 3 : artistCount >= 1 ? 1 : 0;

  const globalKeywords = ['해외공연', '빌보드', '해외투어', '월드투어', '글로벌투어', '아시아투어'];
  const globalCount = globalKeywords.reduce((cnt, k) => cnt + (newsText.includes(k) ? 1 : 0), 0);
  breakdown.글로벌활동 = globalCount >= 3 ? 10 : globalCount >= 2 ? 7 : globalCount >= 1 ? 4 : 0;

  const chartKeywords = ['멜론', '스포티파이', '빌보드', '차트', '음원'];
  breakdown.음원차트 = chartKeywords.some(k => newsText.includes(k)) ? 5 : 0;

  // C. 글로벌진출 (10점)
  const globalBizKeywords = ['해외법인', '글로벌진출', '해외지사', '일본법인', '미국법인'];
  breakdown.글로벌진출 = globalBizKeywords.some(k => newsText.includes(k)) ? 5 : 0;

  // D. VC 투자 (30점)
  const { result: vcScores, hasVC } = getEnterVCScores(company, 30);
  Object.assign(breakdown, vcScores);

  // 최대 배점 정의
  const maxScores = {
    매출규모: 15, 매출성장률: 15, 영업이익률: 10,
    소속아티스트: 5, 글로벌활동: 10, 음원차트: 5,
    글로벌진출: 10,
    투자라운드: 15, 참여VC티어: 4, 투자금액상승: 5, 후속참여: 5,
  };

  const vcKeys = ['투자라운드', '참여VC티어', '투자금액상승', '후속참여'];
  const dartKeys = ['매출규모', '매출성장률', '영업이익률'];

  return normalizeScore(breakdown, maxScores, { hasVC, hasDart }, vcKeys, dartKeys);
}

// ─── 제작사형 (PRODUCTION) ───

function scoreEnterProduction(company) {
  const breakdown = {};
  const { result: finScores, hasDart } = getEnterFinancials(company);
  Object.assign(breakdown, finScores);

  const newsText = (company.newsText || '').toLowerCase();

  // B. 콘텐츠 IP (20점)
  const ottKeywords = ['넷플릭스', '디즈니', '웨이브', '티빙', '쿠팡플레이', 'ott'];
  const ottCount = ottKeywords.reduce((cnt, k) => cnt + (newsText.includes(k) ? 1 : 0), 0);
  breakdown.OTT납품 = ottCount >= 3 ? 10 : ottCount >= 2 ? 7 : ottCount >= 1 ? 4 : 0;

  const sequelKeywords = ['시즌2', '속편', '리메이크'];
  breakdown.시즌속편 = sequelKeywords.some(k => newsText.includes(k)) ? 5 : 0;

  const exportKeywords = ['판권수출', '포맷판매', '해외리메이크', '해외판권'];
  breakdown.해외판권 = exportKeywords.some(k => newsText.includes(k)) ? 5 : 0;

  // C. 수주잔고 (10점) — 뉴스 기반
  const contractKeywords = ['계약체결', '납품계약', '수주', '공급계약'];
  const contractCount = contractKeywords.reduce((cnt, k) => cnt + (newsText.includes(k) ? 1 : 0), 0);
  breakdown.수주잔고 = contractCount >= 2 ? 7 : contractCount >= 1 ? 4 : 0;

  // D. VC 투자 (30점)
  const { result: vcScores, hasVC } = getEnterVCScores(company, 30);
  Object.assign(breakdown, vcScores);

  // 최대 배점 정의
  const maxScores = {
    매출규모: 15, 매출성장률: 15, 영업이익률: 10,
    OTT납품: 10, 시즌속편: 5, 해외판권: 5,
    수주잔고: 10,
    투자라운드: 15, 참여VC티어: 4, 투자금액상승: 5, 후속참여: 5,
  };

  const vcKeys = ['투자라운드', '참여VC티어', '투자금액상승', '후속참여'];
  const dartKeys = ['매출규모', '매출성장률', '영업이익률'];

  return normalizeScore(breakdown, maxScores, { hasVC, hasDart }, vcKeys, dartKeys);
}

// ─── 플랫폼형 (PLATFORM) ───

function scoreEnterPlatform(company) {
  const breakdown = {};
  const { result: finScores, hasDart } = getEnterFinancials(company);
  Object.assign(breakdown, finScores);

  const newsText = (company.newsText || '').toLowerCase();

  // B. 플랫폼 지표 (25점)
  const userKeywords = ['mau', 'dau', '가입자', '이용자', '사용자'];
  const hasUserMention = userKeywords.some(k => newsText.includes(k));
  // 숫자 추출 시도 (만 단위)
  const numMatch = newsText.match(/(\d+)\s*만/);
  const userCount = numMatch ? parseInt(numMatch[1]) * 10000 : (hasUserMention ? 1 : 0);
  breakdown.유저수 = userCount >= 1000000 ? 10 : userCount >= 500000 ? 7 : userCount >= 100000 ? 4 : hasUserMention ? 2 : 0;

  const subKeywords = ['구독', '월정액', '멤버십', '프리미엄'];
  breakdown.구독모델 = subKeywords.some(k => newsText.includes(k)) ? 5 : 0;

  const appKeywords = ['앱스토어', '구글플레이', '인기앱', 'app store', 'google play'];
  breakdown.앱스토어노출 = appKeywords.some(k => newsText.includes(k)) ? 5 : 0;

  const patentCount = company.patents?.totalCount || 0;
  breakdown.기술특허 = patentCount >= 3 ? 5 : patentCount >= 1 ? 3 : 0;

  // D. VC 투자 (35점) — 플랫폼은 VC 비중 가장 높음
  const { result: vcScores, hasVC } = getEnterVCScores(company, 35);
  Object.assign(breakdown, vcScores);

  // 최대 배점 정의
  const maxScores = {
    매출규모: 15, 매출성장률: 15, 영업이익률: 10,
    유저수: 10, 구독모델: 5, 앱스토어노출: 5, 기술특허: 5,
    투자라운드: 15, 참여VC티어: 4, 투자금액상승: 5, 후속참여: 5,
  };

  const vcKeys = ['투자라운드', '참여VC티어', '투자금액상승', '후속참여'];
  const dartKeys = ['매출규모', '매출성장률', '영업이익률'];

  return normalizeScore(breakdown, maxScores, { hasVC, hasDart }, vcKeys, dartKeys);
}

// ─── 엔터테인먼트 메인 함수 ───

function scoreEntertainment(company) {
  const type = detectEnterType(company);

  if (type === 'AGENCY') return scoreEnterAgency(company);
  if (type === 'PRODUCTION') return scoreEnterProduction(company);
  return scoreEnterPlatform(company);
}

// ─── 바이오 유형 자동 판별 ───

function detectBioType(company) {
  const text = [
    company.description || '',
    company.newsText || '',
    company.sector || ''
  ].join(' ').toLowerCase();

  const biotechKeywords = ['제품판매', '매출성장', '흑자', '수출', '글로벌판매', '바이오시밀러', '진단키트', '의약품판매'];
  const hasBiotechKeyword = biotechKeywords.some(k => text.includes(k));

  const allFin = company.financials?.financials || [];
  const hasRevenue = allFin.some(f => (parseFloat(f.revenue) || 0) > 0);

  if (hasBiotechKeyword || hasRevenue) return 'BIOTECH';
  return 'NEWDRUG';
}

// ─── 임상단계 키워드 탐지 ───

function getClinicalStageScore(company, maxScore) {
  const text = [
    company.newsText || '',
    company.description || '',
    company.clinicalInfo || ''
  ].join(' ');

  const stages = [
    { score: maxScore, keywords: ['FDA승인', 'FDA approval', '품목허가', '시판허가', '허가완료', '판매승인'] },
    { score: Math.round(maxScore * 0.85), keywords: ['임상3상', '3상완료', '3상진입', '3상 진행', 'Phase 3', 'phase III', 'Phase III'] },
    { score: Math.round(maxScore * 0.65), keywords: ['임상2상', '2상완료', '2상진입', '2상 진행', 'Phase 2', 'phase II', 'Phase II'] },
    { score: Math.round(maxScore * 0.45), keywords: ['임상1상', '1상완료', '1상진입', '1상 진행', 'Phase 1', 'phase I', 'Phase I'] },
    { score: Math.round(maxScore * 0.25), keywords: ['IND', '임상시험계획', '임상신청', '임상승인', '임상진입'] },
    { score: Math.round(maxScore * 0.1), keywords: ['전임상', '비임상', '동물실험', '동물모델'] },
  ];

  for (const stage of stages) {
    if (stage.keywords.some(k => text.includes(k))) return stage.score;
  }
  return 0;
}

// ─── 기술이전계약 점수 ───

function getLicenseOutScore(company) {
  const text = [company.newsText || '', company.description || ''].join(' ');

  const licenseKeywords = ['기술이전', '라이선스아웃', 'License-out', 'L/O', '기술수출',
    '글로벌파트너십', '마일스톤', 'milestone', '업프론트', 'upfront', '계약금',
    '총 계약규모', '옵션계약', '공동개발'];
  const hasLicense = licenseKeywords.some(k => text.includes(k));

  if (!hasLicense) return { totalScore: null, upfrontScore: null };

  let totalScore = 2;
  const totalAmount = company.licenseOutTotal || null;

  if (totalAmount !== null) {
    totalScore = totalAmount >= 10000 ? 12
      : totalAmount >= 5000  ? 10
      : totalAmount >= 1000  ? 8
      : totalAmount >= 500   ? 6
      : totalAmount >= 100   ? 4
      : 2;
  }

  let upfrontScore = null;
  const upfrontAmount = company.licenseOutUpfront || null;

  if (upfrontAmount !== null) {
    upfrontScore = upfrontAmount >= 500 ? 8
      : upfrontAmount >= 100 ? 6
      : upfrontAmount >= 50  ? 4
      : upfrontAmount >= 10  ? 2
      : 1;
  }

  return { totalScore, upfrontScore };
}

// ─── 바이오 공통: VC 점수 계산 ───

function getBioVCScores(company, vcTotal) {
  const vc = company.vcHistory;
  const rounds = vc?.rounds || [];
  const latestRound = rounds[0] || {};
  const hasVC = rounds.length > 0;
  const result = {};

  if (!hasVC) {
    result.라운드별투자금액 = null;
    result.투자자티어 = null;
    result.투자금액상승 = null;
    result.후속참여 = null;
    return { result, hasVC };
  }

  // 라운드별 투자금액 (vcTotal의 50%)
  const maxRound = Math.round(vcTotal * 0.5);
  let bestLevel = 99;
  let bestScore = 0;
  for (const round of rounds) {
    const rn = (round.roundName || '').toLowerCase();
    const amt = parseFloat(round.amount) || 0;
    let level = 99;
    let score = 0;
    if (rn.includes('프리ipo') || rn.includes('pre-ipo') || rn.includes('브릿지') || rn.includes('시리즈c') || rn.includes('series c')) {
      level = 1;
      score = amt >= 200000000000 ? maxRound : amt >= 100000000000 ? Math.round(maxRound * 0.8) : amt >= 50000000000 ? Math.round(maxRound * 0.6) : amt >= 10000000000 ? Math.round(maxRound * 0.4) : Math.round(maxRound * 0.2);
    } else if (rn.includes('시리즈b') || rn.includes('series b')) {
      level = 2;
      score = amt >= 100000000000 ? maxRound : amt >= 50000000000 ? Math.round(maxRound * 0.75) : amt >= 20000000000 ? Math.round(maxRound * 0.55) : amt >= 10000000000 ? Math.round(maxRound * 0.35) : Math.round(maxRound * 0.15);
    } else if (rn.includes('시리즈a') || rn.includes('series a')) {
      level = 3;
      score = amt >= 50000000000 ? Math.round(maxRound * 0.7) : amt >= 20000000000 ? Math.round(maxRound * 0.5) : amt >= 10000000000 ? Math.round(maxRound * 0.35) : Math.round(maxRound * 0.15);
    } else if (rn.includes('시드') || rn.includes('seed') || rn.includes('엔젤')) {
      level = 4;
      score = amt >= 10000000000 ? Math.round(maxRound * 0.4) : amt >= 5000000000 ? Math.round(maxRound * 0.25) : Math.round(maxRound * 0.1);
    }
    if (level < bestLevel) { bestLevel = level; bestScore = score; }
  }
  result.라운드별투자금액 = bestScore;

  // 투자자 티어 (vcTotal의 30%)
  const maxTier = Math.round(vcTotal * 0.3);
  const { t1Names, t2Names } = getVCTiers();
  const investors = (latestRound.investors || []).map(v => v.toLowerCase());
  const hasT1 = investors.some(v => t1Names.some(t => v.includes(t)));
  const hasT2 = investors.some(v => t2Names.some(t => v.includes(t)));
  result.투자자티어 = hasT1 ? maxTier : hasT2 ? Math.round(maxTier * 0.7) : investors.length > 0 ? Math.round(maxTier * 0.3) : 0;

  // 투자금액 상승 (vcTotal의 10%)
  const maxUp = Math.round(vcTotal * 0.1);
  if (rounds.length < 2) {
    result.투자금액상승 = 0;
  } else {
    const curr = parseFloat(rounds[0].amount) || 0;
    const prev = parseFloat(rounds[1].amount) || 0;
    const diff = curr - prev;
    result.투자금액상승 = diff >= 50000000000 ? maxUp : diff >= 20000000000 ? Math.round(maxUp * 0.7) : diff > 0 ? Math.round(maxUp * 0.3) : 0;
  }

  // 후속참여 (vcTotal의 10%)
  const maxFollow = Math.round(vcTotal * 0.1);
  result.후속참여 = rounds.length >= 3 ? maxFollow : rounds.length >= 2 ? Math.round(maxFollow * 0.6) : Math.round(maxFollow * 0.3);

  return { result, hasVC };
}

// ─── 신약개발사 (NEWDRUG) ───

function scoreNewdrug(company) {
  const breakdown = {};
  const allFin = company.financials?.financials || [];
  const fin = allFin.length > 0 ? allFin[allFin.length - 1] : null;
  const cashFlows = company.financials?.cashFlows || [];
  const latestCF = cashFlows.length > 0 ? cashFlows[cashFlows.length - 1] : null;
  const hasDart = allFin.length > 0;
  const patentCount = company.patents?.totalCount || 0;
  const newsText = (company.newsText || '').toLowerCase();

  // 재무 유무에 따라 배점 조정
  const vcTotal = hasDart ? 40 : 50;
  const clinicalMax = hasDart ? 15 : 20;
  const licenseMax = hasDart ? 15 : 20;

  // VC 투자
  const { result: vcScores, hasVC } = getBioVCScores(company, vcTotal);
  Object.assign(breakdown, vcScores);

  // 임상단계
  breakdown.임상단계 = getClinicalStageScore(company, clinicalMax);

  // 기술이전계약
  const license = getLicenseOutScore(company);
  breakdown.기술이전총액 = license.totalScore;
  breakdown.기술이전업프론트 = license.upfrontScore;

  // 파이프라인 수 (5점)
  const pipelineKeywords = ['파이프라인', '후보물질', '적응증'];
  const pipelineCount = pipelineKeywords.reduce((cnt, k) => cnt + (newsText.includes(k) ? 1 : 0), 0);
  breakdown.파이프라인수 = pipelineCount >= 3 ? 5 : pipelineCount >= 2 ? 3 : pipelineCount >= 1 ? 2 : 0;

  // 핵심특허 (5점)
  breakdown.핵심특허 = patentCount >= 10 ? 5 : patentCount >= 5 ? 3 : patentCount >= 1 ? 1 : 0;

  // 재무구조 (20점) — 재무 있을 때만
  if (hasDart) {
    // 현금및현금성자산 (8점)
    const cash = latestCF?.cashAndEquivalents || null;
    breakdown.현금보유 = cash === null ? null
      : cash >= 50000000000 ? 8
      : cash >= 20000000000 ? 6
      : cash >= 10000000000 ? 4
      : cash >= 5000000000  ? 2
      : 0;

    // 부채비율 (6점)
    const debtRatio = fin?.debtRatio || null;
    breakdown.부채비율 = debtRatio === null ? null
      : debtRatio < 50  ? 6
      : debtRatio < 100 ? 4
      : debtRatio < 200 ? 2
      : 0;

    // 영업현금흐름 (6점)
    const opCF = latestCF?.operatingCashFlow || null;
    breakdown.영업현금흐름 = opCF === null ? null
      : opCF > 0 ? 6
      : 0;
  }

  // 최대 배점 정의
  const vcMaxRound = Math.round(vcTotal * 0.5);
  const vcMaxTier = Math.round(vcTotal * 0.3);
  const vcMaxUp = Math.round(vcTotal * 0.1);
  const vcMaxFollow = Math.round(vcTotal * 0.1);

  const maxScores = {
    라운드별투자금액: vcMaxRound, 투자자티어: vcMaxTier, 투자금액상승: vcMaxUp, 후속참여: vcMaxFollow,
    임상단계: clinicalMax,
    기술이전총액: 12, 기술이전업프론트: 8,
    파이프라인수: 5, 핵심특허: 5,
  };

  if (hasDart) {
    maxScores.현금보유 = 8;
    maxScores.부채비율 = 6;
    maxScores.영업현금흐름 = 6;
  }

  const vcKeys = ['라운드별투자금액', '투자자티어', '투자금액상승', '후속참여'];
  const dartKeys = hasDart ? ['현금보유', '부채비율', '영업현금흐름'] : [];
  // 임상/기술이전은 VC도 DART도 아닌 독립 항목이므로, hasVC 또는 임상단계>0 이면 점수 산출 가능
  const hasClinical = breakdown.임상단계 > 0 || license.totalScore !== null;

  // VC도 임상/기술이전도 없으면 데이터부족
  if (!hasVC && !hasDart && !hasClinical) {
    return { total: null, breakdown, dataStatus: '데이터부족' };
  }

  return normalizeScore(breakdown, maxScores, { hasVC: hasVC || hasClinical, hasDart }, vcKeys, dartKeys);
}

// ─── 바이오테크 (BIOTECH) ───

function scoreBiotech(company) {
  const breakdown = {};
  const allFin = company.financials?.financials || [];
  const fin = allFin.length > 0 ? allFin[allFin.length - 1] : null;
  const hasDart = allFin.length > 0;
  const patentCount = company.patents?.totalCount || 0;
  const newsText = (company.newsText || '').toLowerCase();

  // VC 투자 (40점)
  const { result: vcScores, hasVC } = getBioVCScores(company, 40);
  Object.assign(breakdown, vcScores);

  // 매출규모 (12점)
  if (!hasDart || fin?.revenue === null || fin?.revenue === undefined) {
    breakdown.매출규모 = null;
  } else {
    const r = fin.revenue;
    breakdown.매출규모 = r >= 100000000000 ? 12
      : r >= 50000000000  ? 10
      : r >= 10000000000  ? 7
      : r >= 5000000000   ? 4
      : 2;
  }

  // 매출성장률 (13점)
  if (!hasDart) {
    breakdown.매출성장률 = null;
  } else if (allFin.length >= 3) {
    const oldest = allFin[0].revenue || 0;
    const newest = allFin[allFin.length - 1].revenue || 0;
    const yrs = allFin.length - 1;
    const cagr = oldest > 0 ? (Math.pow(newest / oldest, 1 / yrs) - 1) * 100 : null;
    if (cagr === null) breakdown.매출성장률 = null;
    else if (cagr >= 100) breakdown.매출성장률 = 13;
    else if (cagr >= 50)  breakdown.매출성장률 = 10;
    else if (cagr >= 30)  breakdown.매출성장률 = 8;
    else if (cagr >= 10)  breakdown.매출성장률 = 5;
    else if (cagr >= 0)   breakdown.매출성장률 = 3;
    else breakdown.매출성장률 = 0;
  } else if (allFin.length === 2) {
    const prev = allFin[0].revenue || 0;
    const curr = allFin[1].revenue || 0;
    const g = prev > 0 ? ((curr - prev) / prev) * 100 : null;
    if (g === null) breakdown.매출성장률 = null;
    else if (g >= 100) breakdown.매출성장률 = 13;
    else if (g >= 50)  breakdown.매출성장률 = 10;
    else if (g >= 30)  breakdown.매출성장률 = 8;
    else if (g >= 10)  breakdown.매출성장률 = 5;
    else if (g >= 0)   breakdown.매출성장률 = 3;
    else breakdown.매출성장률 = 0;
  } else {
    const r = allFin[0].revenue || 0;
    breakdown.매출성장률 = r >= 100000000000 ? 13
      : r >= 50000000000  ? 10
      : r >= 10000000000  ? 7
      : r > 0             ? 4
      : 0;
  }

  // 영업이익률 (15점)
  if (!hasDart || fin?.operatingProfit === null || fin?.operatingProfit === undefined || !fin?.revenue) {
    breakdown.영업이익률 = null;
  } else {
    const margin = fin.revenue > 0 ? (fin.operatingProfit / fin.revenue) * 100 : null;
    if (margin === null) breakdown.영업이익률 = null;
    else if (margin >= 50)  breakdown.영업이익률 = 15;
    else if (margin >= 30)  breakdown.영업이익률 = 12;
    else if (margin >= 20)  breakdown.영업이익률 = 9;
    else if (margin >= 10)  breakdown.영업이익률 = 6;
    else if (margin >= 0)   breakdown.영업이익률 = 3;
    else breakdown.영업이익률 = 0;
  }

  // 핵심특허 (5점)
  breakdown.핵심특허 = patentCount >= 10 ? 5 : patentCount >= 5 ? 3 : patentCount >= 1 ? 1 : 0;

  // 글로벌수출 (15점)
  const exportKeywords = ['수출', '글로벌판매', '해외매출', '수출비중', '글로벌진출'];
  const hasExportNews = exportKeywords.some(k => newsText.includes(k));
  const exportRatio = company.exportRatio || null;

  if (exportRatio !== null) {
    breakdown.글로벌수출 = exportRatio >= 50 ? 15
      : exportRatio >= 30 ? 12
      : exportRatio >= 10 ? 9
      : 7;
  } else if (hasExportNews) {
    breakdown.글로벌수출 = 5;
  } else {
    breakdown.글로벌수출 = 0;
  }

  // 최대 배점 정의
  const maxScores = {
    라운드별투자금액: 20, 투자자티어: 12, 투자금액상승: 4, 후속참여: 4,
    매출규모: 12, 매출성장률: 13, 영업이익률: 15,
    핵심특허: 5, 글로벌수출: 15,
  };

  const vcKeys = ['라운드별투자금액', '투자자티어', '투자금액상승', '후속참여'];
  const dartKeys = ['매출규모', '매출성장률', '영업이익률'];

  return normalizeScore(breakdown, maxScores, { hasVC, hasDart }, vcKeys, dartKeys);
}

// ─── 바이오 메인 함수 ───

function scoreBio(company) {
  const type = detectBioType(company);
  if (type === 'BIOTECH') return scoreBiotech(company);
  return scoreNewdrug(company);
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

    // null이면 데이터 부족 처리
    if (rawScore === null) {
      return {
        score: null,
        rawScore: null,
        dataStatus: '데이터부족',
        sectorPremium: 1.0,
        premiumScore: null,
        breakdown: scoreResult.breakdown,
        breakdownStr: '데이터 부족으로 점수 산출 불가',
        bonus: 0,
        bonusPoints: 0,
      };
    }

    const cappedRaw = Math.min(100, rawScore);
    const premiumScore = cappedRaw * sectorPremium;

    // 10점 만점 환산 (프리미엄 적용 후 최대 13점 → 10점 cap)
    const finalScore = Math.round((premiumScore / 100) * 10 * 10) / 10;
    const cappedScore = Math.min(10, Math.max(0, finalScore));

    // ── 추가 가감점 ──
    let bonusPoints = 0;

    // 16-1. 투자자 티어 가산
    const investorTier = company.investorTier || {};
    const leadTier = investorTier.leadTier;
    if (leadTier === 'T1') bonusPoints += 1.0;
    else if (leadTier === 'T2') bonusPoints += 0.5;
    else if (leadTier === 'CVC') bonusPoints += 0.8;
    else if (leadTier === '정책금융') bonusPoints += 0.7;

    // 16-2. 밸류소스 신뢰도 가중 (rawScore의 밸류 관련 점수에 적용)
    // 이미 scoreResult.total에 반영된 상태이므로 여기서는 패널티만 적용
    const valuSource = company.valuation?.valuationSource || company.valuSource;
    if (valuSource === 'VC-역산') bonusPoints -= 0.2; // 80% 신뢰
    else if (valuSource === '시세기반') bonusPoints -= 0.2;
    else if (!valuSource && !company.valuation?.fairValue) bonusPoints -= 0.5; // 밸류 없음

    // 16-3. 밸류 상승률 가산
    const rounds = company.vcHistory?.rounds || [];
    if (rounds.length >= 2) {
      const cur = parseFloat(rounds[0].valuation) || 0;
      const prev = parseFloat(rounds[1].valuation) || 0;
      if (cur > 0 && prev > 0) {
        const growthRate = ((cur - prev) / prev) * 100;
        if (growthRate >= 200) bonusPoints += 0.5;
        else if (growthRate >= 100) bonusPoints += 0.3;
        else if (growthRate >= 50) bonusPoints += 0.1;
        else if (growthRate < 0) bonusPoints -= 0.5; // 다운라운드
      }
    }

    // 16-4. 후속투자 가산
    const followOn = company.followOn || {};
    const followOnScore = followOn.followOnScore || 0;
    if (followOnScore >= 10) bonusPoints += 0.5; // 3연속+
    else if (followOnScore >= 5) bonusPoints += 0.3; // 2연속

    // 16-5. 크로스체크 보정
    const crossCheck = company.crossCheck || {};
    if (crossCheck.deviation !== undefined) {
      if (crossCheck.deviation < 10) bonusPoints += 0.2; // 일치
      else if (crossCheck.deviation >= 20) bonusPoints -= 0.3; // 불일치
    }

    // 최종 점수
    const finalWithBonus = Math.min(10, Math.max(0, Math.round((cappedScore + bonusPoints) * 10) / 10));

    // 점수 세부내역 문자열 생성
    const breakdownStr = Object.entries(scoreResult.breakdown)
      .map(([k, v]) => `${k}:${v}`)
      .join(' | ');

    return {
      score: finalWithBonus,
      rawScore,
      dataStatus: scoreResult.dataStatus || 'VC+DART',
      sectorPremium,
      premiumScore: Math.round(premiumScore),
      breakdown: scoreResult.breakdown,
      breakdownStr,
      bonus: scoreResult.bonus || 0,
      bonusPoints, // 새 가감점 합계
    };
  } catch (err) {
    console.error('[scoreEngine] 점수 계산 실패:', err.message);
    return { score: 0, rawScore: 0, sectorPremium: 1.0, premiumScore: 0, breakdown: {}, breakdownStr: '', bonus: 0 };
  }
}

module.exports = { calculateScore };
