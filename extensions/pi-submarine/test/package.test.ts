import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("package metadata", () => {
  it("declares the Pi extension package shape", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(packageJson.name).toBe("@weclio/pi-submarine");
    expect(packageJson.type).toBe("module");
    expect(packageJson.pi.extensions).toEqual(["./src/index.ts"]);
    expect(packageJson.keywords).toEqual(expect.arrayContaining(["pi-package", "pi-extension", "subagent", "pi"]));
  });

  it("declares Weclio fork provenance", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(packageJson.author).toBe("Daniel Nouri");
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/ivanjinme/weclio-plugins.git",
      directory: "extensions/pi-submarine",
    });
    expect(packageJson.homepage).toBe("https://github.com/ivanjinme/weclio-plugins/tree/main/extensions/pi-submarine");
    expect(packageJson.bugs).toEqual({ url: "https://github.com/ivanjinme/weclio-plugins/issues" });
    expect(packageJson.publishConfig).toEqual({ access: "public" });
  });

  it("uses Pi peer dependencies without bundling Pi runtime packages", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(packageJson.peerDependencies).toEqual({
      "@earendil-works/pi-ai": "*",
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    });
    expect(packageJson.devDependencies["@earendil-works/pi-coding-agent"]).toBe("0.79.1");
    expect(packageJson.dependencies ?? {}).toEqual({});
  });

  it("publishes source and README", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

    expect(packageJson.files).toEqual(["src/", "README.md", "LICENSE", "NOTICE.md"]);
  });
});
