/**
 * rssCollector.js
 * 스타트업/투자 전문매체 RSS 피드 수집기
 * 네이버 뉴스 API를 보완하는 직접 수집 채널
 */
const axios = require('axios');

// RSS 피드 목록
const RSS_FEEDS = [
  {
    name: '플래텀',
    url: 'https://platum.kr/feed',
    priority: 1,
  },
  {
    name: '벤처스퀘어',
    url: 'https://www.venturesquare.net/feed',
    priority: 1,
  },
  {
    name: '스타트업레시피',
    url: 'https://startuprecipe.co.kr/feed',
    priority: 1,
  },
  {
    name: '한국경제_스타트업',
    url: 'https://www.hankyung.com/feed/it',
    priority: 2,
  },
  {
    name: '서울경제_IT',
    url: 'https://www.sedaily.com/RSS/S14',
    priority: 2,
  },
  {
    name: '블로터',
    url: 'https://www.bloter.net/feed',
    priority: 2,
  },
  {
    name: '유니콘팩토리',
    url: 'https://www.unicornfactory.co.kr/rss/allArticle.xml',
    priority: 1,
  },
];

// 투자 관련 키워드 필터 (RSS 기사 중 관련 기사만 추출)
const INVESTMENT_KEYWORDS = [
  '투자유치', '시리즈A', '시리즈B', '시리즈C', '시리즈D', '시리즈E',
  '프리IPO', '시드투자', 'Pre-A', '엔젤투자', '브릿지라운드',
  '벤처투자', '기업가치', '밸류에이션', '후속투자', '누적투자',
  'VC', '비상장', '스타트업 투자', '억원 투자', '억 투자',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// RSS XML 파싱 (외부 라이브러리 없이 정규식으로 처리)
function parseRssXml(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link') || extractTag(itemXml, 'guid');
    const description = extractTag(itemXml, 'description');
    const pubDate = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'dc:date');

    if (title && link) {
      items.push({ title, link, description, pubDate });
    }
  }

  return items;
}

function extractTag(xml, tag) {
  // CDATA 처리
  const cdataRegex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  // 일반 태그 처리
  const normalRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const normalMatch = normalRegex.exec(xml);
  if (normalMatch) return normalMatch[1].trim();

  return null;
}

function isInvestmentRelated(title, description) {
  const text = (title + ' ' + (description || '')).toLowerCase();
  return INVESTMENT_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

function extractCompanyHints(title, description) {
  const hints = new Set();
  const text = title + ' ' + (description || '');

  // 괄호 안 텍스트
  const bracketPattern = /[[(「]([^)\]」]{2,20})[)\]」]/g;
  let m;
  while ((m = bracketPattern.exec(text)) !== null) hints.add(m[1].trim());

  // 따옴표 안 텍스트
  const quotePattern = /[''""'"]([^''""'"]{2,20})[''""'"]/g;
  while ((m = quotePattern.exec(text)) !== null) hints.add(m[1].trim());

  return [...hints];
}

async function collectRssNews() {
  const allArticles = [];
  const seenUrls = new Set();

  for (const feed of RSS_FEEDS) {
    try {
      console.log(`[rssCollector] ${feed.name} RSS 수집 중...`);

      const response = await axios.get(feed.url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; UnlistedResearch/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
        responseType: 'text',
      });

      const items = parseRssXml(response.data);
      let count = 0;

      for (const item of items) {
        const url = item.link;
        if (!url || seenUrls.has(url)) continue;

        const title = stripHtml(item.title);
        const description = stripHtml(item.description);

        // 투자 관련 기사만 필터링
        if (!isInvestmentRelated(title, description)) continue;

        seenUrls.add(url);
        allArticles.push({
          title,
          link: url,
          description,
          pubDate: item.pubDate || new Date().toISOString(),
          source: feed.name,
          sourcePriority: feed.priority,
          companyHints: extractCompanyHints(title, description),
          fromRss: true, // RSS 출처 표시
        });
        count++;
      }

      console.log(`[rssCollector] ${feed.name} — 투자 관련 ${count}건 수집`);

    } catch (err) {
      console.error(`[rssCollector] ${feed.name} RSS 수집 실패:`, err.message);
      // 실패해도 계속 진행
    }

    await sleep(1000);
  }

  // 우선순위 순 정렬
  allArticles.sort((a, b) => a.sourcePriority - b.sourcePriority);

  console.log(`[rssCollector] 총 ${allArticles.length}건 수집 완료`);
  return allArticles;
}

module.exports = { collectRssNews };
