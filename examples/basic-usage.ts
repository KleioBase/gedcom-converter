import { convertGedcom, detectGedcomVersion } from "../src/index.js";

const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NAME Ada /Lovelace/
1 BIRT
2 DATE BET 1 JAN 1815 AND 31 DEC 1815
3 PHRASE about 1815
1 SNOTE @N1@
0 @I2@ INDI
1 NAME Charles /Babbage/
0 @N1@ SNOTE Shared note
0 TRLR`;

const detected = detectGedcomVersion(input);

const result = convertGedcom(input, {
  from: detected === "unknown" ? "7.0.18" : detected,
  to: "5.5.1"
});

console.log(`Detected version: ${detected}`);
console.log(result.output);

if (result.diagnostics.length > 0) {
  console.log("Diagnostics:");

  for (const diagnostic of result.diagnostics) {
    console.log(`- ${diagnostic.severity}: ${diagnostic.code} - ${diagnostic.message}`);
  }
}
