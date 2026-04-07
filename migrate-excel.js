/**
 * 1회성 마이그레이션: 26칸→18칸 + 중복 제거
 * 새 워크북을 처음부터 생성
 */
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs-extra');

const EXCEL_DIR = path.join(__dirname, 'reports', 'excel');

function mergeStr(...items) {
  return items.filter(v => v && String(v).trim() !== '' && v !== '-').join(' / ') || '-';
}

function migrate26to18(old) {
  if (!old || old.length <= 18) return old;
  return [
    old[0] || '', old[1] || '', old[2] || '',
    old[4] || 0, old[8] || '-', old[9] || '-',
    '', old[10] || '', '',
    old[13] || '-', old[14] || '-',
    old[15] || '미등록', old[16] || '미등록', old[17] || 0,
    mergeStr(old[18], old[19], old[20]),
    mergeStr(old[21], old[22], old[23]),
    old[24] || '-', old[25] || '-',
  ];
}

function dedup(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row[0]}|${row[1]}`;
    if (!map.has(key)) { map.set(key, [...row]); continue; }
    const existing = map.get(key);
    const base = (parseFloat(row[3]) || 0) >= (parseFloat(existing[3]) || 0) ? [...row] : existing;
    const other = base === existing ? row : existing;
    for (let i = 0; i < 18; i++) {
      if (!base[i] || base[i] === '' || base[i] === '-' || base[i] === 0) {
        if (other[i] && other[i] !== '' && other[i] !== '-' && other[i] !== 0) base[i] = other[i];
      }
    }
    map.set(key, base);
  }
  return [...map.values()];
}

async function run() {
  const files = fs.readdirSync(EXCEL_DIR).filter(f => f.endsWith('.xlsx') && !f.startsWith('~$') && !f.includes('_old') && !f.includes('_migrated'));

  for (const file of files) {
    const filePath = path.join(EXCEL_DIR, file);
    console.log(`\n=== ${file} ===`);

    const oldWb = new ExcelJS.Workbook();
    await oldWb.xlsx.readFile(filePath);

    // Sheet1 읽기
    const s1 = oldWb.getWorksheet('비상장_누적');
    const rawRows = [];
    if (s1) s1.eachRow((row, i) => { if (i > 1) rawRows.push(row.values.slice(1)); });
    console.log(`Sheet1 기존: ${rawRows.length}행`);

    const migrated = dedup(rawRows.map(migrate26to18));
    console.log(`Sheet1 변환후: ${migrated.length}행 (${rawRows.length - migrated.length}건 제거)`);

    // Sheet2 읽기
    const s2 = oldWb.getWorksheet('회사프로파일');
    const s2Rows = [];
    if (s2) s2.eachRow((row, i) => { if (i > 1) s2Rows.push(row.values.slice(1)); });
    const s2Deduped = dedup(s2Rows);
    console.log(`Sheet2: ${s2Rows.length} → ${s2Deduped.length}행`);

    // Sheet4 읽기
    const s4 = oldWb.getWorksheet('VC밸류히스토리');
    const s4Rows = [];
    if (s4) s4.eachRow((row, i) => { if (i > 1) s4Rows.push(row.values.slice(1)); });

    // ── 새 워크북 생성 ──
    const newWb = new ExcelJS.Workbook();

    // Sheet1
    const ns1 = newWb.addWorksheet('비상장_누적');
    const h1 = ['날짜','회사명','섹터','매력도점수','최신라운드','투자금액(억)',
      '직전밸류(억)','현재밸류(억)','밸류소스','누적투자총액(억)','참여VC',
      '38커뮤니케이션','증권플러스','특허수','핵심강점','핵심리스크','IPO전망','출처링크'];
    const hr1 = ns1.addRow(h1);
    hr1.eachCell((cell, col) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (col === 4) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
        cell.font = { color: { argb: 'FF000000' }, bold: true };
      }
    });
    for (const row of migrated) ns1.addRow(row.slice(0, 18));
    ns1.columns.forEach((col, i) => {
      col.width = [12,16,14,10,12,12,12,20,12,14,40,14,14,8,40,40,20,30][i] || 14;
    });

    // Sheet2
    const ns2 = newWb.addWorksheet('회사프로파일');
    const h2 = ['날짜','회사명','섹터','사업요약','시장/경쟁'];
    const hr2 = ns2.addRow(h2);
    hr2.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    });
    for (const row of s2Deduped) ns2.addRow(row.slice(0, 5));
    ns2.columns.forEach((col, i) => { col.width = [12,16,14,60,60][i] || 20; });

    // Sheet3 (빈 시트)
    const ns3 = newWb.addWorksheet('가격변동알림');
    ns3.addRow(['가격변동알림 데이터 없음']);

    // Sheet4
    const ns4 = newWb.addWorksheet('VC밸류히스토리');
    const h4 = ['회사명','날짜','라운드','밸류(억)','투자금액(억)','리드투자자','전체참여VC','투자형태','밸류소스','출처'];
    const hr4 = ns4.addRow(h4);
    hr4.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A148C' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
    });
    for (const row of s4Rows) ns4.addRow(row);

    // 저장
    const outPath = path.join(EXCEL_DIR, file.replace('.xlsx', '_clean.xlsx'));
    await newWb.xlsx.writeFile(outPath);
    console.log(`저장: ${path.basename(outPath)}`);
  }
}

run().then(() => console.log('\n완료')).catch(e => console.error('오류:', e));
