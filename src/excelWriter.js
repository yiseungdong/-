const fs = require('fs-extra');
const path = require('path');
const XLSX = require('xlsx');

const EXCEL_DIR = path.join(__dirname, '..', 'reports', 'excel');

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekFileName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const oneJan = new Date(y, 0, 1);
  const weekNum = Math.ceil(((now - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  return `비상장_${y}-${m}_W${String(weekNum).padStart(2, '0')}.xlsx`;
}

// Sheet1 컬럼 순서 (A~Z, 26개)
const SHEET1_HEADERS = [
  '날짜', '회사명', '섹터', '성장성등급', '매력도점수', '점수세부내역',
  '평가등급', '노출이유', '최신라운드', '투자금액(억)', '밸류에이션(억)',
  '적정밸류(억)', '저평가율(%)', '누적투자총액(억)', '참여VC',
  '38커뮤니케이션', '증권플러스', '특허수',
  '강점1', '강점2', '강점3', '리스크1', '리스크2', '리스크3',
  'IPO전망', '출처링크',
];

// Sheet2 회사프로파일 컬럼 (12개)
const SHEET2_HEADERS = [
  '날짜', '회사명', '섹터', '한줄소개', '중점기술', '핵심경쟁력',
  '타겟시장', '주요고객사', '비즈니스모델', '경쟁사', '성장전략', '주요제품서비스',
];

function getParticipatingVCs(vcHistory) {
  if (!vcHistory || !vcHistory.rounds) return '';
  const allVCs = vcHistory.rounds
    .flatMap(r => r.investors || [])
    .filter(Boolean);
  return [...new Set(allVCs)].join(', ');
}

function koreanSort(a, b) {
  return (a || '').localeCompare(b || '', 'ko');
}

function sortData(data) {
  return data.sort((a, b) => {
    const nameCompare = koreanSort(a['회사명'], b['회사명']);
    if (nameCompare !== 0) return nameCompare;
    return (a['날짜'] || '').localeCompare(b['날짜'] || '');
  });
}

function applyHeaderStyle(ws, headers, bgColor, highlightCols) {
  for (let ci = 0; ci < headers.length; ci++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: ci });
    if (!ws[cellRef]) continue;
    ws[cellRef].s = {
      fill: { fgColor: { rgb: bgColor } },
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'center' },
    };
  }
  if (highlightCols) {
    for (const ci of highlightCols) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (!ws[cellRef]) continue;
      ws[cellRef].s = {
        fill: { fgColor: { rgb: 'FFF3CD' } },
        font: { bold: true, color: { rgb: '000000' } },
        alignment: { horizontal: 'center' },
      };
    }
  }
}

function createSheet(data, headers) {
  const ordered = data.map(row => {
    const obj = {};
    for (const h of headers) {
      obj[h] = row[h] !== undefined ? row[h] : '';
    }
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(ordered, { header: headers });

  ws['!cols'] = headers.map(h => {
    let maxLen = h.length * 2;
    for (const row of ordered) {
      const val = String(row[h] || '');
      maxLen = Math.max(maxLen, val.length * 1.2);
    }
    return { wch: Math.max(Math.min(maxLen, 50), 10) };
  });

  return ws;
}

/**
 * 분석 결과 1건 → Sheet1 행
 * scoreEngine + valuationEngine + sectorClassifier 데이터 사용
 */
function toSheet1Row(r, today) {
  const vc = r.vcHistory || {};
  const rounds = vc.rounds || [];
  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : {};
  const valData = r.valuation || {};

  // 점수세부내역: scoreEngine의 breakdownStr 우선, 없으면 breakdown 직접 생성
  const breakdownStr = r.scoreBreakdownStr
    || (r.scoreBreakdown
      ? Object.entries(r.scoreBreakdown).map(([k, val]) => `${k}:${val}`).join(' | ')
      : '');

  return {
    '날짜': today,
    '회사명': r.name || '',
    '섹터': r.sectorName || r.industry || '',
    '성장성등급': r.growthGrade || '',
    '매력도점수': r.score || 0,
    '점수세부내역': breakdownStr,
    '평가등급': valData.evaluation || '-',
    '노출이유': r.reason || '',
    '최신라운드': latestRound.roundName || '',
    '투자금액(억)': latestRound.amount || '',
    '밸류에이션(억)': latestRound.valuation || '',
    '적정밸류(억)': valData.fairValue || '',
    '저평가율(%)': valData.undervalueRate !== null && valData.undervalueRate !== undefined ? valData.undervalueRate : '',
    '누적투자총액(억)': vc.totalRaised || '',
    '참여VC': getParticipatingVCs(vc),
    '38커뮤니케이션': r.price && r.price.price38 ? r.price.price38.price : '미등록',
    '증권플러스': r.price && r.price.pricePlus ? r.price.pricePlus.price : '미등록',
    '특허수': r.patents ? r.patents.totalCount || 0 : 0,
    '강점1': r.strengths && r.strengths[0] || '',
    '강점2': r.strengths && r.strengths[1] || '',
    '강점3': r.strengths && r.strengths[2] || '',
    '리스크1': r.risks && r.risks[0] || '',
    '리스크2': r.risks && r.risks[1] || '',
    '리스크3': r.risks && r.risks[2] || '',
    'IPO전망': r.ipoOutlook || '',
    '출처링크': r.link || '',
  };
}

/**
 * 분석 결과 1건 → Sheet2 회사프로파일 행
 */
function toSheet2Row(r, today) {
  const p = r.profile || {};
  return {
    '날짜': today,
    '회사명': r.name || '',
    '섹터': r.sectorName || r.industry || '',
    '한줄소개': p.oneLineIntro || '',
    '중점기술': p.coreTechnology || '',
    '핵심경쟁력': p.coreCompetency || '',
    '타겟시장': p.targetMarket || '',
    '주요고객사': p.keyClients || '',
    '비즈니스모델': p.businessModel || '',
    '경쟁사': p.competitors || '',
    '성장전략': p.growthStrategy || '',
    '주요제품서비스': p.mainProducts || '',
  };
}

/**
 * 분석 결과를 주차별 엑셀에 누적 저장
 */
async function updateExcel(analysisResults) {
  if (!analysisResults || analysisResults.length === 0) return;

  await fs.ensureDir(EXCEL_DIR);

  const today = getToday();
  const fileName = getWeekFileName();
  const filePath = path.join(EXCEL_DIR, fileName);

  let existingSheet1 = [];
  let existingSheet2 = [];
  let existingPriceAlert = null;

  try {
    if (await fs.pathExists(filePath)) {
      const wb = XLSX.readFile(filePath);
      if (wb.Sheets['비상장_누적']) {
        existingSheet1 = XLSX.utils.sheet_to_json(wb.Sheets['비상장_누적']);
      }
      if (wb.Sheets['회사프로파일']) {
        existingSheet2 = XLSX.utils.sheet_to_json(wb.Sheets['회사프로파일']);
      }
      if (wb.Sheets['가격변동알림']) {
        existingPriceAlert = wb.Sheets['가격변동알림'];
      }
    }
  } catch (err) {
    console.log('[excelWriter] 기존 엑셀 읽기 실패, 새로 생성:', err.message);
  }

  for (const r of analysisResults) {
    existingSheet1.push(toSheet1Row(r, today));
    existingSheet2.push(toSheet2Row(r, today));
  }

  sortData(existingSheet1);
  sortData(existingSheet2);

  const wb = XLSX.utils.book_new();

  // Sheet1: 비상장_누적 (E/F열 노란색)
  const ws1 = createSheet(existingSheet1, SHEET1_HEADERS);
  applyHeaderStyle(ws1, SHEET1_HEADERS, '1F4E79', [4, 5]);
  XLSX.utils.book_append_sheet(wb, ws1, '비상장_누적');

  // Sheet2: 회사프로파일
  const ws2 = createSheet(existingSheet2, SHEET2_HEADERS);
  applyHeaderStyle(ws2, SHEET2_HEADERS, '1B5E20');
  XLSX.utils.book_append_sheet(wb, ws2, '회사프로파일');

  // Sheet3: 가격변동알림
  if (existingPriceAlert) {
    XLSX.utils.book_append_sheet(wb, existingPriceAlert, '가격변동알림');
  }

  XLSX.writeFile(wb, filePath);
  console.log(`[excelWriter] ${fileName} — ${analysisResults.length}건 추가 (Sheet1: ${existingSheet1.length}행, Sheet2: ${existingSheet2.length}행)`);
}

/**
 * Sheet3: 가격변동알림 업데이트
 */
async function updatePriceAlert(priceChanges) {
  await fs.ensureDir(EXCEL_DIR);

  const today = getToday();
  const fileName = getWeekFileName();
  const filePath = path.join(EXCEL_DIR, fileName);

  let wb;
  try {
    if (await fs.pathExists(filePath)) {
      wb = XLSX.readFile(filePath);
    } else {
      wb = XLSX.utils.book_new();
    }
  } catch (err) {
    console.log('[excelWriter] 엑셀 읽기 실패, 새로 생성:', err.message);
    wb = XLSX.utils.book_new();
  }

  const sheetName = '가격변동알림';
  const idx = wb.SheetNames.indexOf(sheetName);
  if (idx !== -1) {
    wb.SheetNames.splice(idx, 1);
    delete wb.Sheets[sheetName];
  }

  const ws = {};
  const colWidths = [14, 12, 14, 14, 12, 18, 18, 16, 12, 10];

  const headerFill = { fgColor: { rgb: 'C00000' } };
  const headerFont = { bold: true, color: { rgb: 'FFFFFF' } };
  const upFill = { fgColor: { rgb: 'FFE0E0' } };
  const downFill = { fgColor: { rgb: 'E0E8FF' } };

  if (!priceChanges || priceChanges.length === 0) {
    ws['A1'] = { v: '전영업일 가격 데이터 없음 (첫째 날 실행)', t: 's' };
    ws['!ref'] = 'A1:A1';
  } else {
    const prevDate = priceChanges[0].prevDate || '';
    const upCount = priceChanges.filter(p => p.alertType === '급등').length;
    const downCount = priceChanges.filter(p => p.alertType === '급락').length;

    ws['A1'] = { v: `기준일: ${today} | 전영업일: ${prevDate}`, t: 's' };
    ws['A2'] = { v: `급등 ${upCount}개 | 급락 ${downCount}개 | 총 ${priceChanges.length}개 종목`, t: 's' };

    const headers = ['회사명', '기준일', '38_전일가', '38_현재가', '38_변동폭',
      '증권플러스_전일가', '증권플러스_현재가', '증권플러스_변동폭', '최대변동폭', '알림'];

    headers.forEach((h, ci) => {
      const cellRef = XLSX.utils.encode_cell({ r: 3, c: ci });
      ws[cellRef] = {
        v: h, t: 's',
        s: { fill: headerFill, font: headerFont, alignment: { horizontal: 'center' } }
      };
    });

    priceChanges.forEach((p, ri) => {
      const row = ri + 4;
      const isUp = p.alertType === '급등';
      const rowStyle = { fill: isUp ? upFill : downFill };

      const fmt38 = p.change38 !== null ? `${p.change38 > 0 ? '+' : ''}${p.change38.toFixed(1)}%` : '-';
      const fmtPlus = p.changePlus !== null ? `${p.changePlus > 0 ? '+' : ''}${p.changePlus.toFixed(1)}%` : '-';
      const fmtMax = `${p.maxChange > 0 ? '+' : ''}${p.maxChange.toFixed(1)}%`;

      const cells = [
        p.companyName, p.date,
        p.price38Prev !== null ? p.price38Prev.toLocaleString() : '-',
        p.price38Today !== null ? p.price38Today.toLocaleString() : '-',
        fmt38,
        p.pricePlusPrev !== null ? p.pricePlusPrev.toLocaleString() : '-',
        p.pricePlusToday !== null ? p.pricePlusToday.toLocaleString() : '-',
        fmtPlus, fmtMax,
        isUp ? '🔴 급등' : '🔵 급락',
      ];

      cells.forEach((val, ci) => {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: ci });
        ws[cellRef] = { v: val, t: 's', s: rowStyle };
      });
    });

    const lastRow = 4 + priceChanges.length - 1;
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: 9 } });
  }

  ws['!cols'] = colWidths.map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filePath);

  console.log(`[excelWriter] Sheet3 가격변동알림 업데이트 — ${priceChanges.length}건`);
}

module.exports = { updateExcel, updatePriceAlert };
