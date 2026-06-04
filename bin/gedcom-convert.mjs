#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runCli } from "../dist/cli.js";

// Read piped stdin (if any) so `… <file>` can use "-" for stdin.
let stdin = "";
if (!process.stdin.isTTY) {
  try {
    stdin = readFileSync(0, "utf8");
  } catch {
    stdin = "";
  }
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;

const exitCode = runCli(process.argv.slice(2), {
  write: (text) => process.stdout.write(text),
  writeErr: (text) => process.stderr.write(text),
  stdin,
  color
});

process.exit(exitCode);
