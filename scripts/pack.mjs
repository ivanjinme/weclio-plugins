import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = join(root, "dist");
const stage = join(destination, "package");
const manifest = JSON.parse(await readFile(join(root, "bundle/package.json"), "utf8"));
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
const npm = async (args, cwd) => {
  const { stdout, stderr } = await exec(process.execPath, [npmCli, ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
  if (stderr) process.stderr.write(stderr);
  return stdout;
};
if (process.argv.length > 2) throw new Error("This package contains only harness extensions; no CLI input is accepted");
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32/tar.exe") : "tar";
const temporary = await mkdtemp(join(tmpdir(), "weclio-plugins-pack-"));
try {
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  await cp(join(root, "bundle/package.json"), join(stage, "package.json"));
  await cp(join(root, "bundle/README.md"), join(stage, "README.md"));
  await cp(join(root, "LICENSE"), join(stage, "LICENSE"));
  // 只收集 harness extensions 的发布文件，不包含业务 CLI 或 skills。
  const workspaces = [...new Set(manifest.pi.extensions.filter((entry) => entry.startsWith("./extensions/"))
    .map((entry) => entry.split("/").slice(1, 3).join("/")))];
  const packed = JSON.parse(await npm(["pack", ...workspaces.flatMap((name) => ["--workspace", name]),
    "--ignore-scripts", "--json", "--pack-destination", temporary], root));
  for (const component of packed) {
    const name = component.name.split("/").at(-1);
    const directory = join(stage, "extensions", name);
    await mkdir(directory, { recursive: true });
    await exec(tar, ["-xzf", join(temporary, component.filename), "-C", directory, "--strip-components=1"]);
  }

  const result = JSON.parse(await npm(["pack", "--ignore-scripts", "--json", "--pack-destination", destination], stage));
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
