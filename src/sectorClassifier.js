const Anthropic = require('@anthropic-ai/sdk');

const SECTORS = {
  COMMERCE: '커머스·플랫폼',
  FINTECH: '핀테크·금융',
  MOBILITY: '모빌리티·물류',
  B2B_SAAS: 'B2B·SaaS',
  ENTERTAINMENT: '엔터·콘텐츠',
  BIO: '바이오·신약',
  MEDICAL_DEVICE: '의료기기',
  BEAUTY: '뷰티·헬스케어',
  DEEPTECH: '딥테크·AI'
};

const SECTOR_KEYWORDS = {
  COMMERCE: [
    '이커머스', '쇼핑', '커머스', '마켓플레이스', '플랫폼',
    '배달', '식품', '유통', 'O2O', '구독', '중고거래',
    '패션', '인테리어', '여행', '숙박', '부동산'
  ],
  FINTECH: [
    '핀테크', '금융', '결제', '송금', '대출', '보험',
    '투자', '자산관리', '블록체인', '암호화폐', '증권',
    '크라우드펀딩', 'P2P', '신용', '렌딩'
  ],
  MOBILITY: [
    '모빌리티', '물류', '배송', '운송', '자율주행',
    '전기차', '드론', '라스트마일', '풀필먼트', '창고',
    '주차', '카셰어링', '퀵배송'
  ],
  B2B_SAAS: [
    'SaaS', 'B2B', 'ERP', 'HR', 'CRM', '기업용',
    '클라우드', '마케팅테크', '애드테크', '자동화',
    '협업툴', '보안', '데이터분석', 'API'
  ],
  ENTERTAINMENT: [
    '엔터', '콘텐츠', '게임', '웹툰', '미디어', 'OTT',
    '음악', 'K팝', '아이돌', '스튜디오', '영화', '드라마',
    '메타버스', '크리에이터', '유튜브'
  ],
  BIO: [
    '바이오', '신약', '제약', '임상', '항암', '유전자',
    '세포치료', '항체', '단백질', '줄기세포', '마이크로바이옴',
    '신약개발', '파이프라인', '희귀질환'
  ],
  MEDICAL_DEVICE: [
    '의료기기', '진단', '영상', '수술로봇', '임플란트',
    '체외진단', '웨어러블', '디지털헬스', '원격의료',
    '의료AI', '방사선', '내시경'
  ],
  BEAUTY: [
    '뷰티', '화장품', '코스메틱', '스킨케어', '헬스케어',
    '건강기능식품', '영양제', '더마', '클린뷰티',
    '비건', 'K뷰티', '향수', '헤어케어'
  ],
  DEEPTECH: [
    'AI', '인공지능', '딥러닝', '머신러닝', '반도체',
    '로보틱스', '로봇', '우주', '양자', '소재',
    'NPU', 'GPU', '엣지AI', '컴퓨터비전', 'NLP',
    '자연어처리', '생성AI'
  ]
};

async function callClaude(prompt, maxTokens) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[sectorClassifier] CLAUDE_API_KEY가 .env에 없습니다.');
    return '';
  }
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0].text;
  } catch (err) {
    console.error('[sectorClassifier] Claude API 호출 실패:', err.message);
    return '';
  }
}

async function classifySector(company) {
  try {
    // 1차: 키워드 매칭으로 빠른 분류
    const text = `${company.name || ''} ${company.reason || ''} ${company.source || ''}`.toLowerCase();

    let maxScore = 0;
    let detectedSector = null;

    for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
      const score = keywords.filter(kw => text.includes(kw.toLowerCase())).length;
      if (score > maxScore) {
        maxScore = score;
        detectedSector = sector;
      }
    }

    // 2차: 키워드 매칭 불확실할 때 Claude AI로 판단
    if (maxScore < 2) {
      detectedSector = await classifyWithAI(company);
    }

    return {
      sectorCode: detectedSector,
      sectorName: SECTORS[detectedSector] || '기타',
      confidence: maxScore >= 2 ? 'high' : 'ai'
    };
  } catch (err) {
    console.error('[sectorClassifier] 섹터 분류 실패:', err.message);
    return { sectorCode: null, sectorName: '기타', confidence: 'error' };
  }
}

async function classifyWithAI(company) {
  const prompt = `
다음 비상장 회사의 섹터를 아래 9개 중 하나로 분류해줘.
반드시 아래 코드 중 하나만 응답해. 다른 텍스트 금지.

섹터 코드:
COMMERCE, FINTECH, MOBILITY, B2B_SAAS, ENTERTAINMENT,
BIO, MEDICAL_DEVICE, BEAUTY, DEEPTECH

회사명: ${company.name}
노출이유: ${company.reason || ''}
기사제목: ${company.source || ''}
  `;

  const response = await callClaude(prompt, 50);
  const sector = response.trim().toUpperCase();
  return Object.keys(SECTORS).includes(sector) ? sector : 'COMMERCE';
}

function calculateGrowthGrade(company) {
  try {
    let scores = [];

    // 1. 매출 성장률 점수
    const revenueGrowth = company.financials?.financials?.[0]?.revenueGrowth;
    if (revenueGrowth !== null && revenueGrowth !== undefined) {
      if (revenueGrowth >= 100) scores.push(5);
      else if (revenueGrowth >= 50) scores.push(4);
      else if (revenueGrowth >= 20) scores.push(3);
      else if (revenueGrowth >= 0) scores.push(2);
      else scores.push(1);
    }

    // 2. 밸류 상승률 점수
    const valuationGrowth = parseFloat(
      (company.vcHistory?.valuationGrowth || '0').replace('%', '').replace('+', '')
    );
    if (valuationGrowth >= 300) scores.push(5);
    else if (valuationGrowth >= 100) scores.push(4);
    else if (valuationGrowth >= 50) scores.push(3);
    else if (valuationGrowth >= 0) scores.push(2);
    else scores.push(1);

    // 3. 라운드 텀 점수
    const rounds = company.vcHistory?.rounds || [];
    if (rounds.length >= 2) {
      const latest = new Date(rounds[0].date);
      const prev = new Date(rounds[1].date);
      const monthsDiff = (latest - prev) / (1000 * 60 * 60 * 24 * 30);
      if (monthsDiff <= 6) scores.push(5);
      else if (monthsDiff <= 12) scores.push(4);
      else if (monthsDiff <= 24) scores.push(3);
      else if (monthsDiff <= 36) scores.push(2);
      else scores.push(1);
    }

    // 평균 점수로 등급 산출
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : 2.5;

    let grade;
    if (avgScore >= 4.5) grade = 'S';
    else if (avgScore >= 3.5) grade = 'A';
    else if (avgScore >= 2.5) grade = 'B';
    else if (avgScore >= 1.5) grade = 'C';
    else grade = 'D';

    return {
      grade,
      avgScore: Math.round(avgScore * 10) / 10,
      breakdown: {
        revenueGrowthScore: scores[0] || null,
        valuationGrowthScore: scores[1] || null,
        roundSpeedScore: scores[2] || null
      }
    };
  } catch (err) {
    console.error('[sectorClassifier] 성장성 등급 산출 실패:', err.message);
    return { grade: 'B', avgScore: 2.5, breakdown: {} };
  }
}

module.exports = { classifySector, calculateGrowthGrade, SECTORS, SECTOR_KEYWORDS };
