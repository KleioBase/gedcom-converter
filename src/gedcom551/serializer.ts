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

function appendMetadataLine(value: string | undefined, label: string, metadata: string): string {
  const suffix = `[${label}: ${metadata}]`;
  return value ? `${value}\n${suffix}` : suffix;
}

function appendTranslationLine(value: string | undefined, translation: string): string {
  return value ? `${value}\n[Translation] ${translation}` : `[Translation] ${translation}`;
}

function appendSourceCitationLine(
  value: string | undefined,
  pointer: string | undefined,
  page: string | undefined
): string {
  const pieces = [`Source citation${pointer ? ` ${pointer}` : ""}`];
  if (page) {
    pieces.push(`Page ${page}`);
  }

  const line = `[${pieces.join(", ")}]`;
  return value ? `${value}\n${line}` : line;
}

function normalizeGedcom551TimeValue(value: string | undefined): { normalized?: string; noted?: string } {
  if (!value) {
    return {};
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) {
    return {
      normalized: trimmed
    };
  }

  const [, baseTime, zone] = match;
  if (zone) {
    return {
      ...(baseTime ? { normalized: baseTime } : {}),
      noted: `Transmission time zone: ${zone}`
    };
  }

  return baseTime ? { normalized: baseTime } : {};
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

function buildHeadSourceNode(document: ParsedDocument): { node: GedcomNode; headerNoteLines: string[] } {
  const rawSourceNode = document.header.raw.children.find((child) => child.tag === "SOUR");
  const headerNoteLines: string[] = [];

  if (!rawSourceNode) {
    return {
      node: {
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
      headerNoteLines
    };
  }

  const children: GedcomNode[] = [];

  for (const child of rawSourceNode.children) {
    if (child.tag === "VERS" || child.tag === "NAME" || child.tag === "CORP") {
      children.push(cloneAtLevel(child, 2));
      continue;
    }

    if (child.tag !== "DATA") {
      continue;
    }

    const dataChildren: GedcomNode[] = [];

    for (const grandchild of child.children) {
      if (grandchild.tag === "DATE") {
        dataChildren.push({
          ...cloneAtLevel(grandchild, 3),
          children: []
        });

        const timeChild = grandchild.children.find((greatGrandchild) => greatGrandchild.tag === "TIME" && greatGrandchild.value);
        if (timeChild?.value) {
          headerNoteLines.push(`Source data time: ${timeChild.value}`);
        }
        continue;
      }

      if (grandchild.tag === "COPR") {
        dataChildren.push(cloneAtLevel(grandchild, 3));
      }
    }

    if (dataChildren.length > 0) {
      children.push({
        level: 2,
        tag: "DATA",
        ...(child.value !== undefined ? { value: child.value } : {}),
        children: dataChildren
      });
    }
  }

  return {
    node: {
      level: 1,
      tag: "SOUR",
      value: rawSourceNode.value ?? document.header.sourceSystem ?? "KleioBase",
      children
    },
    headerNoteLines
  };
}

function buildHeaderDescriptionNode(document: ParsedDocument, extraLines: string[]): GedcomNode | null {
  const rawHeaderNote = document.header.raw.children.find((child) => child.tag === "NOTE");
  const schemaNode = document.header.raw.children.find((child) => child.tag === "SCHMA");
  let value = rawHeaderNote?.value;

  const noteLanguage = rawHeaderNote?.children.find((child) => child.tag === "LANG" && child.value)?.value;
  if (noteLanguage) {
    value = appendMetadataLine(value, "Language", normalizeLanguage(noteLanguage) ?? noteLanguage);
  }

  const translations = rawHeaderNote?.children.filter((child) => child.tag === "TRAN" && child.value) ?? [];
  for (const translation of translations) {
    value = appendTranslationLine(value, translation.value!);
    const translationLanguage = translation.children.find((child) => child.tag === "LANG" && child.value)?.value;
    if (translationLanguage) {
      value = appendMetadataLine(value, "Language", normalizeLanguage(translationLanguage) ?? translationLanguage);
    }
  }

  const sourceCitations = rawHeaderNote?.children.filter((child) => child.tag === "SOUR" && child.value) ?? [];
  for (const sourceCitation of sourceCitations) {
    const pageChild = sourceCitation.children.find((child) => child.tag === "PAGE" && child.value);
    value = appendSourceCitationLine(value, sourceCitation.value, pageChild?.value);
  }

  for (const line of extraLines) {
    value = value ? `${value}\n${line}` : line;
  }

  for (const tagNode of schemaNode?.children.filter((child) => child.tag === "TAG" && child.value) ?? []) {
    value = value ? `${value}\nSchema tag: ${tagNode.value}` : `Schema tag: ${tagNode.value}`;
  }

  if (!value) {
    return null;
  }

  return {
    level: 1,
    tag: "NOTE",
    value,
    children: []
  };
}

function buildHead(document: ParsedDocument): GedcomNode {
  const headLanguage = normalizeLanguage(document.header.raw.children.find((child) => child.tag === "LANG")?.value);
  const headPlaceNode = buildHeadPlaceNode(document);
  const submitterXref = getSubmitterXref(document);
  const rawHeaderDest = document.header.raw.children.find((child) => child.tag === "DEST");
  const rawHeaderDate = document.header.raw.children.find((child) => child.tag === "DATE");
  const rawHeaderSubn = document.header.raw.children.find((child) => child.tag === "SUBN");
  const rawHeaderFile = document.header.raw.children.find((child) => child.tag === "FILE");
  const rawHeaderCopr = document.header.raw.children.find((child) => child.tag === "COPR");
  const { node: headSourceNode, headerNoteLines } = buildHeadSourceNode(document);
  const normalizedHeaderTime = normalizeGedcom551TimeValue(
    rawHeaderDate?.children.find((child) => child.tag === "TIME")?.value
  );
  if (normalizedHeaderTime.noted) {
    headerNoteLines.push(normalizedHeaderTime.noted);
  }
  const headerDescriptionNode = buildHeaderDescriptionNode(document, headerNoteLines);

  return {
    level: 0,
    tag: "HEAD",
    children: [
      headSourceNode,
      ...(rawHeaderDest?.value
        ? [
            {
              level: 1,
              tag: "DEST",
              value: rawHeaderDest.value,
              children: []
            }
          ]
        : []),
      ...(rawHeaderDate
        ? [
            {
              level: 1,
              tag: "DATE",
              ...(rawHeaderDate.value !== undefined ? { value: rawHeaderDate.value } : {}),
              children: rawHeaderDate.children
                .filter((child) => child.tag === "TIME")
                .map((child) => ({
                  ...cloneAtLevel(child, 2),
                  ...(normalizeGedcom551TimeValue(child.value).normalized !== undefined
                    ? { value: normalizeGedcom551TimeValue(child.value).normalized }
                    : {})
                }))
            }
          ]
        : []),
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
      ...(rawHeaderSubn?.value
        ? [
            {
              level: 1,
              tag: "SUBN",
              value: rawHeaderSubn.value,
              children: []
            }
          ]
        : []),
      ...(rawHeaderFile?.value
        ? [
            {
              level: 1,
              tag: "FILE",
              value: rawHeaderFile.value,
              children: []
            }
          ]
        : []),
      ...(rawHeaderCopr?.value
        ? [
            {
              level: 1,
              tag: "COPR",
              value: rawHeaderCopr.value,
              children: []
            }
          ]
        : []),
      {
        level: 1,
        tag: "CHAR",
        value: GEDCOM551_CHARSET,
        children: []
      },
      ...(headLanguage
        ? [
            {
              level: 1,
              tag: "LANG",
              value: headLanguage,
              children: []
            }
          ]
        : []),
      ...(headPlaceNode ? [headPlaceNode] : []),
      ...(headerDescriptionNode ? [headerDescriptionNode] : [])
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
