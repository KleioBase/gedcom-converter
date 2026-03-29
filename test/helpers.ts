import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), "fixtures", name), "utf8");
}
