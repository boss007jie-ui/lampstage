const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

(async () => {
  const src = path.resolve(__dirname, "../promo-assets/favicon-512.png");
  const appDir = path.resolve(__dirname, "../apps/web/app");
  const pubDir = path.resolve(__dirname, "../apps/web/public");

  // Next.js App Router 自动识别 app/icon.png + app/apple-icon.png
  await sharp(src).resize(32, 32).png().toFile(path.join(appDir, "icon.png"));
  console.log("wrote app/icon.png (32x32)");

  await sharp(src).resize(180, 180).png().toFile(path.join(appDir, "apple-icon.png"));
  console.log("wrote app/apple-icon.png (180x180)");

  // 也放一份公开的高清图（社媒/PWA 用）
  await sharp(src).resize(512, 512).png().toFile(path.join(pubDir, "icon-512.png"));
  console.log("wrote public/icon-512.png");

  // 删掉旧的默认 favicon.ico（和 app/icon.png 冲突时优先级）
  const oldIco = path.join(appDir, "favicon.ico");
  if (fs.existsSync(oldIco)) {
    fs.unlinkSync(oldIco);
    console.log("removed old app/favicon.ico");
  }
})();
