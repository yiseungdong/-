const fs = require('fs-extra');
const path = require('path');
const { collectNews } = require('./collectors/naverNews');
const { collectVcTrends } = require('./collectors/vcTrends');
const { collectDart } = require('./collectors/dartApi');
const { collectPrice } = require('./collectors/priceTracker');
const { collectCompanyInfo } = require('./collectors/companyInfo');
const { analyze, extractCompanyList } = require('./analyzer');
const { writeReports } = require('./reportWriter');

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

/**
 * 오늘 리포트가 이미 존재하는지 체크
 */
async function todayReportExists() {
  const today = getToday();
  const todayDir = path.join(REPORTS_DIR, today);

  try {
    const exists = await fs.pathExists(todayDir);
    if (!exists) return false;

    const files = await fs.readdir(todayDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));
    return mdFiles.length > 0;
  } catch {
    return false;
  }
}

/**
 * 전체 파이프라인 실행
 * 흐름: 발굴(뉴스+VC) → 회사 목록 확정 → 보조 정보(DART, 가격, 특허/허가)→ 분석 → 리포트
 */
async function run() {
  const logger = new Logger();
  await logger.init();

  // 오늘 리포트 존재 여부 체크
  if (await todayReportExists()) {
    logger.log('오늘 리포트 이미 존재합니다. 종료합니다.');
    await logger.save();
    return;
  }

  logger.log('파이프라인 시작');

  // ============================================================
  // 1단계: 발굴 — 뉴스 + VC/박람회에서 비상장 회사 찾기
  // ============================================================
  let newsArticles = [];
  let vcArticles = [];

  try {
    newsArticles = await collectNews();
    logger.log(`뉴스 발굴 완료 — ${newsArticles.length}건`);
  } catch (err) {
    logger.log(`뉴스 발굴 오류: ${err.message}`);
  }

  try {
    vcArticles = await collectVcTrends();
    logger.log(`VC/박람회 발굴 완료 — ${vcArticles.length}건`);
  } catch (err) {
    logger.log(`VC/박람회 발굴 오류: ${err.message}`);
  }

  const allArticles = [...newsArticles, ...vcArticles];
  const companies = extractCompanyList(allArticles);
  logger.log(`발굴 결과 — 총 기사 ${allArticles.length}건, 회사 ${companies.length}개 확정`);

  if (companies.length === 0) {
    logger.log('발굴된 회사가 없습니다. 파이프라인 종료.');
    await logger.save();
    return;
  }

  // ============================================================
  // 2단계: 보조 정보 수집 — 발굴된 회사에 대해서만
  // ============================================================
  const dartResults = {};
  const priceResults = {};
  const companyInfoResults = {};

  for (const companyName of companies) {
    logger.log(`"${companyName}" 보조 정보 수집 시작`);

    try {
      dartResults[companyName] = await collectDart(companyName);
    } catch (err) {
      logger.log(`DART 수집 실패 (${companyName}): ${err.message}`);
    }

    try {
      priceResults[companyName] = await collectPrice(companyName);
    } catch (err) {
      logger.log(`가격 수집 실패 (${companyName}): ${err.message}`);
    }

    try {
      companyInfoResults[companyName] = await collectCompanyInfo(companyName);
    } catch (err) {
      logger.log(`특허/규제 수집 실패 (${companyName}): ${err.message}`);
    }

    await sleep(2000);
  }

  logger.log(`보조 정보 수집 완료 — ${companies.length}개 회사`);

  // ============================================================
  // 3단계: AI 분석
  // ============================================================
  let analysisResults = [];
  try {
    analysisResults = await analyze({
      articles: allArticles,
      dartResults,
      priceResults,
      companyInfoResults,
    });
    logger.log(`분석 완료 — ${analysisResults.length}개 회사 분석`);
  } catch (err) {
    logger.log(`분석 단계 오류: ${err.message}`);
  }

  // ============================================================
  // 4단계: 리포트 생성
  // ============================================================
  let createdFiles = [];
  try {
    createdFiles = await writeReports(analysisResults);
    logger.log(`리포트 생성 완료 — ${createdFiles.length}개 파일`);
  } catch (err) {
    logger.log(`리포트 생성 단계 오류: ${err.message}`);
  }

  logger.log('전체 완료');
  await logger.save();

  return {
    articles: allArticles.length,
    companies: analysisResults.length,
    reports: createdFiles.length,
    files: createdFiles,
  };
}

module.exports = { run };
