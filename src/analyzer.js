const Anthropic = require('@anthropic-ai/sdk');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 회사명이 아닌 일반 키워드 필터
const NOISE_WORDS = new Set([
  'VC', '스타트업', '투자', '시리즈', '비상장', '벤처', '액셀러레이터',
  '프리IPO', 'IPO', 'TIPS', 'CES', 'MWC', 'KVCA', 'AI', 'IT',
  '더벨', '한국경제', '매일경제', '조선비즈', '뉴스', '기자', '특파원',
  '데모데이', '네이버', '카카오', '삼성', '현대', 'LG', 'SK',
  '금융위', '과기부', '식약처', '정부', '국내', '해외', '글로벌',
  '바이오', '핀테크', '플랫폼', '유니콘', '기업', '회사', '대표',
  '상장', '코스닥', '코스피', '증권', '투자자', '펀드', '자금',
  '억원', '조원', '만원', '달러', '기술', '서비스', '솔루션',
  '올해', '내년', '지난해', '최근', '국내외', '관련', '이상',
  'PoC', 'AC', 'IB', 'LP', 'GP', 'IR', 'PE', 'M&A', 'RCPS', 'CB',
  '단독', '속보', '현지시간', '규모', '이번', '결과', '대상', '부문',
  '4YFN', '4YFN관', '팁스', '모태', '정시출자', '출자',
  '벤처캐피탈', '복수의결권', '인터뷰', '기업家', 'K-water',
  '유통가 레이더', '브리프', '마켓인', '모여', 'Meet-up',
  '넘버스', '모두의 창업', '팁스(TIPS)',
  '종합', '인공지능', '데카콘', '유니콘팩토리', '프리 IPO', 'CES 등',
  'K-엔비디아', '리스팅', '스케일업', '지원사업', 'Demoday',
  '기자수첩', '석간', '선택과 집중',
]);

/**
 * 회사명으로 유효한지 검증
 */
function isValidCompanyName(name) {
  if (NOISE_WORDS.has(name)) return false;
  // 길이 제한: 한글 2~10자 또는 영문 3~15자 혼합
  if (name.length < 2 || name.length > 15) return false;
  // URL, 경로, 특수문자 포함 시 제외
  if (/[/.:\\?!]/.test(name)) return false;
  // 숫자로만 또는 숫자+단위로 구성된 경우 제외
  if (/^\d+$/.test(name)) return false;
  if (/^\d+억$/.test(name) || /^\d+조$/.test(name) || /^\d+만$/.test(name)) return false;
  // 공백 2개 이상이면 문장형 → 제외
  if ((name.match(/\s/g) || []).length >= 2) return false;
  // 영문 1~3글자 약어 제외 (NST, MWC 등)
  if (/^[A-Za-z]{1,3}$/.test(name)) return false;
  // 영문+숫자 조합 짧은 코드 제외 (MWC 2026 등)
  if (/^[A-Za-z]{1,4}\s*\d{2,4}$/.test(name)) return false;
  // 한글이 전혀 없고 영문도 4자 미만이면 제외
  if (!/[가-힣]/.test(name) && name.replace(/[^A-Za-z]/g, '').length < 4) return false;
  // "~투자", "~선택권", "~유치" 등 일반명사 패턴 제외
  if (/(?:투자$|유치$|선택권$|풍향계$|로드쇼$|프로젝트$|레이더$|의결권$)/.test(name)) return false;
  // 괄호 포함 이름 제외
  if (/[()（）]/.test(name)) return false;
  // 영문 이름 패턴 (이름 성 형태) 제외
  if (/^[A-Z][a-z]+\s[A-Z][a-z]+/.test(name)) return false;
  // "K-" 접두어 일반명사 제외
  if (/^K-(?!스타트업)/.test(name) && !/[가-힣]/.test(name)) return false;
  // 연도 포함 이벤트명 제외
  if (/\d{4}$/.test(name)) return false;
  // 순수 숫자+한글 혼합 (27타수 등) 제외
  if (/^\d+[가-힣]/.test(name)) return false;
  // 한 글자 일반명사 제외
  if (/^[가-힣]{1}$/.test(name)) return false;
  // 일반 보통명사 2글자 (현장, 올해 등) — 한글 2글자이면서 회사명으로 보기 어려운 것
  const commonNouns2 = ['현장', '올해', '내년', '작년', '시장', '성장', '기반', '확대', '강화'];
  if (commonNouns2.includes(name)) return false;
  return true;
}

/**
 * 뉴스 기사 목록에서 투자유치 관련 회사명 추출
 * 노이즈 필터링 후 최소 2건 이상 언급된 회사만 반환 (상위 20개)
 */
function extractCompanyList(articles) {
  const companyCount = {};

  for (const article of articles) {
    // companyHints에서 추출
    if (article.companyHints && article.companyHints.length > 0) {
      for (const hint of article.companyHints) {
        const name = hint.trim();
        if (isValidCompanyName(name)) {
          companyCount[name] = (companyCount[name] || 0) + 1;
        }
      }
    }

    // 제목에서 추가 추출: "OOO, 시리즈A" 패턴
    const titlePatterns = [
      /([가-힣A-Za-z0-9]+)[,·]?\s*(?:시리즈|투자유치|기업가치|프리IPO)/g,
      /(?:시리즈[A-Z]|투자유치|VC투자)[^가-힣]*([가-힣]{2,10})/g,
    ];

    for (const pattern of titlePatterns) {
      let match;
      while ((match = pattern.exec(article.title)) !== null) {
        const name = match[1].trim();
        if (isValidCompanyName(name)) {
          companyCount[name] = (companyCount[name] || 0) + 1;
        }
      }
    }
  }

  // 최소 2건 이상, 언급 횟수 순 정렬, 상위 20개만
  const MAX_COMPANIES = 20;
  const companies = Object.entries(companyCount)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_COMPANIES)
    .map(([name]) => name);

  console.log(`[analyzer] 회사 ${companies.length}개 추출 (상위 ${MAX_COMPANIES}개, 2건 이상 언급)`);
  return companies;
}

/**
 * Claude API로 회사별 종합 분석
 */
async function analyzeCompany(client, companyName, data) {
  const { articles, financials, patents, regulations, price } = data;

  // 관련 기사 필터링
  const relatedArticles = articles.filter(
    (a) =>
      a.title.includes(companyName) ||
      a.description.includes(companyName) ||
      (a.companyHints && a.companyHints.includes(companyName))
  );

  const prompt = `당신은 비상장 기업 투자 분석 전문가입니다. 아래 데이터를 종합 분석하여 JSON으로 응답하세요.

## 분석 대상: ${companyName}

## 수집된 뉴스 (${relatedArticles.length}건)
${relatedArticles
  .slice(0, 15)
  .map((a) => `- [${a.pubDate}] ${a.title}\n  ${a.description}`)
  .join('\n')}

## DART 재무 데이터
${financials ? JSON.stringify(financials, null, 2) : '데이터 없음'}

## 특허 정보
${patents ? `총 ${patents.totalCount}건\n${patents.patents.slice(0, 10).map((p) => `- ${p.title} (${p.applicationDate})`).join('\n')}` : '데이터 없음'}

## 규제/허가 현황
${regulations ? regulations.regulations.slice(0, 10).map((r) => `- [${r.status}] ${r.title}`).join('\n') : '데이터 없음'}

## 비상장 거래가격
${price ? JSON.stringify(price, null, 2) : '데이터 없음'}

## 응답 형식 (반드시 JSON만 출력)
{
  "industry": "바이오/핀테크/IT/커머스/기타 중 택1",
  "basicInfo": {
    "foundedYear": "설립연도 또는 알수없음",
    "ceo": "대표자 또는 알수없음",
    "mainProduct": "주요 제품·서비스"
  },
  "vcHistory": {
    "rounds": [
      {
        "roundName": "시리즈A",
        "amount": "투자금액 (억원 단위 숫자)",
        "valuation": "기업가치 (억원 단위 숫자)",
        "date": "YYYY.MM",
        "investors": ["VC1", "VC2"]
      }
    ],
    "totalRaised": "누적 투자총액 (억원)",
    "valuationGrowth": "직전 라운드 대비 밸류 상승률 (%)"
  },
  "score": 7,
  "strengths": ["강점1", "강점2", "강점3"],
  "risks": ["리스크1", "리스크2", "리스크3"],
  "ipoOutlook": "IPO 가능성 및 예상 시점"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text;
  // JSON 추출 (```json 블록 또는 직접 JSON)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('JSON 파싱 실패');
}

/**
 * 전체 분석 파이프라인
 * @param {Object} collectedData - 수집된 전체 데이터
 * @returns {Array} 회사별 분석 결과 배열
 */
async function analyze(collectedData) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[analyzer] CLAUDE_API_KEY가 .env에 없습니다.');
    return [];
  }

  const client = new Anthropic({ apiKey });

  const {
    articles = [],
    dartResults = {},
    priceResults = {},
    companyInfoResults = {},
  } = collectedData;

  // 1. 회사 목록 추출
  const companies = extractCompanyList(articles);
  if (companies.length === 0) {
    console.log('[analyzer] 분석할 회사가 없습니다.');
    return [];
  }

  console.log(`[analyzer] ${companies.length}개 회사 분석 시작`);
  const results = [];

  for (const companyName of companies) {
    console.log(`[analyzer] "${companyName}" 분석 중...`);

    const info = companyInfoResults[companyName] || {};
    const data = {
      articles,
      financials: dartResults[companyName] || null,
      patents: info.patents || null,
      regulations: info.regulations || null,
      price: priceResults[companyName] || null,
    };

    let analysis = null;
    let retries = 0;

    while (retries < 2) {
      try {
        analysis = await analyzeCompany(client, companyName, data);
        break;
      } catch (err) {
        retries++;
        if (retries < 2) {
          console.log(`[analyzer] "${companyName}" 재시도 (${retries}/1)...`);
          await sleep(3000);
        } else {
          console.error(`[analyzer] "${companyName}" 분석 실패:`, err.message);
        }
      }
    }

    // 관련 기사 출처 수집
    const sources = articles
      .filter(
        (a) =>
          a.title.includes(companyName) ||
          a.description.includes(companyName)
      )
      .slice(0, 10)
      .map((a) => ({ title: a.title, link: a.link, date: a.pubDate }));

    if (analysis) {
      results.push({
        companyName,
        industry: analysis.industry || '기타',
        basicInfo: analysis.basicInfo || {},
        vcHistory: analysis.vcHistory || {},
        patents: data.patents || { totalCount: 0, patents: [] },
        regulations: data.regulations || { regulations: [] },
        price: data.price || null,
        score: analysis.score || 0,
        strengths: analysis.strengths || [],
        risks: analysis.risks || [],
        ipoOutlook: analysis.ipoOutlook || '판단 불가',
        sources,
      });
    } else {
      results.push({
        companyName,
        industry: '기타',
        basicInfo: {},
        vcHistory: {},
        patents: data.patents || { totalCount: 0, patents: [] },
        regulations: data.regulations || { regulations: [] },
        price: data.price || null,
        score: 0,
        strengths: ['분석 실패'],
        risks: ['분석 실패'],
        ipoOutlook: '분석 실패',
        sources,
      });
    }

    await sleep(3000);
  }

  console.log(`[analyzer] 총 ${results.length}개 회사 분석 완료`);
  return results;
}

module.exports = { analyze, extractCompanyList };
