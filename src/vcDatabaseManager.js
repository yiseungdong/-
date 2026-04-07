const fs = require('fs-extra');
const path = require('path');

const DB_PATH = path.join(__dirname, '../public/data/vc-database.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    }
  } catch (err) {
    console.error('[vcDB] DB 로드 실패:', err.message);
  }
  return { lastUpdated: null, vcList: [] };
}

function saveDB(db) {
  fs.ensureDirSync(path.dirname(DB_PATH));
  db.lastUpdated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

function getVCTier(vcName) {
  const db = loadDB();
  const normalizedName = vcName.toLowerCase().trim();

  const found = db.vcList.find(vc => {
    if (vc.name.toLowerCase() === normalizedName) return true;
    if ((vc.aliases || []).some(a => a.toLowerCase() === normalizedName)) return true;
    // 부분 매칭도 시도
    if (vc.name.toLowerCase().includes(normalizedName) || normalizedName.includes(vc.name.toLowerCase())) return true;
    return false;
  });

  if (found) return found.tier;

  // 미등록 VC → 자동 추가
  db.vcList.push({
    name: vcName,
    aliases: [],
    tier: 'unknown',
    type: 'VC',
    investmentFocus: [],
    fundSize: null,
    foundedYear: null,
    notablePortfolio: [],
    source: 'auto-detected'
  });
  saveDB(db);
  return 'unknown';
}

function getVCInfo(vcName) {
  const db = loadDB();
  const normalizedName = vcName.toLowerCase().trim();
  return db.vcList.find(vc => {
    if (vc.name.toLowerCase() === normalizedName) return true;
    if ((vc.aliases || []).some(a => a.toLowerCase() === normalizedName)) return true;
    if (vc.name.toLowerCase().includes(normalizedName) || normalizedName.includes(vc.name.toLowerCase())) return true;
    return false;
  }) || null;
}

async function updateVCDatabase(newVCNames) {
  const db = loadDB();
  let added = 0;
  for (const name of newVCNames) {
    const exists = db.vcList.some(vc =>
      vc.name.toLowerCase() === name.toLowerCase() ||
      (vc.aliases || []).some(a => a.toLowerCase() === name.toLowerCase())
    );
    if (!exists) {
      db.vcList.push({
        name,
        aliases: [],
        tier: 'unknown',
        type: 'VC',
        investmentFocus: [],
        fundSize: null,
        foundedYear: null,
        notablePortfolio: [],
        source: 'auto-detected'
      });
      added++;
    }
  }
  if (added > 0) {
    saveDB(db);
    console.log(`[vcDB] ${added}개 신규 VC 자동 등록`);
  }
}

module.exports = { loadDB, saveDB, getVCTier, getVCInfo, updateVCDatabase };
