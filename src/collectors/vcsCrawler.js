const puppeteer = require('puppeteer');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function search(companyName) {
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    await page.goto('https://www.vcs.go.kr/web/portal/company/list', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // 차단 감지
    const status = await page.evaluate(() => document.title);
    if (status.includes('403') || status.toLowerCase().includes('captcha')) {
      console.error(`[VCS] "${companyName}" 차단 감지 (403/captcha)`);
      return null;
    }

    // 검색 입력
    const searchInput = await page.$('input[type="text"], input[name*="search"], #searchKeyword');
    if (searchInput) {
      await searchInput.type(companyName, { delay: 100 });
      await page.keyboard.press('Enter');
      await sleep(3000);
    }

    const data = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr, .company-item');
      if (rows.length === 0) return null;
      const first = rows[0];
      const cells = first.querySelectorAll('td, span');
      return {
        sector: cells[2]?.textContent?.trim() || null,
        investmentStage: cells[3]?.textContent?.trim() || null,
        region: cells[4]?.textContent?.trim() || null,
      };
    });

    if (!data) return null;

    return {
      companyName,
      sector: data.sector,
      investmentStage: data.investmentStage,
      region: data.region,
      source: 'vcs.go.kr'
    };
  } catch (err) {
    console.error(`[VCS] "${companyName}" 수집 실패:`, err.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { search };
