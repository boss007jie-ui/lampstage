const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch();
  const outDir = path.resolve(__dirname, "../promo-assets/screens");
  fs.mkdirSync(outDir, { recursive: true });

  // 手机竖屏 + 中文 locale（朋友圈给中国朋友看）
  const ctx = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9" },
  });
  const page = await ctx.newPage();

  const shots = [
    ["https://lampstage.com", "home.png", 2500],
    ["https://lampstage.com/workspace", "workspace.png", 3000],
    ["https://lampstage.com/credits", "credits.png", 2500],
  ];

  for (const [url, name, wait] of shots) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(wait);
      await page.screenshot({ path: path.join(outDir, name), fullPage: false });
      console.log("shot", name);
    } catch (e) {
      console.log("FAIL", name, String(e).slice(0, 100));
    }
  }

  // 桌面版首页（宽屏，展示更完整）
  const wideCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9" },
  });
  const wide = await wideCtx.newPage();
  try {
    await wide.goto("https://lampstage.com", { waitUntil: "networkidle", timeout: 60000 });
    await wide.waitForTimeout(2500);
    await wide.screenshot({ path: path.join(outDir, "home-wide.png") });
    console.log("shot home-wide.png");
  } catch (e) {
    console.log("FAIL home-wide", String(e).slice(0, 100));
  }

  await browser.close();
})();
