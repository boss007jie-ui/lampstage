const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 592, height: 592 }, deviceScaleFactor: 1 });
  const f = "file://" + path.resolve(__dirname, "favicon-src.html").replace(/\\/g, "/");
  await p.goto(f);
  await p.waitForTimeout(500);
  const el = await p.$(".ico");
  const out = path.resolve(__dirname, "../promo-assets/favicon-512.png");
  await el.screenshot({ path: out });
  console.log("wrote " + out);
  await b.close();
})();
