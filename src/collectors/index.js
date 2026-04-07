const fs = require('fs');
const path = require('path');
const { collectNews } = require('./naverNews');
const { collectVcTrends } = require('./vcTrends');
const { collectDart } = require('./dartApi');
const { collectPrice } = require('./priceTracker');
const { collectCompanyInfo } = require('./companyInfo');
const thevcCrawler = require('./thevcCrawler');
const innoforestCrawler = require('./innoforestCrawler');
const nextunicornCrawler = require('./nextunicornCrawler');
const { extractCompanyList } = require('../analyzer');
const { filterUnlisted } = require('../krxFilter');
const { verifyUnlisted } = require('../dartVerify');

const ANALYZED_PATH = path.join(__dirname, '../../public/data/analyzed-articles.json');

function loadAnalyzedArticles() {
  try {
    if (fs.existsSync(ANALYZED_PATH)) return JSON.parse(fs.readFileSync(ANALYZED_PATH, 'utf-8'));
  } catch (e) {}
  return { lastUpdated: null, articles: {} };
}

function saveAnalyzedArticles(data) {
  const dir = path.dirname(ANALYZED_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  data.lastUpdated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(ANALYZED_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 전체 수집 파이프라인
 *
 * 1. 뉴스 수집 (무료)
 * 2. Claude API → 회사명 추출 (~$0.01)
 * 3. KRX 상장 목록 비교 (무료)
 * 4. DART 검증 → 비상장 확정 (무료)
 * 5. 보조 정보 수집: 재무/가격/특허 (확정 회사만)
 *
 * @returns {Array} 회사별 통합 데이터 배열
 */
async function run() {
  // === 1. 뉴스 수집 ===
  let newsArticles = [];
  let vcArticles = [];

  try {
    newsArticles = await collectNews();
    console.log(`[collectors] 뉴스 ${newsArticles.length}건`);
  } catch (err) {
    console.error('[collectors] 뉴스 수집 오류:', err.message);
  }

  try {
    vcArticles = await collectVcTrends();
    console.log(`[collectors] VC/박람회 ${vcArticles.length}건`);
  } catch (err) {
    console.error('[collectors] VC 수집 오류:', err.message);
  }

  const allArticles = [...newsArticles, ...vcArticles];
  if (allArticles.length === 0) {
    console.log('[collectors] 수집된 기사 없음');
    return [];
  }

  // 기분석 기사 필터링
  const analyzedData = loadAnalyzedArticles();
  const newArticles = allArticles.filter(a => {
    const url = a.link || a.originallink || '';
    return !analyzedData.articles[url];
  });
  const skipped = allArticles.length - newArticles.length;
  if (skipped > 0) console.log(`[collectors] 기분석 기사 ${skipped}건 스킵`);

  if (newArticles.length === 0) {
    console.log('[collectors] 신규 기사 없음. 수집 종료.');
    return [];
  }

  // === 2. Claude API → 회사명 추출 ===
  let rawCompanies = [];
  try {
    rawCompanies = await extractCompanyList(newArticles);
    console.log(`[collectors] Claude 추출 ${rawCompanies.length}개`);
  } catch (err) {
    console.error('[collectors] 회사 추출 오류:', err.message);
    return [];
  }

  if (rawCompanies.length === 0) return [];

  // === 3. KRX 상장 목록 비교 ===
  let unlistedCandidates = rawCompanies;
  try {
    unlistedCandidates = await filterUnlisted(rawCompanies);
    console.log(`[collectors] KRX 필터 후 ${unlistedCandidates.length}개`);
  } catch (err) {
    console.error('[collectors] KRX 필터 오류:', err.message);
  }

  // === 4. DART 검증 → 비상장 확정 ===
  let confirmed = [];
  try {
    confirmed = await verifyUnlisted(unlistedCandidates);
    console.log(`[collectors] 비상장 확정 ${confirmed.length}개`);
  } catch (err) {
    console.error('[collectors] DART 검증 오류:', err.message);
    confirmed = unlistedCandidates.map((name) => ({
      name,
      corpCode: null,
      dartStatus: '검증실패',
    }));
  }

  if (confirmed.length === 0) return [];

  // === 5. 보조 정보 수집 ===
  const results = [];

  for (const company of confirmed) {
    const name = company.name;
    console.log(`[collectors] "${name}" 보조 정보 수집`);

    // 관련 기사 찾기
    const relatedArticle = newArticles.find(
      (a) => a.title.includes(name) || a.description.includes(name)
    );

    const entry = {
      name,
      reason: relatedArticle ? relatedArticle.title : '뉴스 기반 발굴',
      source: relatedArticle ? relatedArticle.title : '',
      link: relatedArticle ? relatedArticle.link : '',
      pubDate: relatedArticle ? relatedArticle.pubDate : '',
      listingType: company.dartStatus || '비상장추정',
      corpCode: company.corpCode || null,
      financials: null,
      price: null,
      patents: null,
      regulations: null,
    };

    try {
      entry.financials = await collectDart(name);
    } catch (err) {
      console.error(`[collectors] DART 재무 실패 (${name}):`, err.message);
    }

    try {
      entry.price = await collectPrice(name);
    } catch (err) {
      console.error(`[collectors] 가격 수집 실패 (${name}):`, err.message);
    }

    try {
      const info = await collectCompanyInfo(name);
      entry.patents = info.patents || null;
      entry.regulations = info.regulations || null;
    } catch (err) {
      console.error(`[collectors] 특허/규제 실패 (${name}):`, err.message);
    }

    try {
      entry.thevcData = await thevcCrawler.search(name);
    } catch (err) {
      console.error(`[collectors] THE VC 실패 (${name}):`, err.message);
    }

    try {
      entry.innoforestData = await innoforestCrawler.search(name);
    } catch (err) {
      console.error(`[collectors] 혁신의숲 실패 (${name}):`, err.message);
    }

    try {
      entry.nextunicornData = await nextunicornCrawler.search(name);
    } catch (err) {
      console.error(`[collectors] 넥스트유니콘 실패 (${name}):`, err.message);
    }

    results.push(entry);
    await sleep(2000);
  }

  // 분석 완료 기사 기록
  for (const article of newArticles) {
    const url = article.link || article.originallink || '';
    if (url) {
      analyzedData.articles[url] = {
        analyzedDate: new Date().toISOString().slice(0, 10),
        companies: results.map(r => r.name),
      };
    }
  }
  saveAnalyzedArticles(analyzedData);

  console.log(`[collectors] 수집 완료 — ${results.length}개 회사`);
  return results;
}

module.exports = { run };
