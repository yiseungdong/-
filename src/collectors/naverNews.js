const axios = require('axios');

const BASE_URL = 'https://openapi.naver.com/v1/search/news.json';
const KEYWORDS = [
  // 기존
  '투자유치 비상장',
  '시리즈A',
  '시리즈B',
  '시리즈C',
  '프리IPO',
  'VC투자 스타트업',
  '기업가치 비상장',
  '플래텀 투자유치',
  '스타트업레시피 투자',
  '유니콘팩토리',
  '스타트업 시리즈A',
  '스타트업 시리즈B',
  '스타트업 시리즈C',
  '스타트업 프리IPO',
  '비상장 기업가치',
  '비상장 밸류에이션',
  // 신규 추가
  '시드투자 스타트업',
  'Pre-A 투자',
  '엔젤투자 스타트업',
  '브릿지라운드',
  '시리즈D',
  '시리즈E',
  '후속투자 스타트업',
  '스타트업 시드',
  '초기투자 스타트업',
  '스타트업 누적투자',
  '벤처투자 유치',
  '스타트업 밸류에이션',
];

const PRIORITY_SOURCES = [
  '한국경제',
  '매일경제',
  '더벨',
  '서울경제',
  '벤처스퀘어',
  '플래텀',
  '블로터',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractCompanyHints(title, description) {
  const hints = new Set();
  // 괄호 안 이름 추출 (한글/영문)
  const bracketPattern = /[[(「]([^)\]」]+)[)\]」]/g;
  let match;
  while ((match = bracketPattern.exec(title + ' ' + description)) !== null) {
    hints.add(match[1].trim());
  }
  // 따옴표 안 이름 추출
  const quotePattern = /[''""'"]([^''""'"]+)[''""'"]/g;
  while ((match = quotePattern.exec(title + ' ' + description)) !== null) {
    const candidate = match[1].trim();
    if (candidate.length >= 2 && candidate.length <= 20) {
      hints.add(candidate);
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

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

async function collectNews() {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[naverNews] NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET이 .env에 없습니다.');
    return [];
  }

  const allArticles = [];
  const seenUrls = new Set();

  for (const keyword of KEYWORDS) {
    try {
      const response = await axios.get(BASE_URL, {
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

      console.log(`[naverNews] "${keyword}" — ${items.length}건 수집`);
    } catch (err) {
      console.error(`[naverNews] "${keyword}" 검색 실패:`, err.message);
    }

    await sleep(2000);
  }

  // 우선 소스 정렬
  allArticles.sort(
    (a, b) =>
      getSourcePriority(a.title, a.description) -
      getSourcePriority(b.title, b.description)
  );

  console.log(`[naverNews] 총 ${allArticles.length}건 수집 완료 (중복 제거 후)`);
  return allArticles;
}

module.exports = { collectNews };
