import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), "weclio-harness-中文 空格-"));
// 隔离资源发现及 npm 安装，不读取或修改本机安装配置。
process.env.HOME = temporary;
process.env.USERPROFILE = temporary;
process.env.PI_CODING_AGENT_DIR = join(temporary, "agent");
process.env.PI_OFFLINE = "1";
const { createAgentSession, DefaultPackageManager, DefaultResourceLoader, SettingsManager, SessionManager } = await import("@earendil-works/pi-coding-agent");
const sessions = [];
const tarball = resolve(process.argv[2] ?? "dist/weclio-plugins-0.1.5.tgz");
const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32/tar.exe") : "tar";
try {
  await exec(tar, ["-xzf", tarball, "-C", temporary]);
  const directory = join(temporary, "package");
  const agentDir = join(temporary, "agent");
  const project = join(temporary, "unrelated-project");
  await mkdir(project);
  const bind = async (resourceLoader, settings) => {
    const { session } = await createAgentSession({ cwd: project, agentDir, resourceLoader,
      settingsManager: settings, sessionManager: SessionManager.inMemory(project) });
    sessions.push(session);
    await session.bindExtensions({ onError: (error) => { throw error; } });
  };
  const assertResources = async (loader, settings) => {
    const before = process.env.PATH;
    await loader.reload();
    await bind(loader, settings);
    assert.deepEqual(loader.getExtensions().errors, []);
    const extensions = loader.getExtensions().extensions;
    assert.equal(extensions.length, 4);
    assert.ok(extensions.every((extension) => !extension.tools.has("bash")));
    assert.deepEqual(loader.getSkills().skills, []);
    assert.equal(process.env.PATH, before);
  };
  const settings = SettingsManager.inMemory({ packages: [directory] }, { projectTrusted: false });
  await assertResources(new DefaultResourceLoader({ cwd: project, agentDir, settingsManager: settings, noContextFiles: true }), settings);

  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  assert.equal(manifest.name, "@weclio/plugins");
  assert.equal(manifest.bin, undefined);
  assert.deepEqual(manifest.pi.skills ?? [], []);
  assert.equal(manifest.pi.extensions.length, 4);
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.equal(manifest.license, "MIT");
  assert.match(await readFile(join(directory, "LICENSE"), "utf8"), /MIT License/);
  for (const name of ["pi-citations", "pi-persona", "pi-web-search"]) {
    const component = join(directory, "extensions", name);
    assert.equal(JSON.parse(await readFile(join(component, "package.json"), "utf8")).license, "MIT");
    assert.match(await readFile(join(component, "LICENSE"), "utf8"), /MIT License/);
  }
  const submarine = join(directory, "extensions/pi-submarine");
  assert.equal(JSON.parse(await readFile(join(submarine, "package.json"), "utf8")).license, "MIT");
  assert.match(await readFile(join(submarine, "LICENSE"), "utf8"), /Copyright \(c\) Daniel Nouri/);
  assert.match(await readFile(join(submarine, "NOTICE.md"), "utf8"), /Declared upstream license: MIT/);
  const contents = await readdir(directory, { recursive: true });
  assert.ok(!contents.some((file) => /^(?:cli|skills|runtime|node_modules)(?:[/\\]|$)|^weclio$/.test(file)));

  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const npmRoot = join(agentDir, "npm");
  await mkdir(npmRoot, { recursive: true });
  await writeFile(join(npmRoot, "package.json"), JSON.stringify({ private: true }));
  const npm = async (args, cwd) => exec(process.execPath, [npmCli, ...args, "--offline", "--ignore-scripts",
    "--legacy-peer-deps", "--no-audit", "--no-fund", "--cache", join(temporary, "npm-cache")], { cwd, maxBuffer: 8 * 1024 * 1024 });
  console.log("Verifying harness: offline npm installation");
  await npm(["install", tarball], npmRoot);
  const installedSettings = SettingsManager.inMemory({ packages: ["npm:@weclio/plugins"] }, { projectTrusted: false });
  const manager = new DefaultPackageManager({ cwd: project, agentDir, settingsManager: installedSettings });
  const resources = await manager.resolve();
  assert.equal(resources.extensions.filter((resource) => resource.metadata.source === "npm:@weclio/plugins").length, 4);
  assert.equal(resources.skills.filter((resource) => resource.metadata.source === "npm:@weclio/plugins").length, 0);
  const installedLoader = new DefaultResourceLoader({ cwd: project, agentDir,
    settingsManager: installedSettings, noContextFiles: true });
  await assertResources(installedLoader, installedSettings);

  // 在隔离副本模拟下一版，确认包更新后仍仅加载 harness 资源。
  manifest.version += "-update-test";
  await writeFile(join(directory, "README.md"), (await readFile(join(directory, "README.md"), "utf8")) + "\nupdated-harness-fixture\n");
  await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  const updated = Object.values(JSON.parse((await npm(["pack", "--json", "--pack-destination", temporary], directory)).stdout))[0];
  console.log("Verifying harness: package update");
  await npm(["install", join(temporary, updated.filename)], npmRoot);
  await assertResources(installedLoader, installedSettings);
  assert.match(await readFile(join(npmRoot, "node_modules/@weclio/plugins/README.md"), "utf8"), /updated-harness-fixture/);
  console.log(`Verified ${manifest.name}@${manifest.version.replace("-update-test", "")}: 4 harness extensions, no business CLI or skills`);
} finally {
  for (const session of sessions) session.dispose();
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
