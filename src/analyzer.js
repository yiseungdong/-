const Anthropic = require('@anthropic-ai/sdk');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Claude API 1회 호출로 뉴스 기사에서 비상장 투자유치 회사명 추출
 * 비용: ~$0.01/일 (입력 ~3000토큰 + 출력 ~500토큰)
 */
async function extractCompanyList(articles) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[analyzer] CLAUDE_API_KEY가 .env에 없습니다.');
    return [];
  }

  if (articles.length === 0) {
    console.log('[analyzer] 기사가 없어 회사 추출 불가.');
    return [];
  }

  const client = new Anthropic({ apiKey });

  // 기사 제목만 모아서 전달 (토큰 절약)
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
      model: 'claude-sonnet-4-6-20250514',
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
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('JSON 파싱 실패');
}

/**
 * 전체 분석 파이프라인
 * 회사 목록은 외부에서 이미 확정된 상태로 전달받음
 */
async function analyze(collectedData) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('[analyzer] CLAUDE_API_KEY가 .env에 없습니다.');
    return [];
  }

  const client = new Anthropic({ apiKey });

  const {
    confirmedCompanies = [],
    articles = [],
    dartResults = {},
    priceResults = {},
    companyInfoResults = {},
  } = collectedData;

  if (confirmedCompanies.length === 0) {
    console.log('[analyzer] 분석할 회사가 없습니다.');
    return [];
  }

  console.log(`[analyzer] ${confirmedCompanies.length}개 회사 분석 시작`);
  const results = [];

  for (const company of confirmedCompanies) {
    const companyName = company.name || company;
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

    const corpCode = company.corpCode || null;
    const dartStatus = company.dartStatus || '';

    if (analysis) {
      results.push({
        companyName,
        corpCode,
        dartStatus,
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
        corpCode,
        dartStatus,
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
