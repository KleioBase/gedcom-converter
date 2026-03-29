import type { Diagnostic, GedcomNode, ParsedDocument, ParsedRecord } from "../types.js";

interface CompatibilityContext {
  rootTag: string;
  parentTag?: string;
}

const EVENT_TAGS = new Set([
  "ADOP",
  "ANUL",
  "BAPM",
  "BARM",
  "BASM",
  "BIRT",
  "BLES",
  "BURI",
  "CENS",
  "CHRA",
  "CONF",
  "CREM",
  "DEAT",
  "DIV",
  "DIVF",
  "EMIG",
  "ENGA",
  "EVEN",
  "FACT",
  "FCOM",
  "GRAD",
  "IMMI",
  "MARB",
  "MARC",
  "MARL",
  "MARR",
  "MARS",
  "NATU",
  "ORDN",
  "PROB",
  "RESI",
  "RETI",
  "SLGS",
  "WILL"
]);

const POINTER_TAGS = new Set([
  "ANCI",
  "ALIA",
  "ASSO",
  "CHIL",
  "DESI",
  "FAMC",
  "FAMS",
  "HUSB",
  "NOTE",
  "OBJE",
  "REPO",
  "SOUR",
  "SUBM",
  "WIFE"
]);

const ALWAYS_DEMOTE_TAGS = new Set(["CREA", "CROP", "INIL", "MAP", "SDATE", "TRAN", "UID"]);
const ALWAYS_PHRASE_TAGS = new Set(["PHRASE"]);
const NOTE_LIKE_PARENT_TAGS = new Set(["NOTE", "PLAC", "TEXT"]);
const VALID_RESN_VALUES = new Set(["CONFIDENTIAL", "LOCKED", "PRIVACY"]);
const INVALID_STAT_VALUES = new Set(["DNS_CAN", "INFANT", "PRE_1970"]);
const FILE_FORM_ALIASES: Record<string, string> = {
  bmp: "bmp",
  gif: "gif",
  jpeg: "jpg",
  jpg: "jpg",
  tif: "tif",
  tiff: "tif",
  wav: "wav"
};
const SOURCE_MEDIA_TYPE_ALIASES: Record<string, string> = {
  audio: "AUDIO",
  book: "BOOK",
  card: "CARD",
  electronic: "ELECTRONIC",
  fiche: "FICHE",
  film: "FILM",
  magazine: "MAGAZINE",
  manuscript: "MANUSCRIPT",
  map: "MAP",
  newspaper: "NEWSPAPER",
  other: "ELECTRONIC",
  photo: "PHOTO",
  tombstone: "TOMBSTONE",
  video: "VIDEO"
};
const LANGUAGE_ALIASES: Record<string, string> = {
  de: "German",
  deu: "German",
  en: "English",
  eng: "English",
  fr: "French",
  fra: "French",
  he: "Hebrew",
  heb: "Hebrew",
  iw: "Hebrew"
};

function cloneNode(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.map(cloneNode)
  };
}

function withOptionalLocation(node: GedcomNode): { line?: number; tag: string } {
  return {
    tag: node.tag,
    ...(node.lineNumber !== undefined ? { line: node.lineNumber } : {})
  };
}

function pushWarning(diagnostics: Diagnostic[], code: string, message: string, node: GedcomNode): void {
  diagnostics.push({
    severity: "warning",
    code,
    message,
    location: withOptionalLocation(node)
  });
}

function demoteTag(node: GedcomNode, tag = `_${node.tag}`): GedcomNode {
  return {
    ...node,
    tag
  };
}

function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (LANGUAGE_ALIASES[normalized]) {
    return LANGUAGE_ALIASES[normalized];
  }

  const baseLanguage = normalized.split(/[-_]/)[0];
  return baseLanguage ? LANGUAGE_ALIASES[baseLanguage] ?? baseLanguage : value;
}

function hasTypeChild(node: GedcomNode): boolean {
  return node.children.some((child) => child.tag === "TYPE");
}

function removeChildByTagAndValue(node: GedcomNode, tag: string, value: string | undefined): GedcomNode {
  let removed = false;

  return {
    ...node,
    children: node.children.filter((child) => {
      if (!removed && child.tag === tag && child.value === value) {
        removed = true;
        return false;
      }

      return true;
    })
  };
}

function addValueAsTypeOrExtension(node: GedcomNode): GedcomNode {
  if (!node.value) {
    return node;
  }

  const children = [...node.children];

  if (!hasTypeChild(node)) {
    children.unshift({
      level: node.level + 1,
      tag: "TYPE",
      value: node.value,
      children: []
    });
  } else {
    children.unshift({
      level: node.level + 1,
      tag: "_VALUE",
      value: node.value,
      children: []
    });
  }

  const { value: _value, ...nodeWithoutValue } = node;

  return {
    ...nodeWithoutValue,
    children
  };
}

function hasAtPrefixedContinuation(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return value.split("\n").slice(1).some((line) => line.startsWith("@"));
}

function sanitizeNode(
  node: GedcomNode,
  context: CompatibilityContext,
  existingXrefs: Set<string>,
  diagnostics: Diagnostic[]
): GedcomNode | null {
  let nextNode: GedcomNode = {
    ...node,
    children: node.children
      .map((child) =>
        sanitizeNode(
          child,
          {
            rootTag: context.rootTag,
            parentTag: node.tag
          },
          existingXrefs,
          diagnostics
        )
      )
      .filter((child): child is GedcomNode => child !== null)
  };

  if (POINTER_TAGS.has(nextNode.tag) && nextNode.value && nextNode.value.startsWith("@") && nextNode.value.endsWith("@")) {
    if (!existingXrefs.has(nextNode.value)) {
      pushWarning(
        diagnostics,
        "DROPPED_MISSING_POINTER",
        `Dropped ${nextNode.tag} reference ${nextNode.value} because the target record does not exist in the converted GEDCOM.`,
        nextNode
      );
      return null;
    }
  }

  if (ALWAYS_PHRASE_TAGS.has(nextNode.tag)) {
    return demoteTag(nextNode);
  }

  if (ALWAYS_DEMOTE_TAGS.has(nextNode.tag)) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "FACT") {
    nextNode = {
      ...nextNode,
      tag: "EVEN"
    };
  }

  if (nextNode.tag === "EVEN" && nextNode.value && context.rootTag !== "SOUR" && context.parentTag !== "SOUR") {
    nextNode = addValueAsTypeOrExtension(nextNode);
  }

  if (nextNode.tag === "EVEN" && !nextNode.value) {
    const valueChildTags =
      context.parentTag === "DATA"
        ? ["TYPE", "_VALUE"]
        : context.rootTag === "FAM"
          ? ["_VALUE", "TYPE"]
          : [];
    const valueChild = valueChildTags
      .map((tag) => nextNode.children.find((child) => child.tag === tag && child.value))
      .find((child) => child !== undefined);

    if (valueChild?.value) {
      nextNode = {
        ...removeChildByTagAndValue(nextNode, valueChild.tag, valueChild.value),
        value: valueChild.value
      };
    }
  }

  if (nextNode.tag === "RESI" && nextNode.value) {
    nextNode = addValueAsTypeOrExtension(nextNode);
  }

  if (nextNode.tag === "RESN" && nextNode.value) {
    const preferredValue = nextNode.value
      .split(",")
      .map((token) => token.trim().toUpperCase())
      .find((token) => VALID_RESN_VALUES.has(token));

    if (preferredValue && preferredValue !== nextNode.value) {
      pushWarning(
        diagnostics,
        "RESN_REDUCED",
        `Reduced RESN value ${nextNode.value} to ${preferredValue} for GEDCOM 5.5.1 compatibility.`,
        nextNode
      );
      nextNode = {
        ...nextNode,
        value: preferredValue
      };
    }
  }

  if (nextNode.tag === "SEX" && nextNode.value === "X") {
    nextNode = {
      ...nextNode,
      value: "U"
    };
  }

  if (nextNode.tag === "PEDI" && nextNode.value?.toUpperCase() === "OTHER") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "STAT" && nextNode.value && INVALID_STAT_VALUES.has(nextNode.value.toUpperCase())) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "SSN" && nextNode.value && nextNode.value.replace(/\D/g, "").length < 9) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "LANG" && nextNode.value) {
    const normalizedLanguage = normalizeLanguage(nextNode.value);

    nextNode = normalizedLanguage
      ? {
          ...nextNode,
          value: normalizedLanguage
        }
      : {
          ...nextNode
        };
  }

  if (nextNode.tag === "FILE") {
    if ((nextNode.value?.length ?? 0) > 30) {
      pushWarning(
        diagnostics,
        "FILE_REFERENCE_DEGRADED",
        "Demoted FILE to _FILE because the multimedia reference exceeds GEDCOM 5.5.1 length limits.",
        nextNode
      );
      return demoteTag(nextNode, "_FILE");
    }

    if (!nextNode.children.some((child) => child.tag === "FORM")) {
      return demoteTag(nextNode, "_FILE");
    }
  }

  if (nextNode.tag === "FORM" && context.parentTag === "FILE") {
    const normalizedForm = nextNode.value ? FILE_FORM_ALIASES[nextNode.value.toLowerCase()] : undefined;

    if (!normalizedForm) {
      return demoteTag(nextNode);
    }

    nextNode = {
      ...nextNode,
      value: normalizedForm
    };
  }

  if (nextNode.tag === "TYPE" && context.parentTag === "FORM" && nextNode.value) {
    const normalizedMediaType = SOURCE_MEDIA_TYPE_ALIASES[nextNode.value.toLowerCase()];

    if (!normalizedMediaType) {
      return demoteTag(nextNode);
    }

    nextNode = {
      ...nextNode,
      value: normalizedMediaType
    };
  }

  if (
    (NOTE_LIKE_PARENT_TAGS.has(context.parentTag ?? "") || context.rootTag === "NOTE") &&
    (nextNode.tag === "FORM" || nextNode.tag === "LANG")
  ) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "TIME" && context.parentTag === "DATE") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "NO") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "NOTE" && hasAtPrefixedContinuation(nextNode.value)) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "SLGC" && !nextNode.children.some((child) => child.tag === "FAMC")) {
    return demoteTag(nextNode);
  }

  if (context.parentTag === "NCHI" && ["HUSB", "TYPE", "WIFE"].includes(nextNode.tag)) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "ASSO" && (context.rootTag === "FAM" || EVENT_TAGS.has(context.parentTag ?? ""))) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "SOUR" && context.rootTag === "SOUR") {
    return demoteTag(nextNode);
  }

  if (
    nextNode.tag === "PAGE" &&
    context.parentTag === "SOUR" &&
    (context.rootTag === "SOUR" || context.rootTag === "NOTE" || context.rootTag === "OBJE" || context.rootTag === "SUBM")
  ) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "DATA" && context.parentTag === "SOUR" && context.rootTag === "SOUR") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "EVEN" && context.rootTag === "SOUR" && context.parentTag === "SOUR") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "RELA" && (context.parentTag === "EVEN" || ["NOTE", "OBJE", "SOUR", "SUBM"].includes(context.rootTag))) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "NOTE" && context.parentTag === "PLAC") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "REFN" && context.rootTag === "SUBM") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "RESN" && (context.parentTag === "OBJE" || context.rootTag === "OBJE")) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "TITL" && ["FILE", "OBJE"].includes(context.parentTag ?? "")) {
    return demoteTag(nextNode);
  }

  return nextNode;
}

function sanitizeRecord(record: ParsedRecord, existingXrefs: Set<string>, diagnostics: Diagnostic[]): ParsedRecord {
  return {
    ...record,
    children: record.children
      .map((child) => sanitizeNode(child, { rootTag: record.tag }, existingXrefs, diagnostics))
      .filter((child): child is GedcomNode => child !== null)
  };
}

export function sanitizeGedcom551Document(document: ParsedDocument): ParsedDocument {
  const diagnostics = [...document.diagnostics];
  const existingXrefs = new Set(
    document.records.flatMap((record) => (record.xref ? [record.xref] : []))
  );

  return {
    ...document,
    records: document.records.map((record) => sanitizeRecord(record, existingXrefs, diagnostics)),
    extensions: document.extensions.map(cloneNode),
    diagnostics
  };
}
