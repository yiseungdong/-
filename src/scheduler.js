require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');

// 수집 모듈
const { collectNews } = require('./collectors/naverNews');
const { collectVcTrends } = require('./collectors/vcTrends');
const { extractCompanyList } = require('./analyzer');
const { filterUnlisted } = require('./krxFilter');
const { verifyUnlisted } = require('./dartVerify');
const { collectDart } = require('./collectors/dartApi');
const { collectPrice, calculateMarketCap } = require('./collectors/priceTracker');
const { collectCompanyInfo } = require('./collectors/companyInfo');
const thevcCrawler = require('./collectors/thevcCrawler');
const innoforestCrawler = require('./collectors/innoforestCrawler');
const nextunicornCrawler = require('./collectors/nextunicornCrawler');
const { searchValuationHistory } = require('./collectors/valuationHistorySearch');

// 분석 모듈
const analyzer = require('./analyzer');
const { crossCheckValuation } = require('./crossChecker');
const { classifyInvestors } = require('./vcTierClassifier');
const { analyzeFollowOn } = require('./followOnTracker');
const { findRelatedCompanies } = require('./vcPortfolioLinker');
const { updateVCDatabase } = require('./vcDatabaseManager');

// 출력 모듈
const reportWriter = require('./reportWriter');
const excelWriter = require('./excelWriter');
const { analyzeCoInvestmentPatterns } = require('./coInvestmentNetwork');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log(`[${new Date().toLocaleTimeString('ko-KR')}] ${msg}`); }

async function run() {
  const today = new Date().toISOString().slice(0, 10);
  const reportDir = path.join(__dirname, '../reports', today);
  const logDir = path.join(__dirname, '../logs');
  fs.ensureDirSync(logDir);
  const logPath = path.join(logDir, `${today}.log`);
  const appendLog = (msg) => fs.appendFileSync(logPath, `[${new Date().toLocaleString('ko-KR')}] ${msg}\n`);

  // 중복 체크
  if (fs.existsSync(reportDir) && fs.readdirSync(reportDir).filter(f => f.endsWith('.md')).length > 0) {
    log(`오늘 리포트 이미 존재 (${today}). 종료.`);
    return;
  }

  log('============================');
  log(`비상장 리서치 시작: ${today}`);
  log('============================');

  try {
    // ── Phase 1: 데이터 수집 ──
    log('Phase 1: 데이터 수집');

    // 1-1. 뉴스 수집
    let newsArticles = [];
    let vcArticles = [];
    try { newsArticles = await collectNews(); } catch (e) { log('뉴스 수집 실패: ' + e.message); }
    try { vcArticles = await collectVcTrends(); } catch (e) { log('VC 수집 실패: ' + e.message); }
    const allArticles = [...newsArticles, ...vcArticles];
    log(`수집: 뉴스 ${newsArticles.length}건 + VC ${vcArticles.length}건`);
    appendLog(`수집 완료 — ${allArticles.length}건`);

    if (allArticles.length === 0) { log('수집 기사 없음. 종료.'); return; }

    // 1-2. 회사명 추출 (Claude API)
    let rawCompanies = [];
    try { rawCompanies = await extractCompanyList(allArticles); } catch (e) { log('추출 실패: ' + e.message); return; }
    log(`회사 추출: ${rawCompanies.length}개`);

    if (rawCompanies.length === 0) { log('추출된 회사 없음. 종료.'); return; }

    // 1-3. 비상장 판단
    let candidates = rawCompanies;
    try { candidates = await filterUnlisted(rawCompanies); } catch (e) { log('KRX 필터 오류: ' + e.message); }
    let confirmed = [];
    try { confirmed = await verifyUnlisted(candidates); } catch (e) { log('DART 검증 오류: ' + e.message); confirmed = candidates.map(n => ({ name: n })); }
    log(`비상장 확정: ${confirmed.length}개`);

    if (confirmed.length === 0) { log('비상장 확정 0개. 종료.'); return; }

    // 1-4. 보조 정보 수집
    const companies = [];
    for (const c of confirmed) {
      const name = c.name;
      log(`  수집: ${name}`);
      const related = allArticles.find(a => a.title.includes(name) || (a.description || '').includes(name));

      const entry = {
        name,
        reason: related ? related.title : '뉴스 기반 발굴',
        source: related ? related.title : '',
        link: related ? related.link : '',
        pubDate: related ? related.pubDate : '',
        financials: null, price: null, patents: null, regulations: null,
        thevcData: null, innoforestData: null, nextunicornData: null,
      };

      // 병렬 수집
      const tasks = [
        collectDart(name).then(r => { entry.financials = r; }).catch(e => log(`  DART실패(${name}): ${e.message}`)),
        collectPrice(name).then(r => { entry.price = r; }).catch(e => log(`  가격실패(${name}): ${e.message}`)),
        collectCompanyInfo(name).then(r => { entry.patents = r.patents; entry.regulations = r.regulations; }).catch(e => log(`  특허실패(${name}): ${e.message}`)),
        thevcCrawler.search(name).then(r => { entry.thevcData = r; }).catch(e => log(`  TheVC실패(${name}): ${e.message}`)),
        innoforestCrawler.search(name).then(r => { entry.innoforestData = r; }).catch(e => log(`  혁신의숲실패(${name}): ${e.message}`)),
        nextunicornCrawler.search(name).then(r => { entry.nextunicornData = r; }).catch(e => log(`  넥유실패(${name}): ${e.message}`)),
      ];
      await Promise.allSettled(tasks);
      companies.push(entry);
      await sleep(2000);
    }
    appendLog(`보조 수집 완료 — ${companies.length}개`);

    // 1-5. 밸류 히스토리 소급 (최대 10개)
    for (const c of companies.slice(0, 10)) {
      try { c.valuationHistory = await searchValuationHistory(c.name); } catch (e) { log(`소급실패(${c.name}): ${e.message}`); }
    }

    // ── Phase 2: 분석 ──
    log('Phase 2: AI 분석');
    const analyzed = await analyzer.analyze(companies);

    // 2-1~2-6. 추가 분석 (각 회사별)
    for (const c of analyzed) {
      try {
        // 시세기반 시총
        if (c.price && c.financials?.totalShares) {
          const mc = calculateMarketCap(c.price, c.financials);
          if (mc) c.marketCap = mc;
        }
        // 투자자 티어
        const latestRound = c.vcHistory?.rounds?.[0] || {};
        c.investorTier = classifyInvestors({
          leadInvestor: latestRound.leadVC || latestRound.investors?.[0],
          coInvestors: latestRound.investors?.slice(1) || [],
          strategicInvestors: c.strategicInvestors || [],
        });
        c.vcTierBreakdown = c.investorTier.tierBreakdown;
        // 후속투자
        c.followOn = analyzeFollowOn(c.name, c.vcHistory?.rounds || []);
        c.followOnSummary = c.followOn.summary;
        // 포트폴리오 연결
        c.relatedCompanies = findRelatedCompanies(c.name, null, []);
      } catch (e) { log(`추가분석실패(${c.name}): ${e.message}`); }
    }
    appendLog(`분석 완료 — ${analyzed.length}개`);

    for (const c of analyzed) {
      log(`  ${c.name}: 섹터=${c.sectorName||'?'} 매력도=${c.score||0}/10`);
    }

    // ── Phase 3: 출력 ──
    log('Phase 3: 출력');

    await reportWriter.write(analyzed);
    appendLog('리포트 생성 완료');

    await excelWriter.updateExcel(analyzed);
    appendLog('엑셀 업데이트 완료');

    // VC DB 업데이트
    try {
      const allVCs = analyzed.flatMap(c => (c.vcHistory?.rounds || []).flatMap(r => r.investors || [])).filter(Boolean);
      await updateVCDatabase(allVCs);
    } catch (e) { log('VC DB 업데이트 실패: ' + e.message); }

    appendLog(`완료 — ${companies.length}개 리포트`);
    log('============================');
    log(`완료! reports/${today}/ 에 ${companies.length}개 리포트`);
    log('============================');
  } catch (err) {
    log('파이프라인 오류: ' + err.message);
    appendLog(`실패 — ${err.message}`);
  }
}

module.exports = { run };
