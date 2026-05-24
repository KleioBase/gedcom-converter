import type { Diagnostic, GedcomNode, ParsedDocument, ParsedRecord } from "../types.js";

interface MappingContext {
  parentTag?: string;
  grandParentTag?: string;
}

const PRESERVED_HEADER_TAGS = new Set(["SOUR", "DEST", "DATE", "SUBM", "COPR", "FILE", "NOTE", "PLAC"]);
const GEDCOM7_NAME_TYPES = new Set(["AKA", "BIRTH", "IMMIGRANT", "MAIDEN", "MARRIED", "PROFESSIONAL", "OTHER"]);

const GEDCOM551_NAME_TYPE_ALIASES: Record<string, string> = {
  AKA: "AKA",
  ALSO_KNOWN_AS: "AKA",
  ALIAS: "AKA",
  BIRTH: "BIRTH",
  IMMIGRANT: "IMMIGRANT",
  IMMIGRATION: "IMMIGRANT",
  MAIDEN: "MAIDEN",
  MARRIED: "MARRIED",
  PROFESSIONAL: "PROFESSIONAL",
  PROFESSION: "PROFESSIONAL",
  OTHER: "OTHER"
};

const LEGACY_AGE_KEYWORDS = new Set(["CHILD", "INFANT", "STILLBORN"]);
const VALID_RESN_VALUES = new Set(["CONFIDENTIAL", "LOCKED", "PRIVACY"]);
const VALID_LDS_STAT_VALUES = new Set([
  "BIC",
  "CANCELED",
  "CHILD",
  "COMPLETED",
  "DNS",
  "DNS_CAN",
  "EXCLUDED",
  "INFANT",
  "PRE_1970",
  "STILLBORN",
  "SUBMITTED",
  "UNCLEARED"
]);

// v7 §3.4 enumset-MEDI (spec p.96–97). Uppercase enum; 5.5.1 stored the same
// values in lowercase. Unknown values fall back to OTHER + PHRASE.
const VALID_MEDI_VALUES = new Set([
  "AUDIO",
  "BOOK",
  "CARD",
  "ELECTRONIC",
  "FICHE",
  "FILM",
  "MAGAZINE",
  "MANUSCRIPT",
  "MAP",
  "NEWSPAPER",
  "PHOTO",
  "TOMBSTONE",
  "VIDEO",
  "OTHER"
]);

// URIs chosen so the existing mapExidNode in src/mappings/v7-to-551.ts
// (which dispatches on `/RIN` and `/RFN#` substrings) round-trips them back
// to the original 5.5.1 tag. Keep these endings stable.
const RIN_EXID_TYPE_URI = "https://kleiobase.io/terms/legacy/551/RIN";
const RFN_EXID_TYPE_URI = "https://kleiobase.io/terms/legacy/551/RFN#";

interface ParsedAgePayload {
  bound?: "<" | ">";
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
}

const AGE_PAYLOAD_PATTERN =
  /^\s*([<>])?\s*(?:(\d+)\s*y)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*w)?\s*(?:(\d+)\s*d)?\s*$/i;

function extendMappingContext(context: MappingContext, parentTag: string): MappingContext {
  return {
    parentTag,
    ...(context.parentTag !== undefined ? { grandParentTag: context.parentTag } : {})
  };
}

function cloneNode(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.map(cloneNode)
  };
}

function cloneAtLevel(node: GedcomNode, level: number): GedcomNode {
  return {
    ...cloneNode(node),
    level,
    children: node.children.map((child) => cloneAtLevel(child, level + 1))
  };
}

function makeNode(base: {
  level: number;
  tag: string;
  children: GedcomNode[];
  value?: string;
  xref?: string;
}): GedcomNode {
  return {
    level: base.level,
    tag: base.tag,
    children: base.children,
    ...(base.value !== undefined ? { value: base.value } : {}),
    ...(base.xref !== undefined ? { xref: base.xref } : {})
  };
}

function withOptionalLocation(node: GedcomNode): { line?: number; tag: string } {
  return {
    tag: node.tag,
    ...(node.lineNumber !== undefined ? { line: node.lineNumber } : {})
  };
}

function normalizeNameTypeToken(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function mapGedcom551NameTypeToV7(value: string | undefined): GedcomNode["value"] {
  if (!value) {
    return value;
  }

  const normalized = normalizeNameTypeToken(value);
  return GEDCOM551_NAME_TYPE_ALIASES[normalized] ?? (GEDCOM7_NAME_TYPES.has(normalized) ? normalized : undefined);
}

function mapNameTypeNode(node: GedcomNode): GedcomNode {
  const mappedValue = mapGedcom551NameTypeToV7(node.value);

  if (mappedValue) {
    return makeNode({
      level: node.level,
      tag: "TYPE",
      value: mappedValue,
      children: []
    });
  }

  return makeNode({
    level: node.level,
    tag: "TYPE",
    value: "OTHER",
    children: node.value
      ? [
          makeNode({
            level: node.level + 1,
            tag: "PHRASE",
            value: node.value,
            children: []
          })
        ]
      : []
  });
}

function parseAgePayload(value: string): ParsedAgePayload | null {
  const match = AGE_PAYLOAD_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [, bound, years, months, weeks, days] = match;
  if (!years && !months && !weeks && !days) {
    return null;
  }

  const parsed: ParsedAgePayload = {};
  if (bound === "<" || bound === ">") {
    parsed.bound = bound;
  }
  if (years !== undefined) {
    parsed.years = Number(years);
  }
  if (months !== undefined) {
    parsed.months = Number(months);
  }
  if (weeks !== undefined) {
    parsed.weeks = Number(weeks);
  }
  if (days !== undefined) {
    parsed.days = Number(days);
  }
  return parsed;
}

function formatAgePayload(parsed: ParsedAgePayload): string {
  const parts: string[] = [];
  if (parsed.bound) {
    parts.push(parsed.bound);
  }
  if (parsed.years !== undefined) {
    parts.push(`${parsed.years}y`);
  }
  if (parsed.months !== undefined) {
    parts.push(`${parsed.months}m`);
  }
  if (parsed.weeks !== undefined) {
    parts.push(`${parsed.weeks}w`);
  }
  if (parsed.days !== undefined) {
    parts.push(`${parsed.days}d`);
  }
  return parts.join(" ");
}

function ageWithPhraseFallback(node: GedcomNode, mappedChildren: GedcomNode[], phrase: string): GedcomNode {
  const hasPhrase = mappedChildren.some((child) => child.tag === "PHRASE");
  const children = hasPhrase
    ? mappedChildren
    : [
        ...mappedChildren,
        makeNode({
          level: node.level + 1,
          tag: "PHRASE",
          value: phrase,
          children: []
        })
      ];

  return makeNode({
    level: node.level,
    tag: "AGE",
    children
  });
}

function mapAgeNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const raw = node.value?.trim() ?? "";
  const mappedChildren = node.children.map(cloneNode);

  if (!raw) {
    return makeNode({
      level: node.level,
      tag: "AGE",
      children: mappedChildren
    });
  }

  if (LEGACY_AGE_KEYWORDS.has(raw.toUpperCase())) {
    diagnostics.push({
      severity: "info",
      code: "AGE_PHRASE_FALLBACK",
      message: `Moved GEDCOM 5.5.1 AGE keyword ${raw} into GEDCOM 7 PHRASE substructure.`,
      location: withOptionalLocation(node)
    });
    return ageWithPhraseFallback(node, mappedChildren, raw);
  }

  const parsed = parseAgePayload(raw);
  if (parsed) {
    return makeNode({
      level: node.level,
      tag: "AGE",
      value: formatAgePayload(parsed),
      children: mappedChildren
    });
  }

  diagnostics.push({
    severity: "info",
    code: "AGE_PHRASE_FALLBACK",
    message: `Moved non-numeric GEDCOM 5.5.1 AGE value ${raw} into GEDCOM 7 PHRASE substructure.`,
    location: withOptionalLocation(node)
  });
  return ageWithPhraseFallback(node, mappedChildren, raw);
}

function normalizeLdsStatToken(value: string): string {
  // 5.5.1 spells the SLGS cancellation status `DNS/CAN`; v7 spells it `DNS_CAN`.
  // Strip slash, hyphen, and whitespace so both forms collapse onto the v7 enum.
  return value.trim().toUpperCase().replace(/[\s\-/]+/g, "_");
}

function mapLdsStatNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const raw = node.value?.trim();
  const mappedChildren = node.children.map(cloneNode);

  if (!raw) {
    return makeNode({
      level: node.level,
      tag: "STAT",
      children: mappedChildren
    });
  }

  const normalized = normalizeLdsStatToken(raw);

  if (VALID_LDS_STAT_VALUES.has(normalized)) {
    return makeNode({
      level: node.level,
      tag: "STAT",
      value: normalized,
      children: mappedChildren
    });
  }

  diagnostics.push({
    severity: "info",
    code: "LDS_STAT_UNMAPPED",
    message: `Preserved unmappable GEDCOM 5.5.1 LDS STAT ${raw} as PHRASE in GEDCOM 7.`,
    location: withOptionalLocation(node)
  });

  const hasPhrase = mappedChildren.some((child) => child.tag === "PHRASE");
  const childrenWithPhrase = hasPhrase
    ? mappedChildren
    : [
        ...mappedChildren,
        makeNode({
          level: node.level + 1,
          tag: "PHRASE",
          value: raw,
          children: []
        })
      ];

  return makeNode({
    level: node.level,
    tag: "STAT",
    children: childrenWithPhrase
  });
}

function mapIdnoNode(node: GedcomNode, context: MappingContext, diagnostics: Diagnostic[]): GedcomNode {
  const mappedChildren = node.children.map((child) =>
    mapNode(child, extendMappingContext(context, node.tag), diagnostics)
  );

  const hasType = mappedChildren.some((child) => child.tag === "TYPE");
  if (hasType) {
    return makeNode({
      level: node.level,
      tag: "IDNO",
      ...(node.value !== undefined ? { value: node.value } : {}),
      children: mappedChildren
    });
  }

  diagnostics.push({
    severity: "info",
    code: "IDNO_TYPE_SYNTHESIZED",
    message: `Synthesized GEDCOM 7 IDNO TYPE OTHER because the GEDCOM 5.5.1 source omitted the TYPE substructure.`,
    location: withOptionalLocation(node)
  });

  const syntheticType = makeNode({
    level: node.level + 1,
    tag: "TYPE",
    value: "OTHER",
    children: node.value
      ? [
          makeNode({
            level: node.level + 2,
            tag: "PHRASE",
            value: node.value,
            children: []
          })
        ]
      : []
  });

  return makeNode({
    level: node.level,
    tag: "IDNO",
    ...(node.value !== undefined ? { value: node.value } : {}),
    children: [...mappedChildren, syntheticType]
  });
  // Note: GED-6 only synthesizes TYPE for IDNO. INDI.EVEN / FAM.EVEN / FACT
  // also require TYPE in v7; those will be handled when a fixture surfaces
  // the case in the round-trip corpus (GED-9).
}

function mapResnNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const raw = node.value?.trim();
  const mappedChildren = node.children.map(cloneNode);

  if (!raw) {
    return makeNode({
      level: node.level,
      tag: "RESN",
      children: mappedChildren
    });
  }

  const tokens = raw
    .split(/[,\s]+/)
    .map((token) => token.trim().toUpperCase())
    .filter((token) => token.length > 0);

  const validTokens: string[] = [];
  const droppedTokens: string[] = [];

  for (const token of tokens) {
    if (VALID_RESN_VALUES.has(token)) {
      if (!validTokens.includes(token)) {
        validTokens.push(token);
      }
    } else {
      droppedTokens.push(token);
    }
  }

  if (validTokens.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "RESN_PHRASE_FALLBACK",
      message: `Unable to map GEDCOM 5.5.1 RESN value ${raw} to any GEDCOM 7 enum; preserved as _RESN.`,
      location: withOptionalLocation(node)
    });

    return makeNode({
      level: node.level,
      tag: "_RESN",
      value: raw,
      children: mappedChildren
    });
  }

  const normalizedValue = validTokens.join(", ");

  if (normalizedValue !== raw || droppedTokens.length > 0) {
    diagnostics.push({
      severity: "info",
      code: "RESN_NORMALIZED",
      message:
        droppedTokens.length > 0
          ? `Normalized GEDCOM 5.5.1 RESN ${raw} to ${normalizedValue}; dropped unsupported tokens ${droppedTokens.join(", ")}.`
          : `Normalized GEDCOM 5.5.1 RESN ${raw} to ${normalizedValue}.`,
      location: withOptionalLocation(node)
    });
  }

  return makeNode({
    level: node.level,
    tag: "RESN",
    value: normalizedValue,
    children: mappedChildren
  });
}

function collectCustomTagsFromNode(node: GedcomNode, tags: Set<string>): void {
  if (node.tag.startsWith("_")) {
    tags.add(node.tag);
  }

  for (const child of node.children) {
    collectCustomTagsFromNode(child, tags);
  }
}

function collectCustomTags(document: ParsedDocument): string[] {
  const tags = new Set<string>();

  for (const child of document.header.raw.children) {
    collectCustomTagsFromNode(child, tags);
  }

  for (const record of document.records) {
    for (const child of record.children) {
      collectCustomTagsFromNode(child, tags);
    }
  }

  for (const extension of document.extensions) {
    collectCustomTagsFromNode(extension, tags);
  }

  return [...tags].sort();
}

function buildGedcomNode(): GedcomNode {
  return makeNode({
    level: 1,
    tag: "GEDC",
    children: [
      makeNode({
        level: 2,
        tag: "VERS",
        value: "7.0.18",
        children: []
      })
    ]
  });
}

function buildSchemaNode(customTags: string[]): GedcomNode | null {
  if (customTags.length === 0) {
    return null;
  }

  return makeNode({
    level: 1,
    tag: "SCHMA",
    children: customTags.map((tag) =>
      makeNode({
        level: 2,
        tag: "TAG",
        value: tag,
        children: []
      })
    )
  });
}

function mapHeader(document: ParsedDocument): ParsedDocument["header"] {
  const preservedChildren = document.header.raw.children
    .filter((child) => PRESERVED_HEADER_TAGS.has(child.tag))
    .map((child) => cloneAtLevel(child, 1));
  const schemaNode = buildSchemaNode(collectCustomTags(document));

  return {
    ...document.header,
    gedcomVersion: "7.0.18",
    characterSet: "UTF-8",
    raw: makeNode({
      level: 0,
      tag: "HEAD",
      children: [
        ...preservedChildren,
        buildGedcomNode(),
        ...(schemaNode ? [schemaNode] : [])
      ]
    })
  };
}

// Inverse of ROLE_TEXT_ALIASES in src/mappings/v7-to-551.ts. Keep the two in sync.
const ROLE_TEXT_TO_ENUM: Record<string, string> = {
  CHILD: "CHIL",
  CLERGY: "CLERGY",
  FATHER: "FATH",
  FRIEND: "FRIEND",
  GODPARENT: "GODP",
  HUSBAND: "HUSB",
  MOTHER: "MOTH",
  MULTIPLE: "MULTIPLE",
  NEIGHBOR: "NGHBR",
  OFFICIATOR: "OFFICIATOR",
  PARENT: "PARENT",
  SPOUSE: "SPOU",
  WIFE: "WIFE",
  WITNESS: "WITN"
};

function lookupRoleEnum(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const key = value.trim().toUpperCase().replace(/[\s_-]+/g, "");
  return ROLE_TEXT_TO_ENUM[key];
}

function buildRoleNode(node: GedcomNode, sourceValue: string | undefined, diagnostics: Diagnostic[], diagnosticCode: string): GedcomNode {
  const enumValue = lookupRoleEnum(sourceValue);
  if (enumValue) {
    return makeNode({
      level: node.level,
      tag: "ROLE",
      value: enumValue,
      children: []
    });
  }

  diagnostics.push({
    severity: "info",
    code: diagnosticCode,
    message: `Preserved GEDCOM 5.5.1 free-text role ${sourceValue ?? ""} as GEDCOM 7 ROLE OTHER + PHRASE.`,
    location: withOptionalLocation(node)
  });

  return makeNode({
    level: node.level,
    tag: "ROLE",
    value: "OTHER",
    children: sourceValue
      ? [
          makeNode({
            level: node.level + 1,
            tag: "PHRASE",
            value: sourceValue,
            children: []
          })
        ]
      : []
  });
}

function mapAssoNode(node: GedcomNode, context: MappingContext, diagnostics: Diagnostic[]): GedcomNode {
  const mappedChildren: GedcomNode[] = [];
  let roleInjected = false;

  for (const child of node.children) {
    if (child.tag === "RELA") {
      mappedChildren.push(buildRoleNode(child, child.value, diagnostics, "RELA_PHRASE_FALLBACK"));
      roleInjected = true;
      continue;
    }

    mappedChildren.push(mapNode(child, extendMappingContext(context, node.tag), diagnostics));
  }

  // v7 ASSO requires a ROLE child. If the 5.5.1 source omitted RELA, synthesize ROLE OTHER
  // so the output stays valid; the absence is recorded as a diagnostic.
  if (!roleInjected) {
    diagnostics.push({
      severity: "info",
      code: "ASSO_ROLE_SYNTHESIZED",
      message: `Synthesized GEDCOM 7 ASSO ROLE OTHER because the GEDCOM 5.5.1 source omitted RELA.`,
      location: withOptionalLocation(node)
    });
    mappedChildren.push(
      makeNode({
        level: node.level + 1,
        tag: "ROLE",
        value: "OTHER",
        children: []
      })
    );
  }

  return makeNode({
    level: node.level,
    tag: "ASSO",
    ...(node.value !== undefined ? { value: node.value } : {}),
    children: mappedChildren
  });
}

function mapSourceCitationRoleNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  return buildRoleNode(node, node.value, diagnostics, "CITATION_ROLE_PHRASE_FALLBACK");
}

function mapMediNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const raw = node.value?.trim();
  if (!raw) {
    return makeNode({ level: node.level, tag: "MEDI", children: node.children.map(cloneNode) });
  }

  const upper = raw.toUpperCase();
  if (VALID_MEDI_VALUES.has(upper)) {
    return makeNode({
      level: node.level,
      tag: "MEDI",
      value: upper,
      children: node.children.map(cloneNode)
    });
  }

  diagnostics.push({
    severity: "info",
    code: "MEDI_PHRASE_FALLBACK",
    message: `Unable to map GEDCOM 5.5.1 MEDI value ${raw} to a GEDCOM 7 enum; emitted OTHER + PHRASE.`,
    location: withOptionalLocation(node)
  });

  const existingChildren = node.children.map(cloneNode);
  const hasPhrase = existingChildren.some((child) => child.tag === "PHRASE");
  const children = hasPhrase
    ? existingChildren
    : [
        ...existingChildren,
        makeNode({
          level: node.level + 1,
          tag: "PHRASE",
          value: raw,
          children: []
        })
      ];

  return makeNode({
    level: node.level,
    tag: "MEDI",
    value: "OTHER",
    children
  });
}

function makeIdentifierExidNode(node: GedcomNode, typeUri: string): GedcomNode {
  return makeNode({
    level: node.level,
    tag: "EXID",
    ...(node.value !== undefined ? { value: node.value } : {}),
    children: [
      makeNode({
        level: node.level + 1,
        tag: "TYPE",
        value: typeUri,
        children: []
      })
    ]
  });
}

function mapRinNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  diagnostics.push({
    severity: "info",
    code: "RIN_TO_EXID",
    message: `Mapped GEDCOM 5.5.1 RIN ${node.value ?? ""} to GEDCOM 7 EXID with legacy TYPE URI (RIN is not a v7 standard tag).`,
    location: withOptionalLocation(node)
  });
  return makeIdentifierExidNode(node, RIN_EXID_TYPE_URI);
}

function mapRfnNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  diagnostics.push({
    severity: "info",
    code: "RFN_TO_EXID",
    message: `Mapped GEDCOM 5.5.1 RFN ${node.value ?? ""} to GEDCOM 7 EXID with legacy TYPE URI (RFN is not a v7 standard tag).`,
    location: withOptionalLocation(node)
  });
  return makeIdentifierExidNode(node, RFN_EXID_TYPE_URI);
}

function promoteNoteRecordsToSnote(records: ParsedRecord[], diagnostics: Diagnostic[]): { records: ParsedRecord[]; promoted: Set<string> } {
  const promoted = new Set<string>();
  const rewritten = records.map((record) => {
    if (record.tag === "NOTE" && record.xref !== undefined) {
      promoted.add(record.xref);
      diagnostics.push({
        severity: "info",
        code: "NOTE_RECORD_PROMOTED",
        message: `Promoted GEDCOM 5.5.1 NOTE record ${record.xref} to GEDCOM 7 SNOTE record.`,
        location: { tag: "NOTE" }
      });
      return {
        ...record,
        tag: "SNOTE"
      };
    }
    return record;
  });
  return { records: rewritten, promoted };
}

function rewriteInlineNotePointers(node: GedcomNode, promoted: Set<string>): GedcomNode {
  const rewrittenChildren = node.children.map((child) => rewriteInlineNotePointers(child, promoted));

  if (node.tag === "NOTE" && node.value && promoted.has(node.value)) {
    return {
      ...node,
      tag: "SNOTE",
      children: rewrittenChildren
    };
  }

  return {
    ...node,
    children: rewrittenChildren
  };
}

function mapNode(node: GedcomNode, context: MappingContext, diagnostics: Diagnostic[]): GedcomNode {
  if (node.tag === "TYPE" && context.parentTag === "NAME") {
    return mapNameTypeNode(node);
  }

  if (node.tag === "AGE") {
    return mapAgeNode(node, diagnostics);
  }

  if (node.tag === "STAT") {
    return mapLdsStatNode(node, diagnostics);
  }

  if (node.tag === "RESN") {
    return mapResnNode(node, diagnostics);
  }

  if (node.tag === "IDNO") {
    return mapIdnoNode(node, context, diagnostics);
  }

  if (node.tag === "ASSO") {
    return mapAssoNode(node, context, diagnostics);
  }

  if (node.tag === "ROLE" && context.parentTag === "EVEN" && context.grandParentTag === "SOUR") {
    return mapSourceCitationRoleNode(node, diagnostics);
  }

  if (node.tag === "MEDI") {
    return mapMediNode(node, diagnostics);
  }

  if (node.tag === "RIN") {
    return mapRinNode(node, diagnostics);
  }

  if (node.tag === "RFN") {
    return mapRfnNode(node, diagnostics);
  }

  return makeNode({
    level: node.level,
    tag: node.tag,
    children: node.children.map((child) => mapNode(child, extendMappingContext(context, node.tag), diagnostics)),
    ...(node.value !== undefined ? { value: node.value } : {}),
    ...(node.xref !== undefined ? { xref: node.xref } : {})
  });
}

function mapRecord(record: ParsedRecord, diagnostics: Diagnostic[]): ParsedRecord {
  return {
    tag: record.tag,
    children: record.children.map((child) => mapNode(child, {}, diagnostics)),
    ...(record.xref !== undefined ? { xref: record.xref } : {}),
    ...(record.value !== undefined ? { value: record.value } : {})
  };
}

export function mapGedcom551DocumentToV7(document: ParsedDocument): ParsedDocument {
  const diagnostics = [...document.diagnostics];

  // Two-pass NOTE handling: promote top-level NOTE records to SNOTE, then rewrite
  // every inline NOTE pointer that targets a promoted xref so the v7 graph is
  // self-consistent. Inline NOTE substructures with literal payloads are untouched.
  const { records: noteRewrittenRecords, promoted: promotedNoteXrefs } = promoteNoteRecordsToSnote(
    document.records,
    diagnostics
  );
  const pointerRewrittenRecords = noteRewrittenRecords.map((record) => ({
    ...record,
    children: record.children.map((child) => rewriteInlineNotePointers(child, promotedNoteXrefs))
  }));

  const mappedRecords = pointerRewrittenRecords.map((record) => mapRecord(record, diagnostics));

  // SCHMA must declare every custom tag in the *mapped* document, not the source,
  // because the mapper itself may introduce new extensions (e.g. _RESN fallback).
  const header = mapHeader({ ...document, records: mappedRecords });

  return {
    version: "7.0.18",
    header,
    records: mappedRecords,
    extensions: document.extensions.map(cloneNode),
    diagnostics
  };
}
