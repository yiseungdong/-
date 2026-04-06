const Anthropic = require('@anthropic-ai/sdk');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 뉴스 기사 목록에서 투자유치 관련 회사명 추출
 * 최소 2건 이상 언급된 회사만 반환
 */
function extractCompanyList(articles) {
  const companyCount = {};

  for (const article of articles) {
    // companyHints에서 추출
    if (article.companyHints && article.companyHints.length > 0) {
      for (const hint of article.companyHints) {
        const name = hint.trim();
        if (name.length >= 2 && name.length <= 20) {
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
        if (name.length >= 2 && name.length <= 20) {
          companyCount[name] = (companyCount[name] || 0) + 1;
        }
      }
    }
  }

  // 최소 2건 이상 언급된 회사만 추출, 중복 제거
  const companies = Object.entries(companyCount)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  console.log(`[analyzer] 회사 ${companies.length}개 추출 (2건 이상 언급)`);
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
    patentResults = {},
    regulationResults = {},
    priceResults = {},
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

    const data = {
      articles,
      financials: dartResults[companyName] || null,
      patents: patentResults[companyName] || null,
      regulations: regulationResults[companyName] || null,
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
