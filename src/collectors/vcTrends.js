const axios = require('axios');

const NAVER_NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';

// VC/박람회/데모데이 전용 키워드
const VC_KEYWORDS = [
  'VC 투자 스타트업 2026',
  'KVCA 투자',
  '벤처캐피탈 신규 투자',
  '스타트업 데모데이',
  'CES 한국 스타트업',
  'MWC 한국 스타트업',
  '팁스 TIPS 선정',
  '액셀러레이터 투자',
  '정부지원사업 스타트업 선정',
  '비상장 유니콘',
];

const PRIORITY_SOURCES = ['더벨', 'platum', '벤처스퀘어', '스타트업투데이', '한국경제'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

function extractCompanyHints(title, description) {
  const hints = new Set();
  const text = title + ' ' + description;

  // 괄호 안 이름 추출
  const bracketPattern = /[[(「]([^)\]」]+)[)\]」]/g;
  let match;
  while ((match = bracketPattern.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length >= 2 && name.length <= 20) {
      hints.add(name);
    }
  }

  // 따옴표 안 이름 추출
  const quotePattern = /[''""'"]([^''""'"]+)[''""'"]/g;
  while ((match = quotePattern.exec(text)) !== null) {
    const name = match[1].trim();
    if (name.length >= 2 && name.length <= 20) {
      hints.add(name);
    }
  }

  // "OOO, 투자유치" / "OOO 시리즈A" 패턴
  const investPatterns = [
    /([가-힣A-Za-z0-9]{2,15})[,·]?\s*(?:투자유치|시리즈[A-Z]|프리IPO|투자 ?받)/g,
    /(?:투자유치|시리즈[A-Z]|프리IPO)[^가-힣]*([가-힣]{2,10})/g,
    /([가-힣]{2,10})\s*(?:대표|CEO|CTO)/g,
  ];

  for (const pattern of investPatterns) {
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length >= 2 && name.length <= 15) {
        hints.add(name);
      }
    }
  }

  return [...hints];
}

function getSourcePriority(title, description) {
  const text = title + ' ' + description;
  for (let i = 0; i < PRIORITY_SOURCES.length; i++) {
    if (text.includes(PRIORITY_SOURCES[i])) return i;
  }
  return PRIORITY_SOURCES.length;
}

/**
 * VC/박람회/데모데이 뉴스에서 비상장 회사 발굴
 */
async function collectVcTrends() {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[vcTrends] NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 .env에 없습니다.');
    return [];
  }

  const allArticles = [];
  const seenUrls = new Set();

  for (const keyword of VC_KEYWORDS) {
    try {
      const response = await axios.get(NAVER_NEWS_URL, {
        params: {
          query: keyword,
          display: 100,
          start: 1,
          sort: 'date',
        },
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
          'User-Agent': 'UnlistedResearch/1.0',
        },
        timeout: 10000,
      });

      const items = response.data.items || [];
      for (const item of items) {
        const link = item.originallink || item.link;
        if (seenUrls.has(link)) continue;
        seenUrls.add(link);

        allArticles.push({
          title: stripHtml(item.title),
          link,
          description: stripHtml(item.description),
          pubDate: item.pubDate,
          source: keyword,
          companyHints: extractCompanyHints(
            stripHtml(item.title),
            stripHtml(item.description)
          ),
        });
      }

      console.log(`[vcTrends] "${keyword}" — ${items.length}건 수집`);
    } catch (err) {
      console.error(`[vcTrends] "${keyword}" 검색 실패:`, err.message);
    }

    await sleep(2000);
  }

  // 우선 소스 정렬
  allArticles.sort(
    (a, b) =>
      getSourcePriority(a.title, a.description) -
      getSourcePriority(b.title, b.description)
  );

  console.log(`[vcTrends] 총 ${allArticles.length}건 수집 완료 (중복 제거 후)`);
  return allArticles;
}

module.exports = { collectVcTrends };
