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
  // 주차 계산
  const oneJan = new Date(y, 0, 1);
  const weekNum = Math.ceil(((now - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  return `비상장_${y}-${m}_W${String(weekNum).padStart(2, '0')}.xlsx`;
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

  let existingData = [];

  // 기존 파일이 있으면 읽기
  try {
    if (await fs.pathExists(filePath)) {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      existingData = XLSX.utils.sheet_to_json(ws);
    }
  } catch (err) {
    console.log('[excelWriter] 기존 엑셀 읽기 실패, 새로 생성:', err.message);
  }

  // 새 데이터 추가
  for (const r of analysisResults) {
    const vc = r.vcHistory || {};
    const latestRound = vc.rounds && vc.rounds.length > 0
      ? vc.rounds[vc.rounds.length - 1]
      : {};
    const bi = r.basicInfo || {};

    existingData.push({
      날짜: today,
      회사명: r.name || '',
      업종: r.industry || '',
      DART상태: r.listingType || '',
      매력도: r.score || 0,
      설립연도: bi.foundedYear || '',
      대표자: bi.ceo || '',
      주요제품: bi.mainProduct || '',
      추정기업가치_억: bi.estimatedValue || '',
      최신라운드: latestRound.roundName || '',
      투자금액_억: latestRound.amount || '',
      밸류에이션_억: latestRound.valuation || '',
      누적투자_억: vc.totalRaised || '',
      밸류상승률: vc.valuationGrowth || '',
      '38커뮤니케이션': r.price && r.price.price38 ? r.price.price38.price : '미등록',
      증권플러스: r.price && r.price.pricePlus ? r.price.pricePlus.price : '미등록',
      특허수: r.patents ? r.patents.totalCount || 0 : 0,
      강점1: r.strengths && r.strengths[0] || '',
      강점2: r.strengths && r.strengths[1] || '',
      강점3: r.strengths && r.strengths[2] || '',
      리스크1: r.risks && r.risks[0] || '',
      리스크2: r.risks && r.risks[1] || '',
      리스크3: r.risks && r.risks[2] || '',
      IPO전망: r.ipoOutlook || '',
      노출이유: r.reason || '',
      출처링크: r.link || '',
    });
  }

  // 엑셀 쓰기 (기존 시트 유지)
  let wb;
  try {
    if (await fs.pathExists(filePath)) {
      wb = XLSX.readFile(filePath);
    } else {
      wb = XLSX.utils.book_new();
    }
  } catch (err) {
    wb = XLSX.utils.book_new();
  }

  // 기존 비상장_누적 시트 제거 후 재생성
  const sheetIdx = wb.SheetNames.indexOf('비상장_누적');
  if (sheetIdx !== -1) {
    wb.SheetNames.splice(sheetIdx, 1);
    delete wb.Sheets['비상장_누적'];
  }

  const ws = XLSX.utils.json_to_sheet(existingData);

  // 컬럼 너비
  const cols = Object.keys(existingData[0] || {}).map((key) => ({
    wch: Math.max(key.length * 2, 10),
  }));
  ws['!cols'] = cols;

  // 비상장_누적을 첫 번째 시트로 삽입
  wb.SheetNames.unshift('비상장_누적');
  wb.Sheets['비상장_누적'] = ws;

  XLSX.writeFile(wb, filePath);

  console.log(`[excelWriter] ${fileName} — ${analysisResults.length}건 추가 (총 ${existingData.length}행)`);
}

/**
 * Sheet4: 가격변동알림 업데이트
 */
async function updatePriceAlert(priceChanges) {
  await fs.ensureDir(EXCEL_DIR);

  const today = getToday();
  const fileName = getWeekFileName();
  const filePath = path.join(EXCEL_DIR, fileName);

  // 기존 엑셀 읽기
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

  // 기존 Sheet4 제거 (있으면)
  const sheetName = '가격변동알림';
  const idx = wb.SheetNames.indexOf(sheetName);
  if (idx !== -1) {
    wb.SheetNames.splice(idx, 1);
    delete wb.Sheets[sheetName];
  }

  // 새 시트 데이터 구성
  const ws = {};
  const colWidths = [14, 12, 14, 14, 12, 18, 18, 16, 12, 10];

  // 전영업일 계산
  const prevDate = priceChanges.length > 0 && priceChanges[0].prevDate
    ? priceChanges[0].prevDate
    : '';

  // 스타일 정의
  const headerFill = { fgColor: { rgb: 'C00000' } };
  const headerFont = { bold: true, color: { rgb: 'FFFFFF' } };
  const upFill = { fgColor: { rgb: 'FFE0E0' } };
  const downFill = { fgColor: { rgb: 'E0E8FF' } };

  if (!priceChanges || priceChanges.length === 0) {
    // 데이터 없을 때
    ws['A1'] = { v: '전영업일 가격 데이터 없음 (첫째 날 실행)', t: 's' };
    ws['!ref'] = 'A1:A1';
  } else {
    // 1행: 기준일 요약
    const upCount = priceChanges.filter(p => p.alertType === '급등').length;
    const downCount = priceChanges.filter(p => p.alertType === '급락').length;

    ws['A1'] = { v: `기준일: ${today} | 전영업일: ${prevDate}`, t: 's' };
    ws['A2'] = { v: `급등 ${upCount}개 | 급락 ${downCount}개 | 총 ${priceChanges.length}개 종목`, t: 's' };
    // 3행: 빈 행

    // 4행: 헤더
    const headers = ['회사명', '기준일', '38_전일가', '38_현재가', '38_변동폭',
      '증권플러스_전일가', '증권플러스_현재가', '증권플러스_변동폭', '최대변동폭', '알림'];

    headers.forEach((h, ci) => {
      const cellRef = XLSX.utils.encode_cell({ r: 3, c: ci });
      ws[cellRef] = {
        v: h, t: 's',
        s: { fill: headerFill, font: headerFont, alignment: { horizontal: 'center' } }
      };
    });

    // 5행부터: 데이터
    priceChanges.forEach((p, ri) => {
      const row = ri + 4; // 0-indexed, 4행(헤더) 다음
      const isUp = p.alertType === '급등';
      const rowFill = isUp ? upFill : downFill;
      const rowStyle = { fill: rowFill };

      const fmt38 = p.change38 !== null ? `${p.change38 > 0 ? '+' : ''}${p.change38.toFixed(1)}%` : '-';
      const fmtPlus = p.changePlus !== null ? `${p.changePlus > 0 ? '+' : ''}${p.changePlus.toFixed(1)}%` : '-';
      const fmtMax = `${p.maxChange > 0 ? '+' : ''}${p.maxChange.toFixed(1)}%`;

      const cells = [
        p.companyName,
        p.date,
        p.price38Prev !== null ? p.price38Prev.toLocaleString() : '-',
        p.price38Today !== null ? p.price38Today.toLocaleString() : '-',
        fmt38,
        p.pricePlusPrev !== null ? p.pricePlusPrev.toLocaleString() : '-',
        p.pricePlusToday !== null ? p.pricePlusToday.toLocaleString() : '-',
        fmtPlus,
        fmtMax,
        isUp ? '\uD83D\uDD34 급등' : '\uD83D\uDD35 급락',
      ];

      cells.forEach((val, ci) => {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: ci });
        ws[cellRef] = { v: val, t: 's', s: rowStyle };
      });
    });

    // 범위 설정
    const lastRow = 4 + priceChanges.length - 1;
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: 9 } });
  }

  // 컬럼 너비
  ws['!cols'] = colWidths.map(w => ({ wch: w }));

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filePath);

  console.log(`[excelWriter] Sheet4 가격변동알림 업데이트 — ${priceChanges.length}건`);
}

module.exports = { updateExcel, updatePriceAlert };
