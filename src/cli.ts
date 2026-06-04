import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { convertGedcom, detectGedcomVersion, parseGedcom, stringifyGedcom } from "./index.js";
import type { Diagnostic, SupportedVersion } from "./types.js";

// GED-21 — `gedcom-convert` CLI. The logic lives here as a testable `runCli`
// returning an exit code; `bin/gedcom-convert.mjs` is a thin process wrapper.

export interface CliIo {
  /** Write to standard output. */
  write: (text: string) => void;
  /** Write to standard error. */
  writeErr: (text: string) => void;
  /** Piped standard input, if any (used when a file argument is `-`). */
  stdin?: string;
  /** Whether to colourise diagnostics. */
  color?: boolean;
}

export const EXIT = {
  SUCCESS: 0,
  ERROR: 1,
  STRICT_WARNING: 2,
  USAGE: 64
} as const;

const USAGE = `gedcom-convert — convert and inspect GEDCOM files

Usage:
  gedcom-convert detect <file>
  gedcom-convert parse <file> [--version <v>]
  gedcom-convert stringify <input.json> --version <v> [-o <out>]
  gedcom-convert convert <input> --to <v> [--from <v>] [-o <out>] [--strict] [--preserve-unknown]
  gedcom-convert validate <file> [--against <v>]
  gedcom-convert roundtrip <file> [--version <v>]

Versions: 7.0.18 | 5.5.1 | 5.5
A <file> of "-" reads from standard input. Without -o, output goes to standard output.
Add --help after any subcommand for its options.`;

function color(text: string, code: string, enabled: boolean | undefined): string {
  return enabled ? `[${code}m${text}[0m` : text;
}

function formatDiagnostic(diagnostic: Diagnostic, enabled: boolean | undefined): string {
  const tag =
    diagnostic.severity === "error"
      ? color("error", "31", enabled)
      : diagnostic.severity === "warning"
        ? color("warning", "33", enabled)
        : color("info", "36", enabled);
  const where = diagnostic.location?.line ? ` (line ${diagnostic.location.line})` : "";
  return `  ${tag} ${color(diagnostic.code, "1", enabled)}${where}: ${diagnostic.message}`;
}

function printDiagnostics(diagnostics: Diagnostic[], io: CliIo): void {
  if (diagnostics.length === 0) {
    return;
  }
  io.writeErr(`${diagnostics.length} diagnostic(s):\n`);
  for (const diagnostic of diagnostics) {
    io.writeErr(`${formatDiagnostic(diagnostic, io.color)}\n`);
  }
}

function readInput(file: string, io: CliIo): string | Uint8Array {
  if (file === "-") {
    return io.stdin ?? "";
  }
  return readFileSync(file);
}

function isSupportedVersion(value: string | undefined): value is SupportedVersion {
  return value === "7.0.18" || value === "5.5.1";
}

function cmdDetect(positionals: string[], io: CliIo): number {
  const file = positionals[0];
  if (!file) {
    io.writeErr("usage: gedcom-convert detect <file>\n");
    return EXIT.USAGE;
  }
  io.write(`${detectGedcomVersion(readInput(file, io))}\n`);
  return EXIT.SUCCESS;
}

function cmdParse(positionals: string[], values: Record<string, unknown>, io: CliIo): number {
  const file = positionals[0];
  if (!file) {
    io.writeErr("usage: gedcom-convert parse <file> [--version <v>]\n");
    return EXIT.USAGE;
  }
  const version = values.version as string | undefined;
  try {
    const document = parseGedcom(readInput(file, io), version ? { version: version as never } : {});
    io.write(`version: ${document.version}\nrecords: ${document.records.length}\n`);
    printDiagnostics(document.diagnostics, io);
    return EXIT.SUCCESS;
  } catch (error) {
    io.writeErr(`parse error: ${(error as Error).message}\n`);
    return EXIT.ERROR;
  }
}

function cmdStringify(positionals: string[], values: Record<string, unknown>, io: CliIo): number {
  const file = positionals[0];
  const version = values.version as string | undefined;
  if (!file || !isSupportedVersion(version)) {
    io.writeErr("usage: gedcom-convert stringify <input.json> --version <7.0.18|5.5.1> [-o <out>]\n");
    return EXIT.USAGE;
  }
  try {
    const raw = file === "-" ? io.stdin ?? "" : readFileSync(file, "utf8");
    const document = JSON.parse(raw);
    const output = stringifyGedcom(document, { version });
    return emit(output, values.output as string | undefined, io);
  } catch (error) {
    io.writeErr(`stringify error: ${(error as Error).message}\n`);
    return EXIT.ERROR;
  }
}

function cmdConvert(positionals: string[], values: Record<string, unknown>, io: CliIo): number {
  const file = positionals[0];
  const to = values.to as string | undefined;
  if (!file || !isSupportedVersion(to)) {
    io.writeErr("usage: gedcom-convert convert <input> --to <7.0.18|5.5.1> [--from <v>] [-o <out>] [--strict]\n");
    return EXIT.USAGE;
  }
  const input = readInput(file, io);
  const from = (values.from as string | undefined) ?? detectGedcomVersion(input);
  if (from === "unknown") {
    io.writeErr("could not detect source version; pass --from <v>\n");
    return EXIT.ERROR;
  }
  try {
    const result = convertGedcom(input, {
      from: from as never,
      to,
      ...(values.strict ? { strict: true } : {}),
      ...(values["preserve-unknown"] ? { preserveUnknown: true } : {})
    });
    printDiagnostics(result.diagnostics, io);
    return emit(result.output, values.output as string | undefined, io);
  } catch (error) {
    const message = (error as Error).message;
    io.writeErr(`conversion error: ${message}\n`);
    return /strict/i.test(message) ? EXIT.STRICT_WARNING : EXIT.ERROR;
  }
}

function cmdValidate(positionals: string[], values: Record<string, unknown>, io: CliIo): number {
  const file = positionals[0];
  if (!file) {
    io.writeErr("usage: gedcom-convert validate <file> [--against <v>]\n");
    return EXIT.USAGE;
  }
  const input = readInput(file, io);
  const against = (values.against as string | undefined) ?? detectGedcomVersion(input);
  try {
    const document = parseGedcom(input, against !== "unknown" ? { version: against as never } : {});
    const errors = document.diagnostics.filter((d) => d.severity === "error");
    printDiagnostics(document.diagnostics, io);
    if (errors.length > 0) {
      io.writeErr(`invalid: ${errors.length} error(s)\n`);
      return EXIT.ERROR;
    }
    io.write(`valid ${document.version}\n`);
    return EXIT.SUCCESS;
  } catch (error) {
    io.writeErr(`invalid: ${(error as Error).message}\n`);
    return EXIT.ERROR;
  }
}

function cmdRoundtrip(positionals: string[], values: Record<string, unknown>, io: CliIo): number {
  const file = positionals[0];
  if (!file) {
    io.writeErr("usage: gedcom-convert roundtrip <file> [--version <v>]\n");
    return EXIT.USAGE;
  }
  const input = readInput(file, io);
  const version = (values.version as string | undefined) ?? detectGedcomVersion(input);
  if (!isSupportedVersion(version)) {
    io.writeErr(`roundtrip requires a serialisable version (7.0.18 or 5.5.1), got ${version}\n`);
    return EXIT.USAGE;
  }
  try {
    const first = parseGedcom(input, { version });
    const text = stringifyGedcom(first, { version });
    const second = parseGedcom(text, { version });
    const delta = second.records.length - first.records.length;
    io.write(`records: ${first.records.length} → ${second.records.length} (Δ ${delta >= 0 ? "+" : ""}${delta})\n`);
    return EXIT.SUCCESS;
  } catch (error) {
    io.writeErr(`roundtrip error: ${(error as Error).message}\n`);
    return EXIT.ERROR;
  }
}

function emit(output: string, outFile: string | undefined, io: CliIo): number {
  if (outFile) {
    writeFileSync(outFile, output);
  } else {
    io.write(output);
  }
  return EXIT.SUCCESS;
}

const SUBCOMMAND_OPTIONS = {
  version: { type: "string" },
  to: { type: "string" },
  from: { type: "string" },
  against: { type: "string" },
  output: { type: "string", short: "o" },
  strict: { type: "boolean" },
  "preserve-unknown": { type: "boolean" },
  help: { type: "boolean", short: "h" }
} as const;

export function runCli(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    io.write(`${USAGE}\n`);
    return command ? EXIT.SUCCESS : EXIT.USAGE;
  }

  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({ args: rest, options: SUBCOMMAND_OPTIONS, allowPositionals: true }) as typeof parsed;
  } catch (error) {
    io.writeErr(`${(error as Error).message}\n`);
    return EXIT.USAGE;
  }

  if (parsed.values.help) {
    io.write(`${USAGE}\n`);
    return EXIT.SUCCESS;
  }

  switch (command) {
    case "detect":
      return cmdDetect(parsed.positionals, io);
    case "parse":
      return cmdParse(parsed.positionals, parsed.values, io);
    case "stringify":
      return cmdStringify(parsed.positionals, parsed.values, io);
    case "convert":
      return cmdConvert(parsed.positionals, parsed.values, io);
    case "validate":
      return cmdValidate(parsed.positionals, parsed.values, io);
    case "roundtrip":
      return cmdRoundtrip(parsed.positionals, parsed.values, io);
    default:
      io.writeErr(`unknown command: ${command}\n\n${USAGE}\n`);
      return EXIT.USAGE;
  }
}
