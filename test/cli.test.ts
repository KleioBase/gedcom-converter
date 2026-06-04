import { describe, expect, it } from "vitest";
import { runCli, EXIT, type CliIo } from "../src/cli.js";
import { parseGedcom } from "../src/index.js";
import { readFixture } from "./helpers.js";

function run(args: string[], stdin?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    write: (text) => out.push(text),
    writeErr: (text) => err.push(text),
    color: false,
    ...(stdin !== undefined ? { stdin } : {})
  };
  const code = runCli(args, io);
  return { code, out: out.join(""), err: err.join("") };
}

const MIN_7 = readFixture("minimal-7.0.18.ged");
const MIN_551 = readFixture("minimal-5.5.1.ged");

describe("GED-21: gedcom-convert CLI", () => {
  it("detect prints the version", () => {
    const result = run(["detect", "-"], MIN_7);
    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.out.trim()).toBe("7.0.18");
  });

  it("parse summarises records and version", () => {
    const result = run(["parse", "-", "--version", "7.0.18"], MIN_7);
    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.out).toMatch(/records: \d+/);
  });

  it("convert emits target GEDCOM to stdout", () => {
    const result = run(["convert", "-", "--to", "5.5.1"], MIN_7);
    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.out).toContain("0 HEAD");
    expect(result.out).toContain("2 VERS 5.5.1");
  });

  it("convert auto-detects the source version", () => {
    const result = run(["convert", "-", "--to", "7.0.18"], MIN_551);
    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.out).toContain("2 VERS 7.0.18");
  });

  it("convert --strict exits with code 2 when warnings are emitted", () => {
    const withWarning = [
      "0 HEAD",
      "1 GEDC",
      "2 VERS 7.0.18",
      "0 @O1@ OBJE",
      "1 FILE x.bin",
      "2 FORM application/x-unmappable",
      "0 TRLR",
      ""
    ].join("\n");
    const result = run(["convert", "-", "--to", "5.5.1", "--strict"], withWarning);
    expect(result.code).toBe(EXIT.STRICT_WARNING);
  });

  it("stringify reads a JSON document and emits GEDCOM", () => {
    const json = JSON.stringify(parseGedcom(MIN_7, { version: "7.0.18" }));
    const result = run(["stringify", "-", "--version", "7.0.18"], json);
    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.out).toContain("0 HEAD");
  });

  it("validate reports a valid document", () => {
    const result = run(["validate", "-"], MIN_7);
    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.out).toContain("valid 7.0.18");
  });

  it("validate reports an invalid document with exit 1", () => {
    const result = run(["validate", "-", "--against", "7.0.18"], "this is not gedcom\n");
    expect(result.code).toBe(EXIT.ERROR);
  });

  it("roundtrip reports the record delta", () => {
    const result = run(["roundtrip", "-", "--version", "7.0.18"], MIN_7);
    expect(result.code).toBe(EXIT.SUCCESS);
    expect(result.out).toMatch(/records: \d+ → \d+/);
  });

  it("prints usage and exits 64 with no command", () => {
    const result = run([]);
    expect(result.code).toBe(EXIT.USAGE);
    expect(result.out).toContain("gedcom-convert");
  });

  it("exits 64 on an unknown command", () => {
    const result = run(["frobnicate"]);
    expect(result.code).toBe(EXIT.USAGE);
    expect(result.err).toContain("unknown command");
  });

  it("--help exits 0", () => {
    expect(run(["--help"]).code).toBe(EXIT.SUCCESS);
    expect(run(["convert", "--help"]).code).toBe(EXIT.SUCCESS);
  });
});
