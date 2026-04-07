const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs-extra');

const EXCEL_DIR = path.join(__dirname, '../reports/excel');

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

function getEvalLabel(undervalueRate) {
  if (undervalueRate === null || undervalueRate === undefined) return '-';
  if (undervalueRate <= -30) return '🟢 저평가';
  if (undervalueRate <= 30) return '🟡 적정';
  if (undervalueRate <= 100) return '🟠 고평가';
  return '🔴 버블';
}

async function updateExcel(companies) {
  try {
  fs.ensureDirSync(EXCEL_DIR);

  const weekLabel = getWeekLabel();
  const thisWeekFile = path.join(EXCEL_DIR, `비상장_${weekLabel}.xlsx`);

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
      const s4 = workbook.getWorksheet('가격변동알림');

      if (s1) {
        s1.eachRow((row, i) => {
          if (i > 1) existingSheet1Data.push(row.values.slice(1));
        });
      }
      if (s2) {
        s2.eachRow((row, i) => {
          if (i > 1) existingSheet2Data.push(row.values.slice(1));
        });
      }
      if (s4) {
        s4.eachRow((row, i) => {
          if (i > 1) existingSheet4Data.push(row.values.slice(1));
        });
      }
    } catch (e) {
      console.log('[excelWriter] 기존 파일 읽기 실패, 새로 생성:', e.message);
    }
  }

  // 새 워크북 생성
  workbook = new ExcelJS.Workbook();

  // ── Sheet1: 비상장_누적 ──
  const sheet1 = workbook.addWorksheet('비상장_누적');

  const headers1 = [
    '날짜', '회사명', '섹터', '성장성등급', '매력도점수', '점수세부내역',
    '평가등급', '노출이유', '최신라운드', '투자금액(억)', '밸류에이션(억)',
    '적정밸류(억)', '저평가율(%)', '누적투자총액(억)', '참여VC',
    '38커뮤니케이션', '증권플러스', '특허수',
    '강점1', '강점2', '강점3',
    '리스크1', '리스크2', '리스크3',
    'IPO전망', '출처링크'
  ];

  const headerRow1 = sheet1.addRow(headers1);
  headerRow1.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };

    // E열(5), F열(6) 노란색 강조
    if (col === 5 || col === 6) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
      cell.font = { color: { argb: 'FF000000' }, bold: true };
    }
  });

  // 기존 데이터
  for (const row of existingSheet1Data) {
    sheet1.addRow(row);
  }

  // 새 데이터 (중복 체크)
  const today = new Date().toISOString().slice(0, 10);
  for (const company of companies) {
    const isDuplicate = existingSheet1Data.some(
      row => row[1] === company.name && row[0] === today
    );
    if (isDuplicate) continue;

    const latestRound = company.vcHistory?.rounds?.[0] || {};
    sheet1.addRow([
      today,
      company.name,
      company.sectorName || '-',
      company.growthGrade || '-',
      company.score || 0,
      company.scoreBreakdownStr || '-',
      getEvalLabel(company.valuation?.undervalueRate),
      company.reason || '-',
      latestRound.roundName || '-',
      latestRound.amount || '-',
      latestRound.valuation || '-',
      company.valuation?.fairValue || '-',
      company.valuation?.undervalueRate !== null && company.valuation?.undervalueRate !== undefined
        ? company.valuation.undervalueRate + '%' : '-',
      company.vcHistory?.totalRaised || '-',
      (latestRound.investors || []).join(', ') || '-',
      company.price?.price38?.price || '미등록',
      company.price?.pricePlus?.price || '미등록',
      company.patents?.totalCount || 0,
      (company.strengths || [])[0] || '-',
      (company.strengths || [])[1] || '-',
      (company.strengths || [])[2] || '-',
      (company.risks || [])[0] || '-',
      (company.risks || [])[1] || '-',
      (company.risks || [])[2] || '-',
      company.ipoOutlook || '-',
      company.link || '-'
    ]);
  }

  // ㄱㄴㄷ 정렬
  const allRows1 = [];
  sheet1.eachRow((row, i) => { if (i > 1) allRows1.push(row.values.slice(1)); });
  allRows1.sort((a, b) => {
    const nameCompare = String(a[1] || '').localeCompare(String(b[1] || ''), 'ko');
    if (nameCompare !== 0) return nameCompare;
    return String(a[0] || '').localeCompare(String(b[0] || ''));
  });

  sheet1.spliceRows(2, sheet1.rowCount);
  for (const row of allRows1) sheet1.addRow(row);

  sheet1.columns.forEach((col, i) => {
    col.width = [12, 16, 14, 10, 10, 40, 12, 30, 12, 12, 12, 12, 12, 12, 30, 12, 12, 8, 20, 20, 20, 20, 20, 20, 20, 30][i] || 15;
  });

  // ── Sheet2: 회사프로파일 ──
  const sheet2 = workbook.addWorksheet('회사프로파일');

  const headers2 = [
    '날짜', '회사명', '섹터',
    '한줄소개', '중점기술', '핵심경쟁력',
    '타겟시장', '주요고객사', '비즈니스모델',
    '경쟁사', '성장전략', '주요제품서비스'
  ];

  const headerRow2 = sheet2.addRow(headers2);
  headerRow2.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  for (const row of existingSheet2Data) sheet2.addRow(row);

  for (const company of companies) {
    const isDuplicate = existingSheet2Data.some(
      row => row[1] === company.name && row[0] === today
    );
    if (isDuplicate) continue;

    const profile = company.profile || {};
    sheet2.addRow([
      today,
      company.name,
      company.sectorName || '-',
      profile.oneLineIntro || '-',
      profile.coreTechnology || '-',
      profile.coreCompetency || '-',
      profile.targetMarket || '-',
      profile.keyClients || '-',
      profile.businessModel || '-',
      profile.competitors || '-',
      profile.growthStrategy || '-',
      profile.mainProducts || '-'
    ]);
  }

  // ㄱㄴㄷ 정렬
  const allRows2 = [];
  sheet2.eachRow((row, i) => { if (i > 1) allRows2.push(row.values.slice(1)); });
  allRows2.sort((a, b) => String(a[1] || '').localeCompare(String(b[1] || ''), 'ko'));
  sheet2.spliceRows(2, sheet2.rowCount);
  for (const row of allRows2) sheet2.addRow(row);

  sheet2.columns.forEach((col, i) => {
    col.width = [12, 16, 14, 40, 40, 40, 20, 20, 30, 20, 40, 30][i] || 20;
  });

  // ── Sheet3: 가격변동알림 ──
  const sheet3 = workbook.addWorksheet('가격변동알림');
  const priceChanges = getPriceChanges(companies, existingSheet1Data);
  buildPriceAlertSheet(sheet3, priceChanges, today);

  // 저장
  await workbook.xlsx.writeFile(thisWeekFile);
  console.log(`[excelWriter] 저장 완료: ${path.basename(thisWeekFile)} (Sheet1: ${allRows1.length}행, Sheet2: ${allRows2.length}행)`);
  } catch (err) {
    console.error(`[excelWriter] 수집 실패 - ${err.message}`);
  }
}

function getPriceChanges(companies, existingData) {
  const changes = [];
  for (const company of companies) {
    try {
      const today38 = company.price?.price38?.price;
      const todayPlus = company.price?.pricePlus?.price;

      const prevRows = existingData
        .filter(row => row[1] === company.name)
        .sort((a, b) => String(b[0]).localeCompare(String(a[0])));

      if (prevRows.length === 0) continue;
      const prev = prevRows[0];
      const prev38 = typeof prev[15] === 'number' ? prev[15] : null;
      const prevPlus = typeof prev[16] === 'number' ? prev[16] : null;

      let change38 = null, changePlus = null;
      if (today38 && prev38) change38 = Math.round(((today38 - prev38) / prev38) * 1000) / 10;
      if (todayPlus && prevPlus) changePlus = Math.round(((todayPlus - prevPlus) / prevPlus) * 1000) / 10;

      const maxChange = Math.max(Math.abs(change38 || 0), Math.abs(changePlus || 0));
      if (maxChange >= 10) {
        changes.push({
          companyName: company.name,
          price38Today: today38, price38Prev: prev38, change38,
          pricePlusToday: todayPlus, pricePlusPrev: prevPlus, changePlus,
          maxChange: Math.abs(change38 || 0) >= Math.abs(changePlus || 0) ? (change38 || 0) : (changePlus || 0),
          alertType: (Math.abs(change38 || 0) >= Math.abs(changePlus || 0) ? (change38 || 0) : (changePlus || 0)) > 0 ? '급등' : '급락'
        });
      }
    } catch (err) {
      console.error(`[excelWriter] 가격변동 감지 실패 (${company.name}):`, err.message);
    }
  }

  return changes.sort((a, b) => Math.abs(b.maxChange) - Math.abs(a.maxChange));
}

function buildPriceAlertSheet(sheet, changes, today) {
  const upCount = changes.filter(c => c.alertType === '급등').length;
  const downCount = changes.filter(c => c.alertType === '급락').length;

  sheet.addRow([`기준일: ${today} | 급등 ${upCount}개 | 급락 ${downCount}개 | 총 ${changes.length}개 종목`]);
  sheet.addRow([]);

  const headers = [
    '회사명', '기준일', '38_전일가', '38_현재가', '38_변동폭',
    '증권플러스_전일가', '증권플러스_현재가', '증권플러스_변동폭',
    '최대변동폭', '알림'
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
    cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
  });

  for (const c of changes) {
    const row = sheet.addRow([
      c.companyName, today,
      c.price38Prev || '-', c.price38Today || '-',
      c.change38 !== null ? (c.change38 > 0 ? '+' : '') + c.change38 + '%' : '-',
      c.pricePlusPrev || '-', c.pricePlusToday || '-',
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
}

module.exports = { updateExcel };
