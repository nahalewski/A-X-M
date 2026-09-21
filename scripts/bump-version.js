#!/usr/bin/env node
/**
 * Steps the version on, in every place that carries one.
 *
 * The scheme is 0.MINOR.PATCH-beta.N. A build is bumped after a change worth
 * shipping, not on every rebuild - a version that moves when nothing did makes
 * it impossible to tell which package someone is actually running.
 *
 * Both files have to agree, and the Android versionCode has to rise on its own
 * as well: the phone compares that number, not the name, and refuses an install
 * that does not go up.
 *
 * Usage:
 *   node scripts/bump-version.js            0.6.1-beta.1 -> 0.6.2-beta.1
 *   node scripts/bump-version.js minor      0.6.1-beta.1 -> 0.7.0-beta.1
 *   node scripts/bump-version.js 0.8.0      an exact version
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pkgPath = path.join(root, "package.json");
const gradlePath = path.join(root, "companion-android", "app", "build.gradle.kts");

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(pkg.version);
  if (!m) throw new Error(`package.json version "${pkg.version}" is not 0.x.y-beta.n`);
  return { major: +m[1], minor: +m[2], patch: +m[3], beta: m[4] ? +m[4] : 1 };
}

function nextVersion(arg) {
  const v = readVersion();
  if (arg && /^\d+\.\d+\.\d+/.test(arg)) return arg.includes("-") ? arg : `${arg}-beta.1`;
  if (arg === "minor") return `${v.major}.${v.minor + 1}.0-beta.1`;
  if (arg === "major") return `${v.major + 1}.0.0-beta.1`;
  if (arg === "beta") return `${v.major}.${v.minor}.${v.patch}-beta.${v.beta + 1}`;
  return `${v.major}.${v.minor}.${v.patch + 1}-beta.1`;
}

/**
 * A single rising integer for Android, derived from the version.
 *
 * major*10000 + minor*100 + patch keeps it ordered and leaves room for a
 * hundred patches per minor, which is far more than this will ever need.
 */
function androidCode(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return +m[1] * 10000 + +m[2] * 100 + +m[3];
}

function main() {
  const target = nextVersion(process.argv[2]);
  const before = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;

  const pkgText = fs.readFileSync(pkgPath, "utf-8");
  fs.writeFileSync(pkgPath, pkgText.replace(/"version":\s*"[^"]*"/, `"version": "${target}"`));

  const code = androidCode(target);
  let gradle = fs.readFileSync(gradlePath, "utf-8");
  const currentCode = +(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1] ?? 0);
  // Never let the phone's number go backwards, whatever the name says.
  const nextCode = Math.max(code, currentCode + 1);
  gradle = gradle
    .replace(/versionCode\s*=\s*\d+/, `versionCode = ${nextCode}`)
    .replace(/versionName\s*=\s*"[^"]*"/, `versionName = "${target}"`);
  fs.writeFileSync(gradlePath, gradle);

  console.log(`${before} -> ${target}`);
  console.log(`  package.json      version ${target}`);
  console.log(`  build.gradle.kts  versionName ${target}, versionCode ${nextCode}`);
}

main();
