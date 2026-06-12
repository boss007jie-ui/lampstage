const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const file = "file://" + path.resolve(__dirname, "../apps/web/public/promo.html").replace(/\\/g, "/");
  await page.goto(file, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const outDir = path.resolve(__dirname, "../promo-assets");
  fs.mkdirSync(outDir, { recursive: true });

  const posters = await page.$$(".poster");
  const names = ["poster1-能力.png", "poster2-用途对比.png", "poster3-多场景.png", "poster4-价格扫码.png"];
  for (let i = 0; i < posters.length; i++) {
    await posters[i].screenshot({ path: path.join(outDir, names[i]) });
    console.log("wrote", names[i]);
  }
  await browser.close();
})();
