const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirIfExists(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirIfExists(s, d);
    else copyFile(s, d);
  }
}

copyFile(path.join(root, "src/renderer/index.html"), path.join(root, "dist/renderer/index.html"));
copyFile(path.join(root, "src/renderer/style.css"), path.join(root, "dist/renderer/style.css"));
copyDirIfExists(path.join(root, "assets"), path.join(root, "dist/renderer/assets"));

console.log("[A-X-M] assets copied");
