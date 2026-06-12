const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const file = "file://" + path.resolve(__dirname, "../apps/web/public/logo-avatar.html").replace(/\\/g, "/");
  await page.goto(file, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const variants = [
    [".v1", "logo-v1-dark-text.png"],
    [".v2", "logo-v2-dark-icon.png"],
    [".v3", "logo-v3-light.png"],
  ];
  const outDir = path.resolve(__dirname, "../logo-out");
  require("fs").mkdirSync(outDir, { recursive: true });

  for (const [sel, name] of variants) {
    const el = await page.$(sel);
    await el.screenshot({ path: path.join(outDir, name) });
    console.log("wrote", name);
  }
  await browser.close();
})();
