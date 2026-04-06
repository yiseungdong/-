const axios = require('axios');

const BASE_URL = 'https://plus.kipris.or.kr/openapi/rest';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseXmlValue(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g');
  const values = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    values.push(match[1].trim());
  }
  return values;
}

async function collectPatents(companyName) {
  const apiKey = process.env.KIPRIS_API_KEY;
  if (!apiKey) {
    console.error('[kiprisApi] KIPRIS_API_KEY가 .env에 없습니다.');
    return { companyName, totalCount: 0, patents: [] };
  }

  try {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const fromDate = fiveYearsAgo.toISOString().slice(0, 10).replace(/-/g, '');

    const response = await axios.get(
      `${BASE_URL}/patUtiModInfoSearchSevice/applicantNameSearchInfo`,
      {
        params: {
          applicant: companyName,
          numOfRows: 50,
          pageNo: 1,
          ServiceKey: apiKey,
          patent: 'true',
          utility: 'false',
          lastvalue: 'true',
          registered: 'true',
          refused: 'false',
          expired: 'false',
          withdrawn: 'false',
          publish: 'false',
          application: 'false',
          cancel: 'false',
          abandonment: 'false',
        },
        headers: { 'User-Agent': 'UnlistedResearch/1.0' },
        timeout: 15000,
      }
    );

    const xml = response.data;
    const titles = parseXmlValue(xml, 'inventionTitle');
    const appNumbers = parseXmlValue(xml, 'applicationNumber');
    const appDates = parseXmlValue(xml, 'applicationDate');
    const regNumbers = parseXmlValue(xml, 'registerNumber');
    const regDates = parseXmlValue(xml, 'registerDate');
    const ipcCodes = parseXmlValue(xml, 'ipcNumber');

    const patents = [];
    for (let i = 0; i < titles.length && i < 50; i++) {
      patents.push({
        title: titles[i] || '',
        applicationNumber: appNumbers[i] || '',
        applicationDate: appDates[i] || '',
        registrationNumber: regNumbers[i] || '',
        registrationDate: regDates[i] || '',
        ipcCode: ipcCodes[i] || '',
      });
    }

    console.log(`[kiprisApi] "${companyName}" — ${patents.length}건 특허 수집 완료`);
    await sleep(2000);
    return {
      companyName,
      totalCount: patents.length,
      patents,
    };
  } catch (err) {
    console.error(`[kiprisApi] "${companyName}" 특허 조회 실패:`, err.message);
    return { companyName, totalCount: 0, patents: [] };
  }
}

module.exports = { collectPatents };
