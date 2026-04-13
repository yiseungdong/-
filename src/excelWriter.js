const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs-extra');

const EXCEL_DIR = path.join(__dirname, '../reports/excel');

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function getWeekLabel() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function findLastFile() {
  if (!fs.existsSync(EXCEL_DIR)) return null;
  const files = fs.readdirSync(EXCEL_DIR)
    .filter(f => f.endsWith('.xlsx'))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(EXCEL_DIR, files[0]) : null;
}

// ── 컬럼 매핑 (밀림 방지) ─────────────────────────────────────────────────────
const COLUMN_MAP = {
  date: 1, companyName: 2, sector: 3, attractivenessScore: 4,
  latestRound: 5, investmentAmount: 6, previousValuation: 7,
  currentValuation: 8, valuationSource: 9, cumulativeInvestment: 10,
  participatingVC: 11, comm38: 12, stockPlus: 13, patentCount: 14,
  coreStrengths: 15, coreRisks: 16, ipoOutlook: 17, sourceLink: 18
};
const SHEET1_COL_COUNT = 18;

/**
 * 기존 26칸 데이터를 18칸으로 변환 (마이그레이션)
 */
function migrateOldRow(old) {
  if (!old || old.length <= SHEET1_COL_COUNT) return old; // 이미 18칸 이하
  const mergeStr = (...items) => items.filter(v => v && v !== '-' && v !== '').join(' / ') || '-';
  return [
    old[0] || '', old[1] || '', old[2] || '',
    old[4] || 0,          // 매력도 (index4)
    old[8] || '-',        // 최신라운드 (index8)
    old[9] || '-',        // 투자금액 (index9)
    '',                   // 직전밸류 (신규)
    old[10] || '',        // 현재밸류=밸류에이션 (index10)
    '',                   // 밸류소스 (신규)
    old[13] || '-',       // 누적투자총액 (index13)
    old[14] || '-',       // 참여VC (index14)
    old[15] || '미등록',  // 38커뮤 (index15)
    old[16] || '미등록',  // 증권플러스 (index16)
    old[17] || 0,         // 특허수 (index17)
    mergeStr(old[18], old[19], old[20]), // 핵심강점
    mergeStr(old[21], old[22], old[23]), // 핵심리스크
    old[24] || '-',       // IPO전망 (index24)
    old[25] || '-',       // 출처링크 (index25)
  ];
}

/**
 * Sheet1 중복 처리:
 * - 1주일(7일) 이내 같은 회사명 → 최신 데이터로 덮어쓰기 + 빈값 병합 (행 1개 유지)
 * - 1주일 초과 → 새 행으로 누적 추가 (기존 방식)
 */
function deduplicateRows(rows) {
  // 날짜 파싱 헬퍼
  function parseDate(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  // rows를 날짜 오름차순 정렬 후 처리
  const sorted = [...rows].sort((a, b) =>
    String(a[0] || '').localeCompare(String(b[0] || ''))
  );

  const result = [];

  for (const row of sorted) {
    const companyName = row[1];
    const rowDate = parseDate(row[0]);

    // 같은 회사명으로 result에 이미 있는 행 중 1주일 이내인 것 찾기
    const withinWeekIdx = result.findIndex(r => {
      if (r[1] !== companyName) return false;
      const existDate = parseDate(r[0]);
      if (!existDate || !rowDate) return false;
      const diffDays = Math.abs((rowDate - existDate) / (1000 * 60 * 60 * 24));
      return diffDays <= 7;
    });

    if (withinWeekIdx >= 0) {
      // 1주일 이내 → 최신 데이터로 덮어쓰되 빈값은 기존값으로 채움
      const existing = result[withinWeekIdx];
      const newScore = parseFloat(row[3]) || 0;
      const existScore = parseFloat(existing[3]) || 0;
      const base = newScore >= existScore ? [...row] : [...existing];
      const other = newScore >= existScore ? existing : row;
      for (let i = 0; i < SHEET1_COL_COUNT; i++) {
        const isEmpty = v => !v || v === '' || v === '-' || v === 0;
        if (isEmpty(base[i]) && !isEmpty(other[i])) base[i] = other[i];
      }
      result[withinWeekIdx] = base;
    } else {
      // 1주일 초과이거나 첫 등장 → 새 행으로 누적
      result.push([...row]);
    }
  }

  return result;
}

/**
 * Sheet2 중복 처리: 회사명 기준 최신 데이터 1행만 유지
 */
function deduplicateSheet2(rows) {
  const map = new Map();
  for (const row of rows) {
    const companyName = row[1];
    if (!map.has(companyName)) {
      map.set(companyName, row);
    } else {
      const existing = map.get(companyName);
      const existDate = String(existing[0] || '');
      const newDate = String(row[0] || '');
      // 더 최신 날짜 우선, 빈값은 기존값으로 채움
      const base = newDate >= existDate ? [...row] : [...existing];
      const other = newDate >= existDate ? existing : row;
      for (let i = 0; i < base.length; i++) {
        const isEmpty = v => !v || v === '' || v === '-';
        if (isEmpty(base[i]) && !isEmpty(other[i])) base[i] = other[i];
      }
      map.set(companyName, base);
    }
  }
  return [...map.values()];
}

// ── Sheet1 행 변환 ────────────────────────────────────────────────────────────

function toSheet1Row(company, today) {
  const vc = company.vcHistory || {};
  const rounds = vc.rounds || [];
  const latestRound = rounds[0] || {};
  const prevRound = rounds.length >= 2 ? rounds[1] : null;

  // 현재밸류 포맷: "3000억 (▲200%)" — 직전밸류 있을 때만 변동률 표시
  let currentValuStr = latestRound.valuation ? `${latestRound.valuation}억` : '-';
  if (latestRound.valuation && prevRound?.valuation) {
    const change = Math.round(
      ((latestRound.valuation - prevRound.valuation) / prevRound.valuation) * 100
    );
    const arrow = change >= 0 ? '▲' : '▼';
    currentValuStr = `${latestRound.valuation}억 (${arrow}${Math.abs(change)}%)`;
  }

  // 밸류소스 판단
  let valuSource = '-';
  if (latestRound.valuation) {
    valuSource = 'VC-직접';
  } else if (company.price?.price38?.price) {
    valuSource = '시세기반';
  }

  // 참여VC 포맷: "[리드] 소뱅 / 캡스톤 / 산업은행(정책금융)"
  // participants 배열이 있으면 유형 표시 포함
  let vcStr = '-';
  const participants = company.participants || [];
  if (participants.length > 0) {
    vcStr = participants.map(p => {
      const prefix = p.role === '리드' ? '[리드] ' : '';
      const suffix = (p.type && p.type !== 'VC') ? `(${p.type})` : '';
      return `${prefix}${p.name}${suffix}`;
    }).join(' / ');
  } else {
    // 기존 fallback
    const leadVC = latestRound.leadVC || (latestRound.investors?.[0] || '');
    const otherVCs = (latestRound.investors || []).filter(v => v !== leadVC);
    vcStr = leadVC ? `[리드] ${leadVC}${otherVCs.length > 0 ? ' / ' + otherVCs.join(' / ') : ''}` : (latestRound.investors || []).join(' / ') || '-';
  }

  // 강점/리스크 통합 (" / " 구분자) — 문자열 또는 배열 모두 처리
  const rawStr = company.strengths || company.coreStrengths || [];
  const strengths = (typeof rawStr === 'string' ? rawStr : (Array.isArray(rawStr) ? rawStr.filter(Boolean).join(' / ') : '-')) || '-';
  const rawRisk = company.risks || company.coreRisks || [];
  const risks = (typeof rawRisk === 'string' ? rawRisk : (Array.isArray(rawRisk) ? rawRisk.filter(Boolean).join(' / ') : '-')) || '-';

  return [
    today,
    company.name,
    company.sectorName || '-',
    company.score || 0,
    latestRound.roundName || '-',
    latestRound.amount || '-',
    prevRound?.valuation || '-',
    currentValuStr,
    valuSource,
    vc.totalRaised || '-',
    vcStr,
    company.price?.price38?.price || '미등록',
    company.price?.pricePlus?.price || '미등록',
    company.patents?.totalCount || 0,
    strengths,
    risks,
    company.ipoOutlook || '-',
    company.link || '-'
  ];
}

// ── Sheet2 행 변환 ────────────────────────────────────────────────────────────

function toSheet2Row(company, today) {
  const profile = company.profile || {};

  // analyzer.js가 반환하는 필드명 그대로 사용 (businessSummary / marketCompetition)
  const bizSummary = profile.businessSummary || '-';
  const marketCompetition = profile.marketCompetition || '-';

  return [
    today,
    company.name,
    company.sectorName || '-',
    bizSummary,
    marketCompetition
  ];
}

// ── Sheet4 행 변환 (VC밸류히스토리) ──────────────────────────────────────────

function toSheet4Rows(company, today) {
  const rounds = company.vcHistory?.rounds || [];
  return rounds.map(r => [
    company.name,
    r.date || today,
    r.roundName || '-',
    r.valuation || '-',
    r.amount || '-',
    r.leadVC || (r.investors?.[0] || '-'),
    (r.investors || []).join(', ') || '-',
    r.type || '-',
    r.valuation ? 'VC-직접' : 'VC-역산',
    company.link || '-'
  ]);
}

// ── 가격변동 감지 ─────────────────────────────────────────────────────────────
// 기존 데이터에서 38커뮤니케이션은 L열(index 11), 증권플러스는 M열(index 12)
// (0-based: row[0]=날짜, row[1]=회사명, ... row[11]=38가격, row[12]=증권플러스가격)

function getPriceChanges(companies, existingData) {
  const changes = [];

  for (const company of companies) {
    try {
      const today38  = company.price?.price38?.price;
      const todayPlus = company.price?.pricePlus?.price;

      const prevRows = existingData
        .filter(row => row[1] === company.name)
        .sort((a, b) => String(b[0]).localeCompare(String(a[0])));

      if (prevRows.length === 0) continue;

      const prev = prevRows[0];
      const prev38   = typeof prev[11] === 'number' ? prev[11] : null;
      const prevPlus = typeof prev[12] === 'number' ? prev[12] : null;

      let change38   = null;
      let changePlus = null;
      if (today38   && prev38)   change38   = Math.round(((today38   - prev38)   / prev38)   * 1000) / 10;
      if (todayPlus && prevPlus) changePlus = Math.round(((todayPlus - prevPlus) / prevPlus) * 1000) / 10;

      const maxChange = Math.max(Math.abs(change38 || 0), Math.abs(changePlus || 0));
      if (maxChange >= 10) {
        const dominant = Math.abs(change38 || 0) >= Math.abs(changePlus || 0)
          ? (change38 || 0) : (changePlus || 0);
        changes.push({
          companyName:     company.name,
          price38Today:    today38,
          price38Prev:     prev38,
          change38,
          pricePlusToday:  todayPlus,
          pricePlusPrev:   prevPlus,
          changePlus,
          maxChange:       dominant,
          alertType:       dominant > 0 ? '급등' : '급락'
        });
      }
    } catch (err) {
      console.error(`[excelWriter] 가격변동 감지 실패 (${company.name}):`, err.message);
    }
  }

  return changes.sort((a, b) => Math.abs(b.maxChange) - Math.abs(a.maxChange));
}

// ── Sheet3 빌더 (기존 로직 그대로) ───────────────────────────────────────────

function buildPriceAlertSheet(sheet, changes, today, companies) {
  const upCount   = changes.filter(c => c.alertType === '급등').length;
  const downCount = changes.filter(c => c.alertType === '급락').length;

  // 행1: 타이틀 (병합 없이 A1에만)
  const titleRow = sheet.addRow([`기준일: ${today} | 급등 ${upCount}개 | 급락 ${downCount}개 | 총 ${changes.length}개 종목`]);
  titleRow.getCell(1).font = { bold: true, size: 12 };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD699' } };

  // 행2: 헤더
  const headers = [
    '회사명', '기준일',
    '38_전일가', '38_현재가', '38_변동폭',
    '증권플러스_전일가', '증권플러스_현재가', '증권플러스_변동폭',
    '최대변동폭', '알림'
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  for (const c of changes) {
    const row = sheet.addRow([
      c.companyName,
      today,
      c.price38Prev    || '-',
      c.price38Today   || '-',
      c.change38   !== null ? (c.change38   > 0 ? '+' : '') + c.change38   + '%' : '-',
      c.pricePlusPrev  || '-',
      c.pricePlusToday || '-',
      c.changePlus !== null ? (c.changePlus > 0 ? '+' : '') + c.changePlus + '%' : '-',
      (c.maxChange > 0 ? '+' : '') + c.maxChange + '%',
      c.alertType === '급등' ? '🔴 급등' : '🔵 급락'
    ]);
    row.eachCell(cell => {
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: c.alertType === '급등' ? 'FFFFE0E0' : 'FFE0E8FF' }
      };
    });
  }

  if (changes.length === 0) {
    sheet.addRow(['10% 이상 변동 종목 없음']);
  }

  sheet.columns.forEach((col, i) => {
    col.width = [16, 12, 12, 12, 12, 14, 14, 14, 12, 10][i] || 12;
  });

  // ── VC 밸류 변동 섹션 ──
  if (companies && companies.length > 0) {
    buildVCValuationAlerts(sheet, companies);
  }
}

// ── VC 밸류 변동 알림 빌더 ───────────────────────────────────────────────────

function buildVCValuationAlerts(sheet, companies) {
  // 구분선
  sheet.addRow([]);
  const dividerRow = sheet.addRow(['── VC 밸류 변동 ──']);
  dividerRow.getCell(1).font = { bold: true, size: 12 };
  sheet.addRow([]);

  // 헤더
  const vcHeaders = ['회사명', '직전라운드', '직전밸류(억)', '현재라운드', '현재밸류(억)', '변동률', '알림'];
  const vcHeaderRow = sheet.addRow(vcHeaders);
  vcHeaderRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A148C' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });

  // 각 회사별 최근 2개 라운드 비교
  let alertCount = 0;
  for (const company of companies) {
    const rounds = (company.vcHistory?.rounds || []).slice(0, 2);
    if (rounds.length < 2) continue;

    const current = rounds[0];
    const prev = rounds[1];
    if (!current.valuation || !prev.valuation) continue;

    const curVal = parseFloat(current.valuation);
    const prevVal = parseFloat(prev.valuation);
    if (!curVal || !prevVal) continue;

    const changeRate = Math.round(((curVal - prevVal) / prevVal) * 100);

    let alertLabel, bgColor;
    if (changeRate >= 100) {
      alertLabel = '🔴 급등 (밸류 2배+)';
      bgColor = 'FFFFE0E0';
    } else if (changeRate >= 50) {
      alertLabel = '🟢 대폭 상승';
      bgColor = 'FFE0FFE0';
    } else if (changeRate < 0) {
      alertLabel = '🔵 다운라운드 주의';
      bgColor = 'FFE0E8FF';
    } else {
      continue; // 50% 미만 상승은 알림 안 함
    }

    const row = sheet.addRow([
      company.name,
      prev.roundName || '-',
      prevVal,
      current.roundName || '-',
      curVal,
      (changeRate >= 0 ? '+' : '') + changeRate + '%',
      alertLabel,
    ]);
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
    });
    alertCount++;
  }

  if (alertCount === 0) {
    sheet.addRow(['VC 밸류 변동 알림 없음']);
  }
}

// ── 메인 ──────────────────────────────────────────────────────────────────────

async function updateExcel(companies) {
  try {
    fs.ensureDirSync(EXCEL_DIR);

    const weekLabel   = getWeekLabel();
    const thisWeekFile = path.join(EXCEL_DIR, `비상장_${weekLabel}.xlsx`);
    const today       = new Date().toISOString().slice(0, 10);

    let workbook = new ExcelJS.Workbook();
    let existingSheet1Data = [];
    let existingSheet2Data = [];
    let existingSheet4Data = [];

    // 기존 파일 읽기
    const existingFile = fs.existsSync(thisWeekFile) ? thisWeekFile : findLastFile();
    if (existingFile) {
      try {
        await workbook.xlsx.readFile(existingFile);

        const s1 = workbook.getWorksheet('비상장_누적');
        const s2 = workbook.getWorksheet('회사프로파일');
        const s4 = workbook.getWorksheet('VC밸류히스토리');

        if (s1) s1.eachRow((row, i) => { if (i > 1) existingSheet1Data.push(row.values.slice(1)); });
        if (s2) s2.eachRow((row, i) => { if (i > 1) existingSheet2Data.push(row.values.slice(1)); });
        if (s4) s4.eachRow((row, i) => { if (i > 1) existingSheet4Data.push(row.values.slice(1)); });
      } catch (e) {
        console.log('[excelWriter] 기존 파일 읽기 실패, 새로 생성:', e.message);
      }
    }

    // 기존 데이터 마이그레이션 (26칸→18칸) + 중복 제거
    existingSheet1Data = deduplicateRows(existingSheet1Data.map(migrateOldRow));
    existingSheet2Data = deduplicateSheet2(existingSheet2Data);

    // 새 워크북 생성
    workbook = new ExcelJS.Workbook();

    // ── Sheet1: 비상장_누적 (A~R, 18컬럼) ────────────────────────────────────
    const sheet1 = workbook.addWorksheet('비상장_누적');

    const headers1 = [
      '날짜',          // A
      '회사명',         // B
      '섹터',           // C
      '매력도점수',     // D ← 노란색 배경
      '최신라운드',     // E
      '투자금액(억)',   // F
      '직전밸류(억)',   // G (신규)
      '현재밸류(억)',   // H (기존 밸류에이션(억) 이름 변경)
      '밸류소스',       // I (신규)
      '누적투자총액(억)', // J
      '참여VC',         // K
      '38커뮤니케이션', // L
      '증권플러스',     // M
      '특허수',         // N
      '핵심강점',       // O (강점1~3 통합)
      '핵심리스크',     // P (리스크1~3 통합)
      'IPO전망',        // Q
      '출처링크'        // R
    ];

    const headerRow1 = sheet1.addRow(headers1);
    headerRow1.eachCell((cell, col) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };

      // D열(4번째) 노란색 강조
      if (col === 4) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
        cell.font = { color: { argb: 'FF000000' }, bold: true };
      }
    });

    // 기존 데이터 + 새 데이터 병합 (중복 시 덮어쓰기)
    const newRows = companies.map(c => toSheet1Row(c, today));
    const allSheet1 = deduplicateRows([...existingSheet1Data, ...newRows]);
    for (const row of allSheet1) sheet1.addRow(row.slice(0, SHEET1_COL_COUNT));

    // ㄱㄴㄷ 정렬 (회사명 → 날짜 오름차순)
    const allRows1 = [];
    sheet1.eachRow((row, i) => { if (i > 1) allRows1.push(row.values.slice(1)); });
    allRows1.sort((a, b) => {
      const nameCompare = String(a[1] || '').localeCompare(String(b[1] || ''), 'ko');
      if (nameCompare !== 0) return nameCompare;
      return String(a[0] || '').localeCompare(String(b[0] || ''));
    });
    sheet1.spliceRows(2, sheet1.rowCount);
    for (const row of allRows1) sheet1.addRow(row);

    // 열 너비 (A~R)
    const widths1 = [12, 16, 14, 10, 12, 12, 12, 20, 12, 14, 40, 14, 14, 8, 40, 40, 20, 30];
    sheet1.columns.forEach((col, i) => { col.width = widths1[i] || 14; });

    // ── Sheet2: 회사프로파일 (A~E, 5컬럼) ────────────────────────────────────
    const sheet2 = workbook.addWorksheet('회사프로파일');

    const headers2 = [
      '날짜',     // A
      '회사명',   // B
      '섹터',     // C
      '사업요약', // D (한줄소개+주요제품서비스+핵심기술+핵심경쟁력+비즈니스모델 통합)
      '시장/경쟁' // E (타겟시장+주요고객사+경쟁사+성장전략 통합)
    ];

    const headerRow2 = sheet2.addRow(headers2);
    headerRow2.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // 기존 + 새 데이터 병합 (회사명 기준 최신 1행 유지)
    const newSheet2Rows = companies.map(c => toSheet2Row(c, today));
    const allSheet2 = deduplicateSheet2([...existingSheet2Data, ...newSheet2Rows]);
    for (const row of allSheet2) sheet2.addRow(row);

    // ㄱㄴㄷ 정렬
    const allRows2 = [];
    sheet2.eachRow((row, i) => { if (i > 1) allRows2.push(row.values.slice(1)); });
    allRows2.sort((a, b) => String(a[1] || '').localeCompare(String(b[1] || ''), 'ko'));
    sheet2.spliceRows(2, sheet2.rowCount);
    for (const row of allRows2) sheet2.addRow(row);

    // 열 너비 (A~E)
    sheet2.columns.forEach((col, i) => {
      col.width = [12, 16, 14, 60, 60][i] || 20;
    });

    // ── Sheet3: 가격변동알림 (기존 로직 그대로) ───────────────────────────────
    const sheet3 = workbook.addWorksheet('가격변동알림');
    const priceChanges = getPriceChanges(companies, existingSheet1Data);
    buildPriceAlertSheet(sheet3, priceChanges, today, companies);

    // ── Sheet4: VC밸류히스토리 (신규) ─────────────────────────────────────────
    const sheet4 = workbook.addWorksheet('VC밸류히스토리');

    const headers4 = [
      '회사명',       // A
      '날짜',         // B
      '라운드',       // C (시드/프리A/시리즈A/시리즈B/시리즈C/프리IPO)
      '밸류(억)',     // D
      '투자금액(억)', // E
      '리드투자자',   // F
      '전체참여VC',   // G (쉼표 구분)
      '투자형태',     // H (보통주/CB/SAFE/RCPS)
      '밸류소스',     // I (VC-직접/VC-역산/시세기반)
      '출처'          // J
    ];

    const headerRow4 = sheet4.addRow(headers4);
    headerRow4.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A148C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // 기존 데이터 복원
    for (const row of existingSheet4Data) sheet4.addRow(row);

    // 새 데이터 추가 (중복: 같은 회사명 + 같은 날짜 + 같은 라운드 스킵)
    for (const company of companies) {
      const newRows = toSheet4Rows(company, today);
      for (const newRow of newRows) {
        const isDuplicate = existingSheet4Data.some(
          row => row[0] === newRow[0] && row[1] === newRow[1] && row[2] === newRow[2]
        );
        if (isDuplicate) continue;
        sheet4.addRow(newRow);
      }
    }

    // 회사명 ㄱㄴㄷ → 날짜 오름차순 정렬
    const allRows4 = [];
    sheet4.eachRow((row, i) => { if (i > 1) allRows4.push(row.values.slice(1)); });
    allRows4.sort((a, b) => {
      const nameCompare = String(a[0] || '').localeCompare(String(b[0] || ''), 'ko');
      if (nameCompare !== 0) return nameCompare;
      return String(a[1] || '').localeCompare(String(b[1] || ''));
    });
    sheet4.spliceRows(2, sheet4.rowCount);
    for (const row of allRows4) sheet4.addRow(row);

    // 열 너비 (A~J)
    const widths4 = [16, 12, 14, 12, 12, 20, 40, 12, 12, 30];
    sheet4.columns.forEach((col, i) => { col.width = widths4[i] || 14; });

    // ── Sheet5: 오늘의 리서치 (당일만, 매일 리셋) ──────────────────────────────
    const sheet5 = workbook.addWorksheet('오늘의리서치');

    // 시트 탭 색상: 주황색
    sheet5.properties.tabColor = { argb: 'FFFF8C00' };

    // 타이틀 행 (A1~R1 병합)
    const todayCompanies = companies.length;
    sheet5.mergeCells('A1', 'R1');
    const titleCell = sheet5.getCell('A1');
    titleCell.value = `오늘의 리서치: ${today} | ${todayCompanies}개 종목 발굴`;
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD699' } };
    titleCell.font = { bold: true, size: 13 };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    // 헤더 행 (2행)
    const headerRow5 = sheet5.addRow(headers1);
    headerRow5.eachCell((cell, col) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (col === 4) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
        cell.font = { color: { argb: 'FF000000' }, bold: true };
      }
    });

    // 데이터: 오늘 수집된 종목만, 매력도 내림차순 정렬
    const todayRows = companies
      .map(c => toSheet1Row(c, today))
      .sort((a, b) => (b[3] || 0) - (a[3] || 0)); // D열(매력도) 내림차순

    for (const row of todayRows) {
      sheet5.addRow(row);
    }

    // 열 너비 (Sheet1과 동일)
    sheet5.columns.forEach((col, i) => {
      col.width = widths1[i] || 15;
    });

    console.log(`[excelWriter] Sheet5 오늘의리서치: ${todayRows.length}개 종목`);

    // ── 저장 ──────────────────────────────────────────────────────────────────
    await workbook.xlsx.writeFile(thisWeekFile);
    console.log(
      `[excelWriter] 저장 완료: ${path.basename(thisWeekFile)} ` +
      `(Sheet1: ${allRows1.length}행, Sheet2: ${allRows2.length}행, ` +
      `Sheet3: ${priceChanges.length}건, Sheet4: ${allRows4.length}행, ` +
      `Sheet5: ${todayRows.length}개 당일종목)`
    );
  } catch (err) {
    console.error(`[excelWriter] 수집 실패 - ${err.message}`);
  }
}

module.exports = { updateExcel };
