/**
 * migrate-sort-accumulated.js
 * 비상장_누적 시트를 종목별 가나다순 + 날짜순으로 재정렬
 */
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function migrateSortAccumulated() {
  // 엑셀 파일 경로 찾기
  const excelDir = path.join(__dirname, '..', 'reports', 'excel');
  let excelPath = null;

  if (fs.existsSync(excelDir)) {
    const files = fs.readdirSync(excelDir)
      .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'))
      .sort()
      .reverse();
    if (files.length > 0) excelPath = path.join(excelDir, files[0]);
  }

  if (!excelPath) {
    console.error('엑셀 파일을 찾을 수 없습니다.');
    process.exit(1);
  }

  console.log(`파일 발견: ${excelPath}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);

  // Sheet1 찾기
  let sheet1 = workbook.getWorksheet('비상장_누적');
  if (!sheet1) {
    sheet1 = workbook.worksheets[0];
    console.log(`'비상장_누적' 시트를 못 찾아 첫 번째 시트(${sheet1.name})를 사용합니다.`);
  }

  // 헤더 행(1행) 추출
  const headerRow = sheet1.getRow(1).values.slice(1);
  console.log('헤더:', headerRow);

  // 데이터 행 추출 (2행부터)
  const dataRows = [];
  sheet1.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values.slice(1);
    if (values.length > 0 && values.some(v => v !== null && v !== undefined && v !== '')) {
      dataRows.push(values);
    }
  });

  console.log(`총 데이터 행: ${dataRows.length}개`);

  // 회사명 컬럼 인덱스 자동 탐지
  let companyIdx = 1; // 기본값: B열 (0-index)
  let dateIdx = 0;    // 기본값: A열 (0-index)

  headerRow.forEach((h, i) => {
    if (typeof h === 'string') {
      if (h.includes('회사명')) companyIdx = i;
      if (h.includes('날짜')) dateIdx = i;
    }
  });

  console.log(`날짜 컬럼: ${dateIdx}번째, 회사명 컬럼: ${companyIdx}번째`);

  // 중복 제거 (같은 날짜 + 같은 회사명 → 매력도 높은 것 유지, 빈값 병합)
  const scoreIdx = headerRow.findIndex(h => typeof h === 'string' && h.includes('매력도'));
  const dedupMap = new Map();
  for (const row of dataRows) {
    const dateStr = row[dateIdx] instanceof Date
      ? row[dateIdx].toISOString().slice(0, 10)
      : String(row[dateIdx] || '');
    const key = `${dateStr}|${row[companyIdx]}`;
    if (!dedupMap.has(key)) {
      dedupMap.set(key, row);
    } else {
      const existing = dedupMap.get(key);
      const newScore = parseFloat(row[scoreIdx >= 0 ? scoreIdx : 3]) || 0;
      const existingScore = parseFloat(existing[scoreIdx >= 0 ? scoreIdx : 3]) || 0;
      const base = newScore >= existingScore ? [...row] : [...existing];
      const other = newScore >= existingScore ? existing : row;
      for (let i = 0; i < base.length; i++) {
        if (!base[i] || base[i] === '' || base[i] === '-' || base[i] === 0) {
          if (other[i] && other[i] !== '' && other[i] !== '-' && other[i] !== 0) {
            base[i] = other[i];
          }
        }
      }
      dedupMap.set(key, base);
    }
  }
  const dedupedRows = [...dedupMap.values()];
  console.log(`중복 제거: ${dataRows.length}개 → ${dedupedRows.length}개 (${dataRows.length - dedupedRows.length}개 제거)`);

  // 정렬
  dedupedRows.sort((a, b) => {
    const nameA = String(a[companyIdx] || '');
    const nameB = String(b[companyIdx] || '');
    const nameCompare = nameA.localeCompare(nameB, 'ko');
    if (nameCompare !== 0) return nameCompare;

    const rawA = a[dateIdx];
    const rawB = b[dateIdx];
    const dateA = rawA instanceof Date ? rawA : new Date(rawA);
    const dateB = rawB instanceof Date ? rawB : new Date(rawB);
    return dateA - dateB;
  });

  // 시트 비우고 다시 쓰기 (헤더 보존)
  const totalRows = sheet1.rowCount;
  for (let i = totalRows; i >= 2; i--) {
    sheet1.spliceRows(i, 1);
  }

  // 정렬된 데이터 다시 삽입
  dedupedRows.forEach((rowData, idx) => {
    const newRow = sheet1.insertRow(idx + 2, rowData);
    if (rowData[dateIdx] instanceof Date) {
      newRow.getCell(dateIdx + 1).numFmt = 'yyyy-mm-dd';
    }
  });

  // 저장
  await workbook.xlsx.writeFile(excelPath);
  console.log(`완료! 종목별 가나다순 + 날짜순으로 재정렬되었습니다.`);
  console.log(`   저장 위치: ${excelPath}`);

  // 결과 미리보기 (상위 10개)
  console.log('\n정렬 결과 미리보기 (상위 10행):');
  dedupedRows.slice(0, 10).forEach((row, i) => {
    console.log(`  ${i+1}. [${row[dateIdx]}] ${row[companyIdx]}`);
  });
}

migrateSortAccumulated().catch(console.error);
