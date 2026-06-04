// stringify.ts — build a ParsedDocument programmatically and serialize it.
//
// Run: tsx examples/stringify.ts
import { stringifyGedcom } from "../src/index.js";
import type { ParsedDocument } from "../src/index.js";

const document: ParsedDocument = {
  version: "7.0.18",
  header: {
    gedcomVersion: "7.0.18",
    characterSet: "UTF-8",
    sourceSystem: "ExampleApp",
    raw: { level: 0, tag: "HEAD", children: [] }
  },
  records: [
    {
      tag: "INDI",
      xref: "@I1@",
      children: [
        { level: 1, tag: "NAME", value: "Ada /Lovelace/", children: [] },
        {
          level: 1,
          tag: "BIRT",
          children: [{ level: 2, tag: "DATE", value: "10 DEC 1815", children: [] }]
        }
      ]
    }
  ],
  extensions: [],
  diagnostics: []
};

// Serialize to GEDCOM 7 (CRLF line endings, for example).
const output = stringifyGedcom(document, { version: "7.0.18", lineEnding: "LF" });
console.log(output);

// To save it: writeFileSync("out.ged", output);
