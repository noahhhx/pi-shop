#!/usr/bin/env node
// Manage the third-party pi packages this repo bundles. They are npm
// dependencies of the root package.json, pinned in package-lock.json, and
// loaded through node_modules/ paths in its "pi" manifest (pi's documented
// way to bundle other pi packages); nix builds node_modules straight from
// the lockfile. This keeps all of that in sync:
//
//   nix run .#add -- <npm-spec>...   # e.g. @ff-labs/pi-fff
//   nix run .#update [-- <name>...]  # every package when none given
//   nix run .#remove -- <name>...
//
// (or `node scripts/pkg.mjs add|update|remove|sync ...` with node on PATH).
// Only package.json and package-lock.json change; nothing is installed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const npm = (args, opts = {}) =>
  execFileSync("npm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

if (!existsSync("package.json") || readJson("package.json").name !== "pi-shop") {
  console.error("run this from the root of the pi-shop checkout");
  process.exit(1);
}

// "@scope/name@1.2.3" -> "@scope/name"
const nameOf = (spec) => spec.replace(/^(@?[^@]+).*$/, "$1");

// The node_modules/ paths pi should load from an installed package: its own
// "pi" manifest when it has one, otherwise pi's convention directories.
function resources(name, version) {
  const base = `node_modules/${name}`;
  const view = npm(["view", `${name}@${version}`, "pi", "--json"]).trim();
  const manifest = view ? JSON.parse(view) : null;
  const res = { extensions: [], skills: [] };

  if (manifest) {
    // pi resolves the package's own extension list from its package.json.
    if (manifest.extensions?.length) res.extensions.push(base);
    for (const p of manifest.skills ?? []) {
      res.skills.push(`${base}/${p.replace(/^\.\//, "").replace(/\/$/, "")}`);
    }
    for (const type of ["prompts", "themes"]) {
      if (manifest[type]?.length) console.warn(`${name}: ${type} are not wired up by pi-shop yet`);
    }
  } else {
    const [{ files }] = JSON.parse(npm(["pack", `${name}@${version}`, "--dry-run", "--json"]));
    const paths = files.map((f) => f.path);
    if (paths.includes("index.ts") || paths.includes("index.js")) res.extensions.push(base);
    else if (paths.some((p) => p.startsWith("extensions/"))) res.extensions.push(`${base}/extensions`);
    if (paths.some((p) => p.startsWith("skills/"))) res.skills.push(`${base}/skills`);
  }

  if (!res.extensions.length && !res.skills.length) {
    console.warn(`${name}: no pi extensions or skills found`);
  }
  return res;
}

// Rebuild the node_modules/ entries of the pi manifest and the
// bundleDependencies list from the dependencies npm resolved; first-party
// entries (extensions, skills) stay first and untouched.
function sync() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");
  const deps = Object.keys(pkg.dependencies ?? {}).sort();

  pkg.pi ??= {};
  for (const type of ["extensions", "skills"]) {
    pkg.pi[type] = (pkg.pi[type] ?? []).filter((e) => !e.startsWith("node_modules/"));
  }
  for (const name of deps) {
    const { version } = lock.packages[`node_modules/${name}`];
    const res = resources(name, version);
    for (const type of ["extensions", "skills"]) pkg.pi[type].push(...res[type]);
    console.log(`${name}@${version}: ${[...res.extensions, ...res.skills].join(", ") || "-"}`);
  }
  if (deps.length) pkg.bundleDependencies = deps;
  else delete pkg.bundleDependencies;
  delete pkg.bundledDependencies; // npm's alias; keep one spelling

  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

const lockOnly = ["--package-lock-only", "--save-exact", "--ignore-scripts"];
const [command, ...args] = process.argv.slice(2);
const inherit = { stdio: "inherit" };

switch (command) {
  case "add":
    if (!args.length) throw new Error("usage: add <npm-spec>...");
    npm(["install", ...lockOnly, ...args], inherit);
    break;
  case "update": {
    const names = args.length ? args.map(nameOf) : Object.keys(readJson("package.json").dependencies ?? {});
    if (names.length) npm(["install", ...lockOnly, ...names.map((n) => `${n}@latest`)], inherit);
    // Also refresh transitive dependencies within their declared ranges.
    npm(["update", ...lockOnly, ...(args.length ? names : [])], inherit);
    break;
  }
  case "remove":
    if (!args.length) throw new Error("usage: remove <name>...");
    npm(["uninstall", ...lockOnly, ...args.map(nameOf)], inherit);
    break;
  case "sync":
    break;
  default:
    console.error("usage: pkg.mjs add <npm-spec>... | update [name...] | remove <name>... | sync");
    process.exit(1);
}
sync();
