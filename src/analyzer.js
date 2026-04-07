const Anthropic = require('@anthropic-ai/sdk');
const { classifySector, calculateGrowthGrade } = require('./sectorClassifier');
const { matchPeerGroup } = require('./peerGroupMatcher');
const { calculateFairValue } = require('./valuationEngine');
const { calculateScore: calculateSectorScore } = require('./scoreEngine');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claude API 1회 호출로 뉴스 기사에서 비상장 투자유치 회사명 추출
 * 비용: ~$0.01/일
 */
async function extractCompanyList(articles) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[analyzer] CLAUDE_API_KEY가 .env에 없습니다.');
    return [];
  }

  if (articles.length === 0) return [];

  const client = new Anthropic({ apiKey });

  const titleList = articles
    .slice(0, 200)
    .map((a) => a.title)
    .join('\n');

  const prompt = `아래는 오늘 수집된 비상장/스타트업 투자 관련 뉴스 제목 목록입니다.
이 중에서 **투자유치(시리즈A~C, 프리IPO 등)를 한 비상장 회사명**만 추출하세요.

규칙:
- 실제 회사명(법인명 또는 브랜드명)만 추출
- "카카오", "네이버", "삼성" 등 대기업/상장사 제외
- "VC", "스타트업", "시리즈A" 등 일반명사 제외
- 언론사명(더벨, 한국경제 등) 제외
- 최대 20개까지만

반드시 아래 JSON 형식으로만 응답:
["회사명1", "회사명2", "회사명3"]

---
${titleList}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const companies = JSON.parse(match[0]);
      console.log(`[analyzer] Claude API로 회사 ${companies.length}개 추출`);
      return companies.slice(0, 20);
    }
    console.error('[analyzer] Claude 응답 파싱 실패');
    return [];
  } catch (err) {
    console.error('[analyzer] 회사명 추출 실패:', err.message);
    return [];
  }
}

// 분석 실패 시 기본값
function defaultAnalysis(companyName) {
  return {
    industry: null,
    basicInfo: {
      foundedYear: null,
      ceo: null,
      mainProduct: null,
      estimatedValue: null,
    },
    vcHistory: {
      rounds: [],
      totalRaised: null,
      valuationGrowth: null,
    },
    fairValuation: null,
    growthGrade: null,
    profile: {
      oneLineIntro: null,
      coreTechnology: null,
      coreCompetency: null,
      targetMarket: null,
      keyClients: null,
      businessModel: null,
      competitors: null,
      growthStrategy: null,
      mainProducts: null,
    },
    strengths: [],
    risks: [],
    ipoOutlook: null,
  };
}

/**
 * Claude API 회사당 1번 호출하여 분석
 */
async function analyzeOne(client, company) {
  const prompt = `아래는 오늘 노출된 비상장 회사 ${company.name}의 수집 데이터야.
아래 항목을 분석해서 반드시 JSON 형식으로만 응답해줘 (다른 텍스트 금지):

{
  "industry": "업종 (바이오/핀테크/IT/커머스/제조/기타 중 하나)",
  "basicInfo": {
    "foundedYear": "설립연도 (모르면 null)",
    "ceo": "대표자 (모르면 null)",
    "mainProduct": "주요 제품·서비스 한 줄 설명",
    "estimatedValue": "추정 기업가치 (억원, 모르면 null)"
  },
  "vcHistory": {
    "rounds": [
      {
        "roundName": "라운드명",
        "amount": "투자금액(억원)",
        "valuation": "밸류에이션(억원)",
        "date": "날짜",
        "investors": ["VC1", "VC2"]
      }
    ],
    "totalRaised": "누적 투자총액(억원)",
    "valuationGrowth": "직전 라운드 대비 밸류 상승률(%)"
  },
  "fairValuation": "적정 밸류에이션(억원, 업종·성장성·매출 기반 추정, 모르면 null)",
  "growthGrade": "성장성등급 (S/A/B/C/D 중 하나, S=초고성장 A=고성장 B=안정성장 C=저성장 D=정체/역성장)",
  "profile": {
    "oneLineIntro": "한 문장으로 무엇하는 회사인지",
    "coreTechnology": "핵심 기술 (2~3줄)",
    "coreCompetency": "핵심 경쟁력 (경쟁사 대비 강점 2~3줄)",
    "targetMarket": "타겟 시장/고객",
    "keyClients": "주요 고객사 (없으면 null)",
    "businessModel": "비즈니스 모델 (수익 구조)",
    "competitors": "주요 경쟁사",
    "growthStrategy": "성장 전략 (2~3줄)",
    "mainProducts": "주요 제품/서비스"
  },
  "strengths": ["강점1", "강점2", "강점3"],
  "risks": ["리스크1", "리스크2", "리스크3"],
  "ipoOutlook": "IPO 가능성 및 예상 시점 한 줄"
}

수집 데이터:
- 노출이유: ${company.reason || '뉴스 기반 발굴'}
- 관련기사: ${company.source || '없음'}
- 재무정보: ${company.financials ? JSON.stringify(company.financials.financials || company.financials) : '없음'}
- 특허수: ${company.patents ? company.patents.totalCount || 0 : 0}건
- 규제현황: ${company.regulations ? JSON.stringify(company.regulations.regulations || company.regulations).slice(0, 500) : '없음'}
- 비상장가격: ${company.price ? JSON.stringify({ price38: company.price.price38, pricePlus: company.price.pricePlus, status: company.price.status }) : '없음'}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  // ```json 코드블록 자동 제거
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      throw new Error(`JSON 파싱 실패: ${parseErr.message}`);
    }
  }
  throw new Error('JSON 응답 블록 없음');
}

/**
 * 회사 목록을 Claude API로 분석
 * @param {Array} companies - collectors/index.js가 반환한 회사별 데이터
 * @returns {Array} 분석 결과가 병합된 회사 데이터
 */
async function analyze(companies) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[analyzer] CLAUDE_API_KEY가 .env에 없습니다.');
    return companies.map((c) => ({ ...c, ...defaultAnalysis(c.name) }));
  }

  const client = new Anthropic({ apiKey });
  const results = [];

  for (const company of companies) {
    console.log(`[analyzer] "${company.name}" 분석 중...`);

    let analysis = null;
    let retries = 0;

    // 1회 재시도
    while (retries < 2) {
      try {
        analysis = await analyzeOne(client, company);
        break;
      } catch (err) {
        retries++;
        if (retries < 2) {
          console.log(`[analyzer] "${company.name}" 재시도...`);
          await sleep(3000);
        } else {
          console.error(`[analyzer] "${company.name}" 분석 실패:`, err.message);
        }
      }
    }

    // 기존 데이터에 분석 결과 병합
    let analyzedCompany;
    if (analysis) {
      analyzedCompany = { ...company, ...analysis };
    } else {
      analyzedCompany = { ...company, ...defaultAnalysis(company.name) };
    }

    // 섹터 분류 + 성장성 등급 + 피어그룹 + 적정밸류
    try {
      const sectorResult = await classifySector(company);
      const growthGradeResult = calculateGrowthGrade(analyzedCompany);
      const peerData = await matchPeerGroup(sectorResult.sectorCode, growthGradeResult.grade);

      analyzedCompany.sectorCode = sectorResult.sectorCode;
      analyzedCompany.sectorName = sectorResult.sectorName;
      analyzedCompany.growthGrade = growthGradeResult.grade;
      analyzedCompany.growthGradeDetail = growthGradeResult;
      analyzedCompany.peerGroup = peerData;

      const valuationResult = calculateFairValue(
        { ...analyzedCompany, sectorCode: sectorResult.sectorCode },
        peerData
      );
      analyzedCompany.fairValuation = valuationResult.fairValue;
      analyzedCompany.valuation = valuationResult;

      // industry를 섹터명으로 통일
      if (sectorResult.sectorName && sectorResult.sectorName !== '기타') {
        analyzedCompany.industry = sectorResult.sectorName;
      }
    } catch (err) {
      console.error(`[analyzer] "${company.name}" 섹터/밸류 분석 실패:`, err.message);
    }

    // 섹터별 매력도 점수 계산 (scoreEngine)
    const scoreResult = await calculateSectorScore(analyzedCompany);
    analyzedCompany.score = scoreResult.score;
    analyzedCompany.rawScore = scoreResult.rawScore;
    analyzedCompany.sectorPremium = scoreResult.sectorPremium;
    analyzedCompany.scoreBreakdown = scoreResult.breakdown;
    analyzedCompany.scoreBreakdownStr = scoreResult.breakdownStr;

    results.push(analyzedCompany);

    await sleep(3000);
  }

  console.log(`[analyzer] ${results.length}개 회사 분석 완료`);
  return results;
}

/**
 * 규칙 기반 매력도 점수 계산 (100점 만점 → 10점 환산)
 */
function calculateScore(company) {
  try {
  let total = 0;
  const breakdown = {};

  // 1. 투자 라운드 단계 (15점)
  const roundName = (company.vcHistory?.rounds?.[0]?.roundName || '').toLowerCase();
  let roundScore = 0;
  if (roundName.includes('프리ipo') || roundName.includes('브릿지')) roundScore = 15;
  else if (roundName.includes('시리즈c') || roundName.includes('series c')) roundScore = 13;
  else if (roundName.includes('시리즈b') || roundName.includes('series b')) roundScore = 10;
  else if (roundName.includes('시리즈a') || roundName.includes('series a')) roundScore = 6;
  else if (roundName.includes('시드') || roundName.includes('seed') || roundName.includes('엔젤')) roundScore = 3;
  breakdown.round = roundScore;
  total += roundScore;

  // 2. 투자금액 (15점)
  const amount = parseFloat(company.vcHistory?.rounds?.[0]?.amount) || 0;
  let amountScore = 0;
  if (amount >= 300) amountScore = 15;
  else if (amount >= 100) amountScore = 12;
  else if (amount >= 50) amountScore = 9;
  else if (amount >= 10) amountScore = 6;
  else if (amount > 0) amountScore = 3;
  breakdown.amount = amountScore;
  total += amountScore;

  // 3. 밸류에이션 (10점)
  const valuation = parseFloat(company.vcHistory?.rounds?.[0]?.valuation) || 0;
  let valuationScore = 0;
  if (valuation >= 5000) valuationScore = 10;
  else if (valuation >= 1000) valuationScore = 8;
  else if (valuation >= 500) valuationScore = 6;
  else if (valuation >= 100) valuationScore = 4;
  else if (valuation > 0) valuationScore = 2;
  breakdown.valuation = valuationScore;
  total += valuationScore;

  // 4. 참여 VC 티어 (10점)
  const topTierVCs = ['소프트뱅크', 'imm', '카카오벤처스', '네이버', 'kdb', '한국투자파트너스',
    '스톤브릿지', 'kb인베스트먼트', '한화투자', 'lg테크놀로지', '삼성벤처투자',
    'sk', 'nhn', '카카오', '현대'];
  const midTierVCs = ['스파크랩', '블루포인트', '퓨처플레이', '본엔젤스', '캡스톤',
    '매쉬업엔젤스', '프라이머', '해시드', '디캠프'];

  const investors = (company.vcHistory?.rounds || [])
    .flatMap(r => r.investors || [])
    .map(v => v.toLowerCase());

  let vcScore = 0;
  const hasTopTier = investors.some(v => topTierVCs.some(t => v.includes(t.toLowerCase())));
  const hasMidTier = investors.some(v => midTierVCs.some(t => v.includes(t.toLowerCase())));

  if (hasTopTier) vcScore = 10;
  else if (hasMidTier) vcScore = 5;
  else if (investors.length > 0) vcScore = 3;
  breakdown.vc = vcScore;
  total += vcScore;

  // 5. 직전 라운드 대비 밸류 상승률 (20점)
  const growthStr = company.vcHistory?.valuationGrowth || '';
  const growthNum = parseFloat(String(growthStr).replace('%', '').replace('+', '')) || null;
  let valuationGrowthScore = 5; // 정보 없으면 기본 5점
  if (growthNum !== null) {
    if (growthNum >= 500) valuationGrowthScore = 20;
    else if (growthNum >= 200) valuationGrowthScore = 16;
    else if (growthNum >= 100) valuationGrowthScore = 12;
    else if (growthNum >= 30) valuationGrowthScore = 8;
    else valuationGrowthScore = 5;
  }
  breakdown.valuationGrowth = valuationGrowthScore;
  total += valuationGrowthScore;

  // 6. 매출 성장률 (20점)
  const revenueGrowth = company.financials?.financials?.[0]?.revenueGrowth || null;
  let revenueScore = 0;
  if (revenueGrowth !== null) {
    if (revenueGrowth >= 100) revenueScore = 20;
    else if (revenueGrowth >= 50) revenueScore = 16;
    else if (revenueGrowth >= 30) revenueScore = 12;
    else if (revenueGrowth >= 10) revenueScore = 8;
    else if (revenueGrowth > 0) revenueScore = 5;
  }
  breakdown.revenue = revenueScore;
  total += revenueScore;

  // 7. 보유 특허 수 (5점)
  const patentCount = company.patents?.totalCount || 0;
  let patentScore = 0;
  if (patentCount >= 21) patentScore = 5;
  else if (patentCount >= 6) patentScore = 3;
  else if (patentCount >= 1) patentScore = 2;
  breakdown.patents = patentScore;
  total += patentScore;

  // 8. 인증·허가 현황 (5점)
  const regCount = company.regulations?.regulations?.length || 0;
  let regScore = 0;
  if (regCount >= 3) regScore = 5;
  else if (regCount >= 2) regScore = 4;
  else if (regCount === 1) regScore = 2;
  breakdown.regulations = regScore;
  total += regScore;

  // 최종 점수 계산 (100점 → 10점 환산)
  const finalScore = Math.round((total / 100) * 10 * 10) / 10;

  return {
    score: finalScore,
    totalRaw: total,
    breakdown: {
      투자라운드: `${breakdown.round}/15`,
      투자금액: `${breakdown.amount}/15`,
      밸류에이션: `${breakdown.valuation}/10`,
      참여VC티어: `${breakdown.vc}/10`,
      밸류상승률: `${breakdown.valuationGrowth}/20`,
      매출성장률: `${breakdown.revenue}/20`,
      특허수: `${breakdown.patents}/5`,
      인증허가: `${breakdown.regulations}/5`,
    }
  };
  } catch (err) {
    console.error('[analyzer] 점수 계산 실패:', err.message);
    return { score: 0, totalRaw: 0, breakdown: {} };
  }
}

module.exports = { analyze, extractCompanyList };
