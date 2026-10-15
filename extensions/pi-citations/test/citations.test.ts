import { describe, expect, it } from "vitest";
import { annotateCli, citationId, CitationError, register, render, type Citation } from "../citations.js";

const chronic: Citation = {
  source: "ECHA - Tris(2,4-ditert-butylphenyl) phosphite",
  source_id: "17bc467b-c85b-4f91-887c-05fa62aad43b_ce3cfbd4-f3c4-47f3-a4c6-0e46946abfb2",
  url: "https://chem.echa.europa.eu/100.046.084/dossier-view/53c3c32c-9345-4479-9f11-785fc1dc71a9/17bc467b-c85b-4f91-887c-05fa62aad43b_ce3cfbd4-f3c4-47f3-a4c6-0e46946abfb2",
};
const adme: Citation = {
  ...chronic,
  source_id: "4b56e677-137c-4a57-9e5d-8fe254996fba_ce3cfbd4-f3c4-47f3-a4c6-0e46946abfb2",
  url: "https://chem.echa.europa.eu/100.046.084/dossier-view/53c3c32c-9345-4479-9f11-785fc1dc71a9/4b56e677-137c-4a57-9e5d-8fe254996fba_ce3cfbd4-f3c4-47f3-a4c6-0e46946abfb2",
};
const identifier = { RecordType: "EC number", RecordNumber: "31570-04-4", RecordTitle: "I-168" };
const doc = { identifier, blocks: [{ content: "# Toxicology" }, { content: "105-week study; 58–147 mg/kg/day.", citation: chronic }] };

function errorOf(fn: () => unknown): { error: string; ids: string[]; action: string } {
  try { fn(); } catch (error) {
    expect(error).toBeInstanceOf(CitationError);
    return JSON.parse((error as CitationError).message);
  }
  throw new Error("Expected citation error");
}

describe("citation registry and rendering", () => {
  it("deduplicates exact sources, with stable IDs independent of registration order", () => {
    const first = new Map(), second = new Map();
    const id = register(first, chronic);
    register(first, chronic);
    register(second, adme);
    expect(register(second, chronic)).toBe(id);
    expect(first.size).toBe(1);
    expect(first.get(id)).toEqual(chronic);
  });

  it("keeps different source IDs separate even for the same URL", () => {
    const registry = new Map();
    expect(register(registry, chronic)).not.toBe(register(registry, { ...chronic, source_id: "another-study" }));
  });

  it("round-trips CLI repeated-dose and ADME citations lost by the original chat", () => {
    const registry = new Map();
    const a = register(registry, chronic), b = register(registry, adme);
    const result = render(`重复给药。[[cite:${a}]] ADME。[[cite:${b}]]`, registry);
    expect(result).toBe(`重复给药。[${chronic.source}](${chronic.url}) ADME。[${adme.source}](${adme.url})`);
    expect(result).not.toContain("[]()");
    expect(render(result, registry)).toBe(result);
  });

  it("uses the same renderer for native and CLI sources", () => {
    const registry = new Map();
    const native = { source: "EFSA", url: "https://doi.org/10.2903/j.efsa.2017.4841" };
    const ids = [register(registry, chronic), register(registry, native)];
    expect(render(ids.map((id) => `[[cite:${id}]]`).join(" "), registry)).toBe(`[${chronic.source}](${chronic.url}) [EFSA](${native.url})`);
  });

  it("escapes Markdown labels and URL delimiters without changing the registry", () => {
    const citation = { source: "Report [A]\\B\nTitle", url: "https://example.org/a(b)?q=x%20y" };
    const registry = new Map();
    const id = register(registry, citation);
    expect(render(`[[cite:${id}]]`, registry)).toBe("[Report \\[A\\]\\\\B Title](https://example.org/a%28b%29?q=x%20y)");
    expect(registry.get(id)).toEqual(citation);
  });

  it("leaves ordinary text and existing Markdown links unchanged", () => {
    const input = "Plain text. [existing](https://example.org/) and []().";
    expect(render(input, new Map())).toBe(input);
  });

  it.each(["", " "])("rejects an empty source %j", (source) => {
    expect(errorOf(() => register(new Map(), { source, url: "https://example.org" })).error).toBe("EMPTY_CITATION_SOURCE");
  });

  it.each(["", "not-a-url", " https://example.org/", "https://example.org/ ", "javascript:alert(1)", "file:///tmp/report"])("rejects unsafe/invalid URL %j", (url) => {
    expect(errorOf(() => register(new Map(), { source: "A", url })).error).toBe("INVALID_CITATION_URL");
  });

  it("returns an instructive, terse error for unknown IDs", () => {
    expect(errorOf(() => render("Claim [[cite:c7]]", new Map()))).toEqual({
      error: "UNKNOWN_CITATION_ID", ids: ["c7"],
      action: "Use registered IDs from supporting evidence; retry without dropping citations.",
    });
  });

  it.each(["[[cite:]]", "[[cite:bad id]]", "[[cite:c7]", "[[cite:c7"])("rejects broken markers %j", (text) => {
    expect(errorOf(() => render(text, new Map())).error).toBe("INVALID_CITATION_MARKER");
  });

  it("renders valid markers independently while retaining unresolved markers", () => {
    const registry = new Map();
    const id = register(registry, chronic);
    const failures: CitationError[] = [];
    const input = `Claim [[cite:c7]] [[cite:broken] [[cite:${id}]] [[cite:bad id]]`;
    expect(render(input, registry, (error) => failures.push(error))).toBe(
      `Claim [[cite:c7]] [[cite:broken] [${chronic.source}](${chronic.url}) [[cite:bad id]]`,
    );
    expect(failures.map((error) => error.code)).toEqual([
      "UNKNOWN_CITATION_ID", "INVALID_CITATION_MARKER", "INVALID_CITATION_MARKER",
    ]);
  });

  it("allows escaped literal marker examples without parsing Markdown", () => {
    const input = "Example: \\[[cite:ID]]";
    expect(render(input, new Map())).toBe(input);
  });

  it("validates restored entries before rendering", () => {
    const id = citationId(chronic);
    expect(errorOf(() => render(`[[cite:${id}]]`, new Map([[id, { ...chronic, url: "" }]]))).error).toBe("INVALID_CITATION_URL");
  });
});

describe("CLI document annotation", () => {
  it("retains JSON shape, headings, citation objects and complete evidence", () => {
    const registry = new Map();
    const output = JSON.parse(annotateCli(JSON.stringify(doc), (citation) => register(registry, citation)));
    expect(output.identifier).toEqual(identifier);
    expect(output.blocks[0]).toEqual(doc.blocks[0]);
    expect(output.blocks[1]).toEqual({ ...doc.blocks[1], content: `${doc.blocks[1]!.content}\n\n[[cite:${citationId(chronic)}]]` });
    expect(registry.size).toBe(1);
  });

  it("parses concatenated JSON documents with braces and escaped quotes in content", () => {
    const second = { identifier, blocks: [{ content: 'Data {with} "quotes" and \\ escapes', citation: adme }] };
    const registry = new Map();
    const output = annotateCli(`${JSON.stringify(doc, null, 2)}\n${JSON.stringify(second)}\n`, (citation) => register(registry, citation));
    const results = output.split("\n").map((line) => JSON.parse(line));
    expect(results).toHaveLength(2);
    expect(results[1].blocks[0].content).toContain(second.blocks[0]!.content);
    expect(registry.size).toBe(2);
  });

  it.each(["ordinary report text", "{\"unrelated\":true}", JSON.stringify({ identifier, blocks: [{ content: "Heading only" }] })])("leaves non-cited output unchanged", (input) => {
    expect(annotateCli(input, () => { throw new Error("Must not register"); })).toBe(input);
  });

  it.each([
    '{"identifier":"ordinary","blocks":[]}\nBuild completed',
    '{"identifier":"ordinary","blocks":[null]}',
    '{"identifier":"ordinary","blocks":[42]}',
    '{"identifier":"ordinary","blocks":[{"content":"unfinished',
    '{"identifier":"ordinary","blocks":[}',
    `${JSON.stringify(doc)}\nBuild completed`,
  ])("passes uncertain or non-document output through unchanged: %s", (input) => {
    expect(annotateCli(input, () => { throw new Error("Must not register"); })).toBe(input);
  });

  it("still rejects invalid citations in complete documents", () => {
    const input = JSON.stringify({ identifier, blocks: [{ content: "Evidence", citation: { source: "A", url: "not-a-url" } }] });
    expect(errorOf(() => annotateCli(input, (citation) => register(new Map(), citation))).error).toBe("INVALID_CITATION_URL");
  });

  it("rejects truncated document JSON rather than guessing sources", () => {
    expect(errorOf(() => annotateCli(JSON.stringify(doc).slice(0, -10), () => "unused")).error).toBe("INCOMPLETE_CITATION_DOCUMENT");
  });
});
