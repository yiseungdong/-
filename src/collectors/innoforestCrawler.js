const puppeteer = require('puppeteer');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function search(companyName) {
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const searchUrl = `https://www.innoforest.co.kr/company?keyword=${encodeURIComponent(companyName)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 차단 감지
    const status = await page.evaluate(() => document.title);
    if (status.includes('403') || status.toLowerCase().includes('captcha')) {
      console.error(`[혁신의숲] "${companyName}" 차단 감지 (403/captcha)`);
      return null;
    }

    // 검색결과 첫번째 회사 클릭
    const firstResult = await page.$('a[href*="/company/"]');
    if (!firstResult) {
      console.log(`[혁신의숲] "${companyName}" 검색결과 없음`);
      return null;
    }

    const href = await page.evaluate(el => el.href, firstResult);
    await page.goto(href, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    const data = await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : null;
      };

      return {
        description: getText('.company-intro, .description, [class*="intro"]'),
        sector: getText('.sector, .industry, [class*="sector"]'),
        foundedYear: getText('.founded, [class*="founded"]'),
      };
    });

    return {
      companyName,
      description: data.description,
      sector: data.sector,
      foundedYear: data.foundedYear ? parseInt(data.foundedYear) : null,
      investmentHistory: [],
      financials: null,
      employees: null,
      mau: null,
      patents: null,
      mainProducts: null,
      source: 'innoforest.co.kr'
    };
  } catch (err) {
    console.error(`[혁신의숲] "${companyName}" 수집 실패:`, err.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { search };
