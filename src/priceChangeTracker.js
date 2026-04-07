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

/**
 * 전영업일 구하기 (토/일 건너뛰기)
 */
function getPrevBusinessDay(dateStr) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * 가격 문자열을 숫자로 변환 (예: "45,000원" → 45000)
 */
function parsePrice(val) {
  if (!val || val === '미등록' || val === '-' || val === '') return null;
  const num = Number(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(num) || num === 0 ? null : num;
}

/**
 * 엑셀 전체 데이터를 읽어 모든 행 반환
 */
function loadAllExcelData() {
  if (!fs.existsSync(EXCEL_DIR)) return [];
  const files = fs.readdirSync(EXCEL_DIR).filter(f => f.endsWith('.xlsx')).sort();
  const allRows = [];

  for (const file of files) {
    try {
      const wb = XLSX.readFile(path.join(EXCEL_DIR, file));
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws);
      allRows.push(...rows);
    } catch (err) {
      console.log(`[priceChangeTracker] ${file} 읽기 실패:`, err.message);
    }
  }

  return allRows;
}

/**
 * 특정 회사의 특정 날짜 이전 가장 최근 가격 조회
 */
function findPrevPrice(allRows, companyName, todayStr) {
  const prevDate = getPrevBusinessDay(todayStr);

  // 오늘 제외, 날짜 내림차순으로 해당 회사 행 찾기
  const companyRows = allRows
    .filter(r => r['회사명'] === companyName && r['날짜'] && r['날짜'] !== todayStr)
    .sort((a, b) => (b['날짜'] > a['날짜'] ? 1 : -1));

  if (companyRows.length === 0) return { prevDate, price38: null, pricePlus: null };

  const latest = companyRows[0];
  return {
    prevDate: latest['날짜'] || prevDate,
    price38: parsePrice(latest['38커뮤니케이션']),
    pricePlus: parsePrice(latest['증권플러스']),
  };
}

/**
 * 가격 변동 10% 이상 종목 추출
 */
async function getChanges() {
  const today = getToday();

  if (!fs.existsSync(EXCEL_DIR)) {
    console.log('[priceChangeTracker] 엑셀 폴더 없음');
    return [];
  }

  const allRows = loadAllExcelData();
  if (allRows.length === 0) {
    console.log('[priceChangeTracker] 엑셀 데이터 없음');
    return [];
  }

  // 오늘 데이터만 추출
  const todayRows = allRows.filter(r => r['날짜'] === today);
  if (todayRows.length === 0) {
    console.log('[priceChangeTracker] 오늘 데이터 없음');
    return [];
  }

  const results = [];

  for (const row of todayRows) {
    const name = row['회사명'];
    if (!name) continue;

    const price38Today = parsePrice(row['38커뮤니케이션']);
    const pricePlusToday = parsePrice(row['증권플러스']);

    // 오늘 가격이 둘 다 없으면 건너뛰기
    if (price38Today === null && pricePlusToday === null) continue;

    const prev = findPrevPrice(allRows, name, today);

    // 전영업일 가격이 둘 다 없으면 건너뛰기
    if (prev.price38 === null && prev.pricePlus === null) continue;

    // 변동폭 계산
    let change38 = null;
    if (price38Today !== null && prev.price38 !== null) {
      change38 = ((price38Today - prev.price38) / prev.price38) * 100;
    }

    let changePlus = null;
    if (pricePlusToday !== null && prev.pricePlus !== null) {
      changePlus = ((pricePlusToday - prev.pricePlus) / prev.pricePlus) * 100;
    }

    // 10% 이상 변동 체크
    const abs38 = change38 !== null ? Math.abs(change38) : 0;
    const absPlus = changePlus !== null ? Math.abs(changePlus) : 0;

    if (abs38 < 10 && absPlus < 10) continue;

    // 최대 변동폭 (절대값 기준으로 더 큰 쪽)
    let maxChange;
    if (abs38 >= absPlus) {
      maxChange = change38;
    } else {
      maxChange = changePlus;
    }

    results.push({
      companyName: name,
      date: today,
      price38Today,
      price38Prev: prev.price38,
      change38,
      pricePlusToday,
      pricePlusPrev: prev.pricePlus,
      changePlus,
      alertType: maxChange > 0 ? '급등' : '급락',
      maxChange,
      prevDate: prev.prevDate,
    });
  }

  // 최대변동폭 절대값 기준 내림차순 정렬
  results.sort((a, b) => Math.abs(b.maxChange) - Math.abs(a.maxChange));

  return results;
}

module.exports = { getChanges, getPrevBusinessDay };
