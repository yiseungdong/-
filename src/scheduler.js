const fs = require('fs-extra');
const path = require('path');
const { collectNews } = require('./collectors/naverNews');
const { collectVcTrends } = require('./collectors/vcTrends');
const { collectDart } = require('./collectors/dartApi');
const { collectPrice } = require('./collectors/priceTracker');
const { collectCompanyInfo } = require('./collectors/companyInfo');
const { analyze, extractCompanyList } = require('./analyzer');
const { filterUnlisted } = require('./krxFilter');
const { verifyUnlisted } = require('./dartVerify');
const { writeReports, appendToExcel } = require('./reportWriter');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const LOGS_DIR = path.join(__dirname, '..', 'logs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function timestamp() {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

class Logger {
  constructor() {
    this.today = getToday();
    this.logPath = path.join(LOGS_DIR, `${this.today}.log`);
    this.lines = [];
  }

  async init() {
    await fs.ensureDir(LOGS_DIR);
  }

  log(message) {
    const line = `[${timestamp()}] ${message}`;
    this.lines.push(line);
    console.log(line);
  }

  async save() {
    try {
      await fs.appendFile(this.logPath, this.lines.join('\n') + '\n', 'utf-8');
    } catch (err) {
      console.error('[logger] 로그 저장 실패:', err.message);
    }
  }
}

async function todayReportExists() {
  const today = getToday();
  const todayDir = path.join(REPORTS_DIR, today);

  try {
    const exists = await fs.pathExists(todayDir);
    if (!exists) return false;
    const files = await fs.readdir(todayDir);
    return files.filter((f) => f.endsWith('.md')).length > 0;
  } catch {
    return false;
  }
}

/**
 * 전체 파이프라인
 *
 * 1. 뉴스 수집 (무료)
 * 2. Claude API 1회 → 회사명 추출 (~$0.01)
 * 3. KRX 상장 목록 비교 → 상장사 제거 (무료)
 * 4. DART 검증 → 비상장 최종 확정 (무료)
 * 5. 보조 정보 수집: 재무/가격/특허 (확정된 회사만)
 * 6. Claude API → 회사별 분석 리포트
 * 7. .md 리포트 생성 + 엑셀 누적
 */
async function run() {
  const logger = new Logger();
  await logger.init();

  if (await todayReportExists()) {
    logger.log('오늘 리포트 이미 존재합니다. 종료합니다.');
    await logger.save();
    return;
  }

  logger.log('파이프라인 시작');

  // ============================================================
  // 1단계: 뉴스 수집 (무료)
  // ============================================================
  let newsArticles = [];
  let vcArticles = [];

  try {
    newsArticles = await collectNews();
    logger.log(`뉴스 수집 완료 — ${newsArticles.length}건`);
  } catch (err) {
    logger.log(`뉴스 수집 오류: ${err.message}`);
  }

  try {
    vcArticles = await collectVcTrends();
    logger.log(`VC/박람회 수집 완료 — ${vcArticles.length}건`);
  } catch (err) {
    logger.log(`VC/박람회 수집 오류: ${err.message}`);
  }

  const allArticles = [...newsArticles, ...vcArticles];
  logger.log(`총 기사 ${allArticles.length}건`);

  if (allArticles.length === 0) {
    logger.log('수집된 기사 없음. 종료.');
    await logger.save();
    return;
  }

  // ============================================================
  // 2단계: Claude API 1회 호출 → 회사명 추출 (~$0.01)
  // ============================================================
  let rawCompanies = [];
  try {
    rawCompanies = await extractCompanyList(allArticles);
    logger.log(`Claude 회사 추출 — ${rawCompanies.length}개`);
  } catch (err) {
    logger.log(`회사 추출 오류: ${err.message}`);
  }

  if (rawCompanies.length === 0) {
    logger.log('추출된 회사 없음. 종료.');
    await logger.save();
    return;
  }

  // ============================================================
  // 3단계: KRX 상장 목록 비교 — 상장사 제거 (무료)
  // ============================================================
  let unlistedCandidates = rawCompanies;
  try {
    unlistedCandidates = await filterUnlisted(rawCompanies);
    logger.log(`KRX 필터 후 — 비상장 후보 ${unlistedCandidates.length}개`);
  } catch (err) {
    logger.log(`KRX 필터 오류 (전체 유지): ${err.message}`);
  }

  // ============================================================
  // 4단계: DART 검증 → 비상장 최종 확정 (무료)
  // ============================================================
  let confirmedCompanies = [];
  try {
    confirmedCompanies = await verifyUnlisted(unlistedCandidates);
    logger.log(`DART 검증 완료 — 비상장 확정 ${confirmedCompanies.length}개`);
  } catch (err) {
    logger.log(`DART 검증 오류: ${err.message}`);
    // 검증 실패 시 후보 전체를 비상장 추정으로
    confirmedCompanies = unlistedCandidates.map((name) => ({
      name,
      corpCode: null,
      dartStatus: '검증실패(비상장추정)',
    }));
  }

  if (confirmedCompanies.length === 0) {
    logger.log('비상장 확정 회사 없음. 종료.');
    await logger.save();
    return;
  }

  // ============================================================
  // 5단계: 보조 정보 수집 — 확정된 비상장사만 (무료/키있음)
  // ============================================================
  const dartResults = {};
  const priceResults = {};
  const companyInfoResults = {};

  for (const company of confirmedCompanies) {
    const name = company.name;
    logger.log(`"${name}" 보조 정보 수집`);

    try {
      dartResults[name] = await collectDart(name);
    } catch (err) {
      logger.log(`DART 재무 실패 (${name}): ${err.message}`);
    }

    try {
      priceResults[name] = await collectPrice(name);
    } catch (err) {
      logger.log(`가격 수집 실패 (${name}): ${err.message}`);
    }

    try {
      companyInfoResults[name] = await collectCompanyInfo(name);
    } catch (err) {
      logger.log(`특허/규제 실패 (${name}): ${err.message}`);
    }

    await sleep(2000);
  }

  logger.log(`보조 정보 수집 완료 — ${confirmedCompanies.length}개 회사`);

  // ============================================================
  // 6단계: AI 분석 — 회사별 Claude API 호출
  // ============================================================
  let analysisResults = [];
  try {
    analysisResults = await analyze({
      confirmedCompanies,
      articles: allArticles,
      dartResults,
      priceResults,
      companyInfoResults,
    });
    logger.log(`분석 완료 — ${analysisResults.length}개 회사`);
  } catch (err) {
    logger.log(`분석 오류: ${err.message}`);
  }

  // ============================================================
  // 7단계: 리포트 생성 + 엑셀 누적
  // ============================================================
  let createdFiles = [];
  try {
    createdFiles = await writeReports(analysisResults);
    logger.log(`리포트 생성 — ${createdFiles.length}개 파일`);
  } catch (err) {
    logger.log(`리포트 생성 오류: ${err.message}`);
  }

  try {
    await appendToExcel(analysisResults);
    logger.log('엑셀 누적 완료');
  } catch (err) {
    logger.log(`엑셀 누적 오류: ${err.message}`);
  }

  logger.log('전체 완료');
  await logger.save();

  return {
    articles: allArticles.length,
    extracted: rawCompanies.length,
    afterKrx: unlistedCandidates.length,
    confirmed: confirmedCompanies.length,
    analyzed: analysisResults.length,
    reports: createdFiles.length,
    files: createdFiles,
  };
}

module.exports = { run };
