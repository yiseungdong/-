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

  // 참여VC 포맷: "[리드] 소뱅 / 캡스톤 / 산업은행"
  const leadVC = latestRound.leadVC || (latestRound.investors?.[0] || '');
  const otherVCs = (latestRound.investors || []).filter(v => v !== leadVC);
  const vcStr = leadVC
    ? `[리드] ${leadVC}${otherVCs.length > 0 ? ' / ' + otherVCs.join(' / ') : ''}`
    : (latestRound.investors || []).join(' / ') || '-';

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

  // 사업요약: 한줄소개 + 주요제품서비스 + 핵심기술 + 핵심경쟁력 + 비즈니스모델 통합
  const bizParts = [
    profile.oneLineIntro,
    profile.mainProducts,
    profile.coreTechnology,
    profile.coreCompetency,
    profile.businessModel
  ].filter(Boolean);
  const bizSummary = bizParts.join(' | ') || '-';

  // 시장/경쟁: 타겟시장 + 주요고객사 + 경쟁사 + 성장전략 통합
  const marketParts = [
    profile.targetMarket,
    profile.keyClients,
    profile.competitors,
    profile.growthStrategy
  ].filter(Boolean);
  const marketCompetition = marketParts.join(' | ') || '-';

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

  sheet.addRow([`기준일: ${today} | 급등 ${upCount}개 | 급락 ${downCount}개 | 총 ${changes.length}개 종목`]);
  sheet.addRow([]);

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

    // 기존 데이터 복원
    for (const row of existingSheet1Data) sheet1.addRow(row);

    // 새 데이터 추가 (중복: 같은 회사명 + 같은 날짜 스킵)
    for (const company of companies) {
      const isDuplicate = existingSheet1Data.some(
        row => row[1] === company.name && row[0] === today
      );
      if (isDuplicate) continue;
      sheet1.addRow(toSheet1Row(company, today));
    }

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

    // 기존 데이터 복원
    for (const row of existingSheet2Data) sheet2.addRow(row);

    // 새 데이터 추가 (중복 스킵)
    for (const company of companies) {
      const isDuplicate = existingSheet2Data.some(
        row => row[1] === company.name && row[0] === today
      );
      if (isDuplicate) continue;
      sheet2.addRow(toSheet2Row(company, today));
    }

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
