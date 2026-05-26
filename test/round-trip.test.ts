import { describe, expect, it } from "vitest";
import { convertGedcom } from "../src/index.js";
import { readFixture } from "./helpers.js";
import { expectStructuralEquivalence, normalizeForDiff } from "./helpers/round-trip.js";
import type { SupportedVersion } from "../src/types.js";

interface FixtureSpec {
  /** Path passed to readFixture(). */
  path: string;
  /** Source version of the fixture. */
  version: SupportedVersion;
  /**
   * Allow-list of diagnostic codes the round-trip may emit. Any code that
   * appears in the actual output must be in this set; codes in the list that
   * don't show up are fine (the converter may stop emitting them in future
   * passes). Combines both legs of the round-trip into a single set.
   */
  allowedDiagnostics: string[];
  /**
   * When true, additionally assert that normalizeForDiff(roundTrip) equals
   * normalizeForDiff(input). Only practical for the minimal fixtures.
   */
  expectTextEquivalence?: boolean;
}

const FIXTURES_551: FixtureSpec[] = [
  {
    path: "minimal-5.5.1.ged",
    version: "5.5.1",
    allowedDiagnostics: [],
    expectTextEquivalence: true
  }
  // fixtures/official/gedcom551/TGC551LF.ged is GEDCOM 5.5 (not 5.5.1) and
  // ISO-8859 encoded. Direct 5.5 → 7.0.18 round-trip lands in GED-10; this
  // suite enables it via the it.todo() at the bottom of the describe block.
];

// All diagnostic codes below were captured by running the round-trip suite
// with an empty allow-list and harvesting the actual emissions. Adding a new
// code here means the converter started emitting a new diagnostic for a
// known fixture; if that code represents a regression, the underlying
// converter should be fixed instead of the allow-list extended.
const FIXTURES_70: FixtureSpec[] = [
  {
    path: "minimal-7.0.18.ged",
    version: "7.0.18",
    allowedDiagnostics: []
    // No expectTextEquivalence: the 5.5.1 downgrade synthesises a SUBM record
    // (5.5.1 mandates one, v7 does not) which then survives back to v7. The
    // structural-equivalence check still passes because the synthesised SUBM
    // is an *addition*, not a loss.
  },
  {
    path: "official/gedcom70/age.ged",
    version: "7.0.18",
    allowedDiagnostics: ["AGE_PHRASE_NOTED"]
  },
  {
    path: "official/gedcom70/escapes.ged",
    version: "7.0.18",
    allowedDiagnostics: ["AT_CONTINUATION_NOTED", "NOTE_RECORD_PROMOTED"]
  },
  {
    path: "official/gedcom70/filename-1.ged",
    version: "7.0.18",
    allowedDiagnostics: [
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_NOTED",
      "FORM_TO_MIME_CONVERTED",
      "UNSUPPORTED_MEDIA_FORMAT"
    ]
  },
  {
    path: "official/gedcom70/lang.ged",
    version: "7.0.18",
    allowedDiagnostics: []
  },
  {
    path: "official/gedcom70/maximal70.ged",
    version: "7.0.18",
    allowedDiagnostics: [
      "AGE_PHRASE_NOTED",
      "ASSOCIATION_NOTED",
      "ASSO_PHRASE_NOTED",
      "AT_CONTINUATION_NOTED",
      "CALN_MEDI_PHRASE_NOTED",
      "CITATION_EVENT_PHRASE_NOTED",
      "CITATION_ROLE_PHRASE_FALLBACK",
      "CONTACT_ID_NOTED",
      "CREA_NOTED",
      "CREA_TIME_NOTED",
      "DATE_PHRASE_DEGRADED",
      "EVENT_TIME_NOTED",
      "EXID_NOTED",
      "EXID_PRESERVED",
      "EXID_TO_REFN",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_NOTED",
      "FILE_TITLE_NOTED",
      "FILE_TRANSLATION_NOTED",
      "FORM_TO_MIME_CONVERTED",
      "INIL_NOTED",
      "LDS_DATE_TIME_NOTED",
      "LDS_STATUS_TIME_NOTED",
      "LDS_STAT_UNMAPPED",
      "NAME_TRANSLATION_NOTED",
      "NCHI_METADATA_NOTED",
      "NOTE_CHILD_FLATTENED",
      "NOTE_RECORD_PROMOTED",
      "NOTE_SOURCE_CITATION_NOTED",
      "NO_NOTED",
      "OBJECT_CROP_NOTED",
      "OBJECT_LINK_NOTE_HOISTED",
      "OBJECT_RESN_NOTED",
      "OBJECT_TITLE_NOTED",
      "POINTER_PHRASE_NOTED",
      "REDUNDANT_AGE_PHRASE_DROPPED",
      "REDUNDANT_ALIAS_PHRASE_DROPPED",
      "REDUNDANT_PLACE_TRANSLATION_DROPPED",
      "REFN_NOTED",
      "RESN_REDUCED",
      "ROLE_TO_RELA_FALLBACK",
      "SDATE_NOTED",
      "SDATE_PHRASE_DROPPED",
      "SLGC_NOTED",
      "SOURCE_DATA_TIME_NOTED",
      "SOURCE_PLACE_HIERARCHY_NOTED",
      "SOURCE_PLACE_LANGUAGE_NOTED",
      "SOURCE_PLACE_MAP_NOTED",
      "SOURCE_PLACE_NOTE_NOTED",
      "SSN_NOTED",
      "STAT_NOTED",
      "TEXT_LANGUAGE_NOTED",
      "TRAN_LANGUAGE_INLINED",
      "UIDS_MERGED",
      "UID_NOTED",
      "VALUE_NOTED",
      "VOID_POINTER_NOTED"
    ]
  },
  {
    path: "official/gedcom70/maximal70-lds.ged",
    version: "7.0.18",
    allowedDiagnostics: ["INIL_NOTED", "SLGC_NOTED", "VOID_POINTER_NOTED"]
  },
  {
    path: "official/gedcom70/maximal70-memories2.ged",
    version: "7.0.18",
    allowedDiagnostics: [
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_NOTED",
      "VOID_POINTER_NOTED"
    ]
  },
  {
    path: "official/gedcom70/maximal70-tree2.ged",
    version: "7.0.18",
    allowedDiagnostics: ["NCHI_METADATA_NOTED", "SSN_NOTED", "VALUE_NOTED", "VOID_POINTER_NOTED"]
  },
  {
    path: "official/gedcom70/notes-1.ged",
    version: "7.0.18",
    allowedDiagnostics: ["NOTE_RECORD_PROMOTED"]
  },
  {
    path: "official/gedcom70/obje-1.ged",
    version: "7.0.18",
    allowedDiagnostics: [
      "FILE_REFERENCE_NOTED",
      "FILE_TITLE_NOTED",
      "FORM_TO_MIME_CONVERTED",
      "OBJECT_LINK_NOTE_HOISTED",
      "OBJECT_TITLE_NOTED",
      "UNSUPPORTED_MEDIA_FORMAT"
    ]
  },
  {
    path: "official/gedcom70/voidptr.ged",
    version: "7.0.18",
    allowedDiagnostics: ["VOID_POINTER_NOTED"]
  },
  {
    path: "official/gedcom70/xref.ged",
    version: "7.0.18",
    allowedDiagnostics: []
  }
];

function counterpart(version: SupportedVersion): SupportedVersion {
  return version === "5.5.1" ? "7.0.18" : "5.5.1";
}

function assertAllowedDiagnostics(actualCodes: string[], allowed: string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unexpected = actualCodes.filter((code) => !allowedSet.has(code));
  expect(unexpected, `${label} produced diagnostic codes outside the allow-list`).toEqual([]);
}

describe("round-trip corpus", () => {
  describe.each(FIXTURES_551)("5.5.1 → 7.0 → 5.5.1: $path", (spec) => {
    const input = readFixture(spec.path);
    const upgraded = convertGedcom(input, { from: spec.version, to: counterpart(spec.version) });
    const roundTripped = convertGedcom(upgraded.output, {
      from: counterpart(spec.version),
      to: spec.version
    });
    const codes = [
      ...upgraded.diagnostics.map((diagnostic) => diagnostic.code),
      ...roundTripped.diagnostics.map((diagnostic) => diagnostic.code)
    ];

    it("emits only allow-listed diagnostics", () => {
      assertAllowedDiagnostics(codes, spec.allowedDiagnostics, spec.path);
    });

    it("preserves the record corpus", () => {
      expectStructuralEquivalence(input, roundTripped.output, spec.version);
    });

    if (spec.expectTextEquivalence) {
      it("round-trips to a textually equivalent payload (modulo header)", () => {
        expect(normalizeForDiff(roundTripped.output)).toEqual(normalizeForDiff(input));
      });
    }
  });

  describe.each(FIXTURES_70)("7.0 → 5.5.1 → 7.0: $path", (spec) => {
    const input = readFixture(spec.path);
    const downgraded = convertGedcom(input, { from: spec.version, to: counterpart(spec.version) });
    const roundTripped = convertGedcom(downgraded.output, {
      from: counterpart(spec.version),
      to: spec.version
    });
    const codes = [
      ...downgraded.diagnostics.map((diagnostic) => diagnostic.code),
      ...roundTripped.diagnostics.map((diagnostic) => diagnostic.code)
    ];

    it("emits only allow-listed diagnostics", () => {
      assertAllowedDiagnostics(codes, spec.allowedDiagnostics, spec.path);
    });

    it("preserves the record corpus", () => {
      expectStructuralEquivalence(input, roundTripped.output, spec.version);
    });

    if (spec.expectTextEquivalence) {
      it("round-trips to a textually equivalent payload (modulo header)", () => {
        expect(normalizeForDiff(roundTripped.output)).toEqual(normalizeForDiff(input));
      });
    }
  });

  it.todo(
    "round-trips GEDCOM 5.5 fixtures (TGC551LF.ged) once 5.5 → 7.0.18 path lands in GED-10"
  );
});
