const axios = require('axios');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchVCList() {
  try {
    const url = 'https://www.kvca.or.kr/Program/member/member_list.html';
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });

    // 차단 감지
    if (response.status === 403) {
      console.error('[KVCA] 차단 감지 (403)');
      return [];
    }

    const html = response.data;
    const vcList = [];

    // 회원사 이름 파싱 (간단한 정규식)
    const nameMatches = html.match(/<td[^>]*class="[^"]*name[^"]*"[^>]*>([^<]+)<\/td>/gi) || [];
    for (const m of nameMatches) {
      const nameMatch = m.match(/>([^<]+)</);
      if (nameMatch) {
        vcList.push({
          vcName: nameMatch[1].trim(),
          source: 'kvca.or.kr'
        });
      }
    }

    console.log(`[KVCA] VC ${vcList.length}개 수집`);
    return vcList;
  } catch (err) {
    console.error(`[KVCA] VC목록 수집 실패:`, err.message);
    return [];
  }
}

module.exports = { fetchVCList };
