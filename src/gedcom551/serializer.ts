import type { GedcomNode, ParsedDocument } from "../types.js";
import { stringifyGedcomTree } from "../utils/lines.js";
import { GEDCOM551_CHARSET, GEDCOM551_FORM, GEDCOM551_VERSION } from "./schema.js";

const DEFAULT_SUBMITTER_XREF = "@SUBM1@";
const DEFAULT_PRODUCT_VERSION = "0.1.0";
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

function toRootNode(record: ParsedDocument["records"][number]): GedcomNode {
  return {
    level: 0,
    tag: record.tag,
    children: record.children,
    ...(record.xref !== undefined ? { xref: record.xref } : {}),
    ...(record.value !== undefined ? { value: record.value } : {})
  };
}

function resetRootLevel(node: GedcomNode): GedcomNode {
  return {
    ...node,
    level: 0
  };
}

function getSubmitterXref(document: ParsedDocument): string {
  const headerSubmitter = document.header.raw.children.find(
    (child) => child.tag === "SUBM" && child.value?.startsWith("@") && child.value.endsWith("@")
  )?.value;

  if (headerSubmitter) {
    return headerSubmitter;
  }

  const recordSubmitter = document.records.find((record) => record.tag === "SUBM" && record.xref)?.xref;
  return recordSubmitter ?? DEFAULT_SUBMITTER_XREF;
}

function buildHeadPlaceNode(document: ParsedDocument): GedcomNode | null {
  const headPlaceNode = document.header.raw.children.find((child) => child.tag === "PLAC");
  const placeForm = headPlaceNode?.children.find((child) => child.tag === "FORM")?.value;

  if (!placeForm) {
    return null;
  }

  return {
    level: 1,
    tag: "PLAC",
    children: [
      {
        level: 2,
        tag: "FORM",
        value: placeForm,
        children: []
      }
    ]
  };
}

function buildHead(document: ParsedDocument): GedcomNode {
  const headLanguage = normalizeLanguage(document.header.raw.children.find((child) => child.tag === "LANG")?.value);
  const headPlaceNode = buildHeadPlaceNode(document);
  const submitterXref = getSubmitterXref(document);

  return {
    level: 0,
    tag: "HEAD",
    children: [
      {
        level: 1,
        tag: "SOUR",
        value: document.header.sourceSystem ?? "KleioBase",
        children: [
          {
            level: 2,
            tag: "VERS",
            value: DEFAULT_PRODUCT_VERSION,
            children: []
          },
          {
            level: 2,
            tag: "NAME",
            value: document.header.sourceSystem ?? "KleioBase",
            children: []
          }
        ]
      },
      {
        level: 1,
        tag: "GEDC",
        children: [
          {
            level: 2,
            tag: "VERS",
            value: GEDCOM551_VERSION,
            children: []
          },
          {
            level: 2,
            tag: "FORM",
            value: GEDCOM551_FORM,
            children: []
          }
        ]
      },
      {
        level: 1,
        tag: "SUBM",
        value: submitterXref,
        children: []
      },
      {
        level: 1,
        tag: "CHAR",
        value: GEDCOM551_CHARSET,
        children: []
      },
      ...(headPlaceNode ? [headPlaceNode] : []),
      ...(headLanguage
        ? [
            {
              level: 1,
              tag: "LANG",
              value: headLanguage,
              children: []
            }
          ]
        : [])
    ]
  };
}

function buildSubmitterRecord(document: ParsedDocument): GedcomNode {
  return {
    level: 0,
    xref: getSubmitterXref(document),
    tag: "SUBM",
    children: [
      {
        level: 1,
        tag: "NAME",
        value: document.header.sourceSystem ?? "KleioBase",
        children: []
      }
    ]
  };
}

export function stringifyGedcom551(document: ParsedDocument): string {
  const submitterXref = getSubmitterXref(document);
  const hasSubmitterRecord = document.records.some((record) => record.tag === "SUBM" && record.xref === submitterXref);
  const nodes: GedcomNode[] = [
    buildHead(document),
    ...document.records.map((record) => toRootNode(record)),
    ...document.extensions.map((node) => resetRootLevel(node)),
    ...(hasSubmitterRecord ? [] : [buildSubmitterRecord(document)]),
    {
      level: 0,
      tag: "TRLR",
      children: []
    }
  ];

  return stringifyGedcomTree(nodes, { mode: "gedcom551" });
}
