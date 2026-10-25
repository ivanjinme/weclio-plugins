import { describe, expect, it } from "vitest";
import { CitationError, hasCitationMarker, register, render } from "../citations.js";

const registry = new Map();
const id = register(registry, { source: "Report", url: "https://example.org/report" });
const single = `[cite:${id}]`;
const double = `[[cite:${id}]]`;
const link = "[Report](https://example.org/report)";

function inspect(text: string) {
  const errors: CitationError[] = [];
  const output = render(text, registry, (error) => errors.push(error));
  return { output, errors };
}

describe("raw citation-marker detection", () => {
  it.each([
    single,
    "[cite:unknown]",
    "[cite:]",
    "[cite:bad id]",
    "[cite:中文]",
    "[cite:",
    `[cite:${id}`,
    `${single}]`,
    "[cite:_foo_]",
  ])("reports invalid singles without silently converting them: %s", (input) => {
    const { output, errors } = inspect(input);
    expect(output).toBe(input);
    expect(errors.map((error) => error.code)).toEqual(["INVALID_CITATION_MARKER"]);
    expect(hasCitationMarker(input)).toBe(true);
  });

  it.each([
    `中文${single}。`,
    `${single}(https://example.org)`,
    `!${single}(image.png)`,
    `[outer ${single}](/path)`,
    `[ordinary](/path/${single})`,
    `[ordinary](/path "title ${single}")`,
    `${single}[ref]\n\n[ref]: /path`,
    `${single}[]\n\n[ref]: /path`,
    `${single}: /path`,
    `**${single}**`,
    `> ${single}`,
    `- ${single}`,
    `| A |\n| --- |\n| x | ${single} |`,
    `\`${single}\``,
    `\`\`\`\n${single}\n\`\`\``,
  ])("does not exempt Markdown syntax: %s", (input) => {
    const { output, errors } = inspect(input);
    expect(output).toBe(input);
    expect(errors.map((error) => [error.code, error.ids])).toEqual([["INVALID_CITATION_MARKER", [id]]]);
    expect(hasCitationMarker(input)).toBe(true);
  });

  it("detects resolved reference markers as well as their definitions", () => {
    const input = `${single}[]\n\n${single}: /path`;
    expect(inspect(input).errors.map((error) => error.ids)).toEqual([[id], [id]]);
  });

  it.each([
    `\\${single}`,
    `\\${double}`,
    "\\[cite:] \\[cite:",
    "[1] [2] [note] [ordinary](https://example.org)",
    `[citation:${id}] [CITE:${id}]`,
  ])("preserves ordinary content and explicit escapes: %s", (input) => {
    expect(inspect(input)).toEqual({ output: input, errors: [] });
    expect(hasCitationMarker(input)).toBe(false);
  });

  it("throws through the default validation path", () => {
    expect(() => render(single, registry)).toThrow(CitationError);
  });

  it("renders canonical doubles without reporting their inner bracket", () => {
    expect(inspect(double)).toEqual({ output: link, errors: [] });
    expect(hasCitationMarker(double)).toBe(true);
  });

  it("renders only canonical doubles in mixed content", () => {
    const { output, errors } = inspect(`${double} ${single} [cite:]`);
    expect(output).toBe(`${link} ${single} [cite:]`);
    expect(errors.map((error) => error.code)).toEqual(["INVALID_CITATION_MARKER", "INVALID_CITATION_MARKER"]);
  });

  it("reports malformed doubles once through their existing validation path", () => {
    expect(inspect(`[[cite:${id}]`).errors.map((error) => error.code)).toEqual(["INVALID_CITATION_MARKER"]);
  });
});
