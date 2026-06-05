import {
  MEDI as MEDI_ENUM,
  NAME_TYPE as NAME_TYPE_ENUM,
  NAME_TYPE_ALIASES,
  ORD_STAT as ORD_STAT_ENUM,
  PEDI as PEDI_ENUM,
  RESN as RESN_ENUM,
  ROLE as ROLE_ENUM,
  ROLE_TEXT_ALIASES,
  enumOrPhrase,
  normalizeRoleToken
} from "../enums/index.js";
import type { Diagnostic, GedcomNode, ParsedDocument, ParsedRecord } from "../types.js";
import { mapGedcom551DateNodeToV7 } from "./date/551-to-v7.js";
import { joinTagPayload, splitTagPayload, syntheticTagUri } from "./schema.js";

interface MappingContext {
  parentTag?: string;
  grandParentTag?: string;
}

const PRESERVED_HEADER_TAGS = new Set(["SOUR", "DEST", "DATE", "SUBM", "COPR", "FILE", "NOTE", "PLAC", "LANG"]);

// GEDCOM 7 HEAD.LANG must be a BCP-47 tag, not a free-text language name. Map the
// names the 5.5.1 side produces to their primary codes; the down-converter maps
// the codes back via its own alias table, so the round-trip is preserved.
const LANGUAGE_NAME_TO_CODE: Record<string, string> = {
  german: "de",
  english: "en",
  french: "fr",
  hebrew: "he"
};

const LEGACY_AGE_KEYWORDS = new Set(["CHILD", "INFANT", "STILLBORN"]);

// The valid value sets for every enumeration live in `src/enums/index.ts` (the
// single source of truth shared with the inverse mapper). This file imports the
// ones it needs (MEDI, NAME-TYPE, ord-STAT, PEDI, RESN, ROLE) at the top.

// URIs chosen so the existing mapExidNode in src/mappings/v7-to-551.ts
// (which dispatches on `/RIN` and `/RFN#` substrings) round-trips them back
// to the original 5.5.1 tag. Keep these endings stable.
const RIN_EXID_TYPE_URI = "https://kleiobase.io/terms/legacy/551/RIN";
const RFN_EXID_TYPE_URI = "https://kleiobase.io/terms/legacy/551/RFN#";
// mapExidNode in v7-to-551.ts recovers AFN from any EXID whose TYPE ends in `/AFN`.
const AFN_EXID_TYPE_URI = "https://kleiobase.io/terms/legacy/551/AFN";

// Inverse of mapMimeToForm in src/mappings/v7-to-551.ts (lines 82-107). Keep
// the two tables symmetric: any 5.5.1 FORM value here should appear as a v7
// MIME on the other side, and the round-trip mapMimeToForm -> mapFormToMime
// must be identity for the keys.
const FORM_TO_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  txt: "text/plain"
};

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

// GEDCOM 5.5 (and tools such as MyHeritage) place FORM and TITL as siblings of
// FILE under OBJE. GEDCOM 7 requires them to be children of FILE (FORM as a MIME
// type). Nest each orphan FORM/TITL under a FILE that lacks one so the normal
// FILE-substructure mapping applies.
function nestObjeFileDetails(children: GedcomNode[]): GedcomNode[] {
  let result = children;

  for (const detailTag of ["FORM", "TITL"]) {
    const details = result.filter((child) => child.tag === detailTag);
    const needyFiles = result.filter(
      (child) => child.tag === "FILE" && !child.children.some((grandchild) => grandchild.tag === detailTag)
    );

    if (details.length === 0 || needyFiles.length === 0) {
      continue;
    }

    const pairCount = Math.min(details.length, needyFiles.length);
    const fileToDetail = new Map<GedcomNode, GedcomNode>();
    const movedDetails = new Set<GedcomNode>();
    for (let index = 0; index < pairCount; index += 1) {
      fileToDetail.set(needyFiles[index]!, details[index]!);
      movedDetails.add(details[index]!);
    }

    const next: GedcomNode[] = [];
    for (const child of result) {
      if (child.tag === detailTag && movedDetails.has(child)) {
        continue;
      }

      const detail = fileToDetail.get(child);
      if (detail) {
        next.push({ ...child, children: [...child.children, cloneAtLevel(detail, child.level + 1)] });
      } else {
        next.push(child);
      }
    }

    result = next;
  }

  return result;
}

function withOptionalLocation(node: GedcomNode): { line?: number; tag: string } {
  return {
    tag: node.tag,
    ...(node.lineNumber !== undefined ? { line: node.lineNumber } : {})
  };
}

function mapNameTypeNode(node: GedcomNode): GedcomNode {
  const resolution = enumOrPhrase(node.value, NAME_TYPE_ENUM, { aliases: NAME_TYPE_ALIASES });

  if (resolution.matched) {
    return makeNode({
      level: node.level,
      tag: "TYPE",
      value: resolution.enum,
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

  // ord-STAT has no OTHER member, so an unmatchable value drops to a bare STAT +
  // PHRASE rather than STAT OTHER. Use the slash-stripping LDS normaliser.
  const resolution = enumOrPhrase(raw, ORD_STAT_ENUM, { normalize: normalizeLdsStatToken });

  if (resolution.matched) {
    return makeNode({
      level: node.level,
      tag: "STAT",
      value: resolution.enum,
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
  // Note: only synthesizes TYPE for IDNO. INDI.EVEN / FAM.EVEN / FACT
  // also require TYPE in v7; those will be handled when a fixture surfaces
  // the case in the round-trip corpus.
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
    if (RESN_ENUM.has(token)) {
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

// The `_SCHMA` HEAD block (and its `_TAG` children) is the carrier for SCHMA data
// across a 5.5.1 hop; it is reconstructed as a real SCHMA, never declared as data.
const SCHEMA_MECHANISM_TAGS = new Set(["_SCHMA", "_TAG"]);

function collectCustomTagsFromNode(node: GedcomNode, tags: Set<string>): void {
  if (node.tag.startsWith("_") && !SCHEMA_MECHANISM_TAGS.has(node.tag)) {
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

/** Recover documented URIs preserved in a 5.5.1 `_SCHMA` HEAD block (from a prior down-conversion). */
function collectPreservedSchemaUris(document: ParsedDocument): Map<string, string> {
  const uris = new Map<string, string>();
  const schemaBlock = document.header.raw.children.find((child) => child.tag === "_SCHMA");

  for (const tagNode of schemaBlock?.children ?? []) {
    if (tagNode.tag !== "_TAG" && tagNode.tag !== "TAG") {
      continue;
    }
    const parsed = splitTagPayload(tagNode.value);
    if (parsed?.uri) {
      uris.set(parsed.tag, parsed.uri);
    }
  }

  return uris;
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

function buildSchemaNode(
  customTags: string[],
  preservedUris: Map<string, string>,
  diagnostics: Diagnostic[]
): GedcomNode | null {
  if (customTags.length === 0) {
    return null;
  }

  // Each documented extension tag needs a URI (§1.5.1). Prefer a URI preserved
  // from a `_SCHMA` round-trip; otherwise synthesise one and flag it for review.
  return makeNode({
    level: 1,
    tag: "SCHMA",
    children: customTags.map((tag) => {
      const preserved = preservedUris.get(tag);
      const uri = preserved ?? syntheticTagUri(tag);
      if (!preserved) {
        diagnostics.push({
          severity: "info",
          code: "SCHMA_TAG_SYNTHESIZED",
          message: `Declared extension tag ${tag} in SCHMA with a synthetic URI (${uri}); supply a documented URI for portability.`,
          location: { tag: "SCHMA" }
        });
      }
      return makeNode({
        level: 2,
        tag: "TAG",
        value: joinTagPayload(tag, uri),
        children: []
      });
    })
  });
}

function mapHeader(document: ParsedDocument, diagnostics: Diagnostic[]): ParsedDocument["header"] {
  let headFileDemoted = false;
  const preservedChildren = document.header.raw.children
    // Keep known header structures plus any `_`-prefixed extension (e.g. an
    // exporter's metadata), so HEAD content is not silently dropped.
    .filter((child) => PRESERVED_HEADER_TAGS.has(child.tag) || child.tag.startsWith("_"))
    .map((child) => {
      // HEAD.LANG: free-text name -> BCP-47 code (GEDCOM 7 requirement).
      if (child.tag === "LANG" && child.value) {
        const code = LANGUAGE_NAME_TO_CODE[child.value.trim().toLowerCase()];
        if (code) {
          return cloneAtLevel({ ...child, value: code }, 1);
        }
      }
      // GEDCOM 7 has no HEAD.FILE; preserve the exporter's filename as a `_FILE`
      // extension (declared in SCHMA) so it round-trips back to HEAD.FILE.
      if (child.tag === "FILE") {
        headFileDemoted = true;
        return cloneAtLevel({ ...child, tag: "_FILE" }, 1);
      }
      return cloneAtLevel(child, 1);
    });
  const customTags = collectCustomTags(document);
  const schemaTags =
    headFileDemoted && !customTags.includes("_FILE") ? [...customTags, "_FILE"].sort() : customTags;
  const schemaNode = buildSchemaNode(schemaTags, collectPreservedSchemaUris(document), diagnostics);

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

function buildRoleNode(node: GedcomNode, sourceValue: string | undefined, diagnostics: Diagnostic[], diagnosticCode: string): GedcomNode {
  // 5.5.1 RELA / source-citation ROLE is free text; resolve it onto the v7 ROLE
  // enum via the text aliases (`Father` → FATH), accepting already-enum tokens too.
  const resolution = sourceValue
    ? enumOrPhrase(sourceValue, ROLE_ENUM, { aliases: ROLE_TEXT_ALIASES, normalize: normalizeRoleToken })
    : undefined;

  if (resolution?.matched) {
    return makeNode({
      level: node.level,
      tag: "ROLE",
      value: resolution.enum,
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

  const resolution = enumOrPhrase(raw, MEDI_ENUM);
  if (resolution.matched) {
    return makeNode({
      level: node.level,
      tag: "MEDI",
      value: resolution.enum,
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

function mapPediNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const raw = node.value?.trim();
  const mappedChildren = node.children.map(cloneNode);

  if (!raw) {
    return makeNode({ level: node.level, tag: "PEDI", children: mappedChildren });
  }

  // 5.5.1 stored pedigree types lowercase (`birth`); v7 wants the upper-cased
  // enum (`BIRTH`). Anything outside the set becomes OTHER + PHRASE.
  const resolution = enumOrPhrase(raw, PEDI_ENUM);
  if (resolution.matched) {
    return makeNode({
      level: node.level,
      tag: "PEDI",
      value: resolution.enum,
      children: mappedChildren
    });
  }

  diagnostics.push({
    severity: "info",
    code: "PEDI_PHRASE_FALLBACK",
    message: `Unable to map GEDCOM 5.5.1 PEDI value ${raw} to a GEDCOM 7 enum; emitted OTHER + PHRASE.`,
    location: withOptionalLocation(node)
  });

  const hasPhrase = mappedChildren.some((child) => child.tag === "PHRASE");
  const children = hasPhrase
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
    tag: "PEDI",
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

// GEDCOM 5.5.1 carried phonetic (FONE) and romanized (ROMN) variations of names
// and places, each with a TYPE naming the method (e.g. `kana`, `pinyin`). GEDCOM 7
// removed both and represents every alternate rendering with TRAN (§ NAME-TRAN /
// PLAC-TRAN), which requires a LANG substructure and has no slot for the method.
// We emit `LANG und` (BCP-47 "undetermined") and preserve any name-piece children;
// the method TYPE has no v7 home and is dropped with a diagnostic.
const UNDETERMINED_LANG = "und";

function mapPhoneticOrRomanizedVariation(
  node: GedcomNode,
  context: MappingContext,
  diagnostics: Diagnostic[]
): GedcomNode {
  const kind = node.tag === "FONE" ? "phonetic" : "romanized";
  const methodChild = node.children.find((child) => child.tag === "TYPE" && child.value);

  diagnostics.push({
    severity: "info",
    code: node.tag === "FONE" ? "FONE_TO_TRAN" : "ROMN_TO_TRAN",
    message: methodChild?.value
      ? `Converted GEDCOM 5.5.1 ${kind} variation (${node.tag} TYPE ${methodChild.value}) to a GEDCOM 7 TRAN; the method is not representable in GEDCOM 7 and was dropped.`
      : `Converted GEDCOM 5.5.1 ${kind} variation (${node.tag}) to a GEDCOM 7 TRAN.`,
    location: withOptionalLocation(node)
  });

  const preservedChildren = node.children
    .filter((child) => child.tag !== "TYPE")
    .map((child) => mapNode(child, extendMappingContext(context, node.tag), diagnostics));

  const hasLang = preservedChildren.some((child) => child.tag === "LANG");

  return makeNode({
    level: node.level,
    tag: "TRAN",
    ...(node.value !== undefined ? { value: node.value } : {}),
    children: hasLang
      ? preservedChildren
      : [
          makeNode({ level: node.level + 1, tag: "LANG", value: UNDETERMINED_LANG, children: [] }),
          ...preservedChildren
        ]
  });
}

function mapAfnNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  diagnostics.push({
    severity: "info",
    code: "AFN_TO_EXID",
    message: `Mapped GEDCOM 5.5.1 AFN ${node.value ?? ""} to GEDCOM 7 EXID with legacy TYPE URI (AFN is not a v7 standard tag).`,
    location: withOptionalLocation(node)
  });
  return makeIdentifierExidNode(node, AFN_EXID_TYPE_URI);
}

function mapFormNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const raw = node.value?.trim();
  const mappedChildren = node.children.map(cloneNode);

  if (!raw) {
    return makeNode({ level: node.level, tag: "FORM", children: mappedChildren });
  }

  // If the value already looks like a MIME type (e.g. caller pre-converted),
  // pass it through untouched.
  if (raw.includes("/")) {
    return makeNode({
      level: node.level,
      tag: "FORM",
      value: raw,
      children: mappedChildren
    });
  }

  const mime = FORM_TO_MIME[raw.toLowerCase()];
  if (mime) {
    diagnostics.push({
      severity: "info",
      code: "FORM_TO_MIME_CONVERTED",
      message: `Converted GEDCOM 5.5.1 multimedia FORM ${raw} to GEDCOM 7 MIME ${mime}.`,
      location: withOptionalLocation(node)
    });
    return makeNode({
      level: node.level,
      tag: "FORM",
      value: mime,
      children: mappedChildren
    });
  }

  diagnostics.push({
    severity: "warning",
    code: "FORM_TO_MIME_UNMAPPED",
    message: `Unable to map GEDCOM 5.5.1 multimedia FORM ${raw} to a GEDCOM 7 MIME type; preserved original value.`,
    location: withOptionalLocation(node)
  });
  return makeNode({
    level: node.level,
    tag: "FORM",
    value: raw,
    children: mappedChildren
  });
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

// Reserved xref prefix marking an OBJE record the converter synthesised from a
// 5.5 embedded (inline) multimedia object. The down-converter recognises this
// prefix to re-inline the media, so a 5.5.1 -> 7.0 -> 5.5.1 round-trip restores
// the original embedded layout. Native records use any other xref and are left
// as records.
const PROMOTED_OBJE_XREF_PREFIX = "_KBOBJE";

function isInlineMediaObject(node: GedcomNode): boolean {
  return (
    node.tag === "OBJE" &&
    node.xref === undefined &&
    (node.value === undefined || node.value === "") &&
    node.children.some((child) => child.tag === "FILE" || child.tag === "_FILE")
  );
}

// GEDCOM 7 has no embedded multimedia: every OBJE must be a record referenced by
// a pointer. Promote each inline OBJE to a top-level record (1:1, no de-dup so the
// transform is exactly reversible) and leave a pointer in its place.
function promoteInlineObjeToRecords(records: ParsedRecord[], diagnostics: Diagnostic[]): ParsedRecord[] {
  const usedXrefs = new Set<string>();
  for (const record of records) {
    if (record.xref) {
      usedXrefs.add(record.xref);
    }
  }

  let counter = 0;
  const nextXref = (): string => {
    let xref: string;
    do {
      counter += 1;
      xref = `@${PROMOTED_OBJE_XREF_PREFIX}${counter}@`;
    } while (usedXrefs.has(xref));
    usedXrefs.add(xref);
    return xref;
  };

  const promotedRecords: ParsedRecord[] = [];

  const transformChildren = (children: GedcomNode[]): GedcomNode[] => {
    const result: GedcomNode[] = [];
    for (const child of children) {
      const rewritten: GedcomNode = { ...child, children: transformChildren(child.children) };
      if (isInlineMediaObject(rewritten)) {
        const xref = nextXref();
        promotedRecords.push({
          tag: "OBJE",
          xref,
          children: rewritten.children.map((grandchild) => cloneAtLevel(grandchild, 1))
        });
        result.push({ level: child.level, tag: "OBJE", value: xref, children: [] });
      } else {
        result.push(rewritten);
      }
    }
    return result;
  };

  const rewritten = records.map((record) => ({
    ...record,
    children: transformChildren(record.children)
  }));

  if (promotedRecords.length > 0) {
    diagnostics.push({
      severity: "info",
      code: "INLINE_OBJE_PROMOTED",
      message: `Promoted ${promotedRecords.length} embedded multimedia object(s) to GEDCOM 7 OBJE record(s).`,
      location: { tag: "OBJE" }
    });
  }

  return [...rewritten, ...promotedRecords];
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

  if (node.tag === "PEDI") {
    return mapPediNode(node, diagnostics);
  }

  if (node.tag === "RIN") {
    return mapRinNode(node, diagnostics);
  }

  if (node.tag === "RFN") {
    return mapRfnNode(node, diagnostics);
  }

  if (node.tag === "AFN") {
    return mapAfnNode(node, diagnostics);
  }

  // GEDCOM 5.5.1 has no standard UID, so applications stored UUIDs in the `_UID`
  // extension. GEDCOM 7 added a standard UID (§5 g7:UID); promote it so the value
  // becomes first-class data rather than an undeclared SCHMA extension.
  if (node.tag === "_UID") {
    diagnostics.push({
      severity: "info",
      code: "UID_PROMOTED",
      message: `Promoted GEDCOM 5.5.1 _UID ${node.value ?? ""} to the standard GEDCOM 7 UID tag.`,
      location: withOptionalLocation(node)
    });
    return makeNode({
      level: node.level,
      tag: "UID",
      ...(node.value !== undefined ? { value: node.value } : {}),
      children: node.children.map(cloneNode)
    });
  }

  // FONE/ROMN exist under both NAME and PLAC in 5.5.1 but were removed in v7.
  if ((node.tag === "FONE" || node.tag === "ROMN") && (context.parentTag === "NAME" || context.parentTag === "PLAC")) {
    return mapPhoneticOrRomanizedVariation(node, context, diagnostics);
  }

  // FORM is overloaded across the 5.5.1 spec — only translate to MIME when it
  // describes a multimedia FILE format. HEAD.GEDC.FORM and PLAC.FORM use the
  // same tag for different semantics and must pass through verbatim.
  if (node.tag === "FORM" && context.parentTag === "FILE") {
    return mapFormNode(node, diagnostics);
  }

  if (node.tag === "DATE") {
    return mapGedcom551DateNodeToV7(node, diagnostics);
  }

  if (node.tag === "OBJE") {
    return makeNode({
      level: node.level,
      tag: "OBJE",
      children: nestObjeFileDetails(node.children).map((child) =>
        mapNode(child, extendMappingContext(context, "OBJE"), diagnostics)
      ),
      ...(node.value !== undefined ? { value: node.value } : {}),
      ...(node.xref !== undefined ? { xref: node.xref } : {})
    });
  }

  return makeNode({
    level: node.level,
    tag: node.tag,
    children: node.children.map((child) => mapNode(child, extendMappingContext(context, node.tag), diagnostics)),
    ...(node.value !== undefined ? { value: node.value } : {}),
    ...(node.xref !== undefined ? { xref: node.xref } : {})
  });
}

function mapRecord(record: ParsedRecord, diagnostics: Diagnostic[]): ParsedRecord | null {
  if (record.tag === "SUBN") {
    diagnostics.push({
      severity: "info",
      code: "SUBN_DROPPED",
      message: `Dropped GEDCOM 5.5 SUBN record ${record.xref ?? "<no xref>"} because GEDCOM 7 has no submission record equivalent.`,
      location: { tag: "SUBN", ...(record.xref !== undefined ? { recordId: record.xref } : {}) }
    });
    return null;
  }

  const recordChildren = record.tag === "OBJE" ? nestObjeFileDetails(record.children) : record.children;

  return {
    tag: record.tag,
    children: recordChildren.map((child) => mapNode(child, {}, diagnostics)),
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

  const mappedRecords = pointerRewrittenRecords
    .map((record) => mapRecord(record, diagnostics))
    .filter((record): record is ParsedRecord => record !== null);

  // GEDCOM 7 requires multimedia to be records referenced by pointers; lift any
  // 5.5 embedded OBJE out to a top-level record before building the schema.
  const promotedRecords = promoteInlineObjeToRecords(mappedRecords, diagnostics);

  // SCHMA must declare every custom tag in the *mapped* document, not the source,
  // because the mapper itself may introduce new extensions (e.g. _RESN fallback).
  const header = mapHeader({ ...document, records: promotedRecords }, diagnostics);

  return {
    version: "7.0.18",
    header,
    records: promotedRecords,
    extensions: document.extensions.map(cloneNode),
    diagnostics
  };
}
