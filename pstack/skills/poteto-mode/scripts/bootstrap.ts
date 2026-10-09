import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const scriptsDirectory = realpathSync(import.meta.dir);
const nodeModulesDirectory = join(scriptsDirectory, "node_modules");
const commanderPackagePath = join(
  nodeModulesDirectory,
  "commander",
  "package.json"
);
const installKeyPath = join(
  nodeModulesDirectory,
  ".poteto-mode-tools-install-key"
);

function currentInstallKey(): string {
  return createHash("sha256")
    .update(readFileSync(join(scriptsDirectory, "package.json")))
    .update("\0")
    .update(readFileSync(join(scriptsDirectory, "bun.lock")))
    .digest("hex");
}

function isWritable(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function makeDirectoriesWritable(directory: string): void {
  chmodSync(directory, 0o755);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) makeDirectoriesWritable(join(directory, entry.name));
  }
}

// A read-only scripts directory (the nix store under home-manager) cannot
// hold node_modules, so run from a writable copy in the user cache instead.
// The copy is keyed by the source path; a nix store path changes whenever
// its content does.
function runFromWritableCopy(): never {
  if (process.env.POTETO_MODE_TOOLS_COPY) {
    throw new Error(`poteto-mode tools copy is not writable: ${scriptsDirectory}`);
  }
  const cacheRoot = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const sourceKey = createHash("sha256")
    .update(scriptsDirectory)
    .digest("hex")
    .slice(0, 16);
  const copy = join(cacheRoot, "pstack", "poteto-mode-tools", sourceKey);
  if (!existsSync(copy)) {
    const partial = `${copy}.${process.pid}`;
    cpSync(scriptsDirectory, partial, { recursive: true, dereference: true });
    makeDirectoriesWritable(partial);
    try {
      renameSync(partial, copy);
    } catch (error) {
      rmSync(partial, { recursive: true, force: true });
      if (!existsSync(copy)) throw error;
    }
  }

  const script = join(
    copy,
    relative(scriptsDirectory, realpathSync(process.argv[1]))
  );
  const restarted = Bun.spawnSync(
    [process.execPath, script, ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: { ...process.env, POTETO_MODE_TOOLS_COPY: "1" },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  process.exit(restarted.exitCode ?? 1);
}

export function ensureDependenciesInstalled(): void {
  const installKey = currentInstallKey();
  if (
    existsSync(commanderPackagePath) &&
    existsSync(installKeyPath) &&
    readFileSync(installKeyPath, "utf8").trim() === installKey
  ) {
    return;
  }
  if (!isWritable(scriptsDirectory)) runFromWritableCopy();

  const result = Bun.spawnSync(
    [process.execPath, "install", "--frozen-lockfile"],
    { cwd: scriptsDirectory }
  );
  if (result.exitCode !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(
      `bun install --frozen-lockfile exited with status ${result.exitCode}`
    );
  }
  if (!existsSync(commanderPackagePath)) {
    throw new Error(
      "bun install --frozen-lockfile completed without installing commander"
    );
  }

  writeFileSync(installKeyPath, `${installKey}\n`);

  const restarted = Bun.spawnSync([process.execPath, ...process.argv.slice(1)], {
    cwd: process.cwd(),
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(restarted.exitCode ?? 1);
}
