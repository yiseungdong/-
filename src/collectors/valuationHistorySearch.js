const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SEARCH_PATTERNS = (name) => [
  `${name} 투자유치`,
  `${name} 시리즈`,
  `${name} 밸류에이션`,
  `${name} 기업가치`,
];

/**
 * 네이버 뉴스 API로 과거 기사 검색
 */
async function searchPastArticles(companyName) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  const allArticles = [];
  const seenUrls = new Set();

  for (const query of SEARCH_PATTERNS(companyName)) {
    try {
      const response = await axios.get('https://openapi.naver.com/v1/search/news.json', {
        params: { query, display: 100, sort: 'date' },
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
        },
        timeout: 10000,
      });

      for (const item of response.data.items || []) {
        const url = item.link || item.originallink;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          allArticles.push({
            title: item.title.replace(/<[^>]+>/g, ''),
            description: (item.description || '').replace(/<[^>]+>/g, ''),
            link: url,
            pubDate: item.pubDate,
          });
        }
      }
      await sleep(500);
    } catch (err) {
      console.error(`[valuationHistory] 검색 실패 ("${query}"):`, err.message);
    }
  }

  console.log(`[valuationHistory] "${companyName}" 과거 기사 ${allArticles.length}건`);
  return allArticles;
}

/**
 * Claude API로 과거 기사에서 라운드별 정보 추출
 */
async function extractHistoryFromArticles(companyName, articles) {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || articles.length === 0) return [];

  const client = new Anthropic({ apiKey });
  const articleText = articles.slice(0, 50).map(a => `[${a.pubDate}] ${a.title}`).join('\n');

  const prompt = `아래는 "${companyName}" 관련 과거 뉴스 기사 목록이야.
시간순으로 투자 라운드별 정보를 추출해줘. 반드시 JSON만 응답:

[
  {
    "date": "2024-03-15",
    "round": "시리즈B",
    "valuation": 1500,
    "valuationType": "포스트밸류",
    "valuationSource": "VC-직접",
    "investmentAmount": 200,
    "leadInvestor": "소프트뱅크",
    "coInvestors": ["캡스톤"],
    "investmentType": "보통주",
    "sourceTitle": "기사 제목"
  }
]

규칙:
- 같은 라운드의 중복 기사는 하나로 합치기
- 밸류가 없으면 null
- 날짜는 기사 발행일 기준
- 최대 10개 라운드까지

---
${articleText}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return [];
  } catch (err) {
    console.error(`[valuationHistory] Claude 추출 실패 (${companyName}):`, err.message);
    return [];
  }
}

/**
 * 크로스체크: 같은 라운드에 밸류 차이가 20% 이상이면 플래그
 */
function crossCheckRounds(rounds, externalData) {
  for (const round of rounds) {
    if (!round.valuation) continue;

    // 같은 라운드의 외부 데이터와 비교
    const extMatch = (externalData || []).find(e =>
      e.roundName === round.round || e.round === round.round
    );

    if (extMatch && extMatch.valuation) {
      const extVal = parseFloat(extMatch.valuation);
      const diff = Math.abs(round.valuation - extVal) / Math.max(round.valuation, extVal);
      if (diff >= 0.2) {
        const minVal = Math.min(round.valuation, extVal);
        const maxVal = Math.max(round.valuation, extVal);
        round.crossCheckFlag = `밸류 불일치: ${minVal}~${maxVal}억`;
      }
    }
  }
  return rounds;
}

/**
 * 메인: 회사의 밸류 히스토리 소급 검색
 */
async function searchValuationHistory(companyName, externalData) {
  try {
    // 1. 과거 기사 검색
    const articles = await searchPastArticles(companyName);
    if (articles.length === 0) {
      return { companyName, history: [], valuationTrend: '정보부족' };
    }

    // 2. Claude API로 라운드별 추출
    const rounds = await extractHistoryFromArticles(companyName, articles);

    // 3. 시간순 정렬
    rounds.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // 4. 크로스체크
    crossCheckRounds(rounds, externalData);

    // 5. 밸류 추세 판단
    const valuations = rounds.filter(r => r.valuation).map(r => r.valuation);
    let valuationTrend = '정보부족';
    if (valuations.length >= 2) {
      valuationTrend = valuations[valuations.length - 1] > valuations[0] ? '상승' : '하락';
    }

    return { companyName, history: rounds, valuationTrend };
  } catch (err) {
    console.error(`[valuationHistory] "${companyName}" 소급 검색 실패:`, err.message);
    return { companyName, history: [], valuationTrend: '정보부족' };
  }
}

module.exports = { searchValuationHistory };
