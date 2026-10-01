// Builds docs/index.html (served by GitHub Pages) from docs/guide.html.
// guide.html is body-only content, as claude.ai artifacts expect; Pages needs a full document.
// Run: node docs/build-index.mjs
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url);
const src = readFileSync(new URL("guide.html", dir), "utf8");
const split = src.indexOf('<div class="page">');
if (split < 0) throw new Error('guide.html: <div class="page"> not found');
const headPart = src.slice(0, split).trim(); // <title>, font links, <style>
const bodyPart = src.slice(split).trim();
const title = /<title>([^<]*)<\/title>/.exec(headPart)?.[1] ?? "watchStock";
const description =
  "iPhone と Apple Watch で株価の通知を受け取る watchStock の、専門知識なしで進められる画像付きの導入手順です。費用は 0 円。";

// Same icon as the app itself.
const icons = readFileSync(new URL("../src/icons.ts", dir), "utf8");
const icon192 = /ICON_192 = "([^"]+)"/.exec(icons)[1];
writeFileSync(new URL("images/app-icon.png", dir), Buffer.from(icon192, "base64"));

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="article">
<link rel="icon" href="images/app-icon.png">
<!-- Generated from guide.html by build-index.mjs. Edit guide.html, then run: node docs/build-index.mjs -->
${headPart}
</head>
<body>
${bodyPart}
</body>
</html>
`;
writeFileSync(new URL("index.html", dir), html);
console.log("wrote docs/index.html and docs/images/app-icon.png");
