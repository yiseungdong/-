const puppeteer = require('puppeteer');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function search(companyName) {
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    const searchUrl = `https://www.nextunicorn.kr/search?q=${encodeURIComponent(companyName)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 차단 감지
    const status = await page.evaluate(() => document.title);
    if (status.includes('403') || status.toLowerCase().includes('captcha')) {
      console.error(`[넥스트유니콘] "${companyName}" 차단 감지 (403/captcha)`);
      return null;
    }

    const firstResult = await page.$('a[href*="/company/"]');
    if (!firstResult) {
      console.log(`[넥스트유니콘] "${companyName}" 검색결과 없음`);
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
        description: getText('.company-description, [class*="desc"]'),
      };
    });

    return {
      companyName,
      description: data.description,
      investmentHistory: [],
      source: 'nextunicorn.kr'
    };
  } catch (err) {
    console.error(`[넥스트유니콘] "${companyName}" 수집 실패:`, err.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { search };
