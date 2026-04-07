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
  "CHR",
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

const ALWAYS_DEMOTE_TAGS = new Set(["CROP", "MAP", "TRAN"]);
const ALWAYS_PHRASE_TAGS = new Set(["PHRASE"]);
const NOTE_LIKE_PARENT_TAGS = new Set(["NOTE", "TEXT"]);
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
const ROLE_TEXT_ALIASES: Record<string, string> = {
  CHIL: "Child",
  CLERGY: "Clergy",
  FATH: "Father",
  FRIEND: "Friend",
  GODP: "Godparent",
  HUSB: "Husband",
  MOTH: "Mother",
  MULTIPLE: "Multiple",
  NGHBR: "Neighbor",
  OFFICIATOR: "Officiator",
  PARENT: "Parent",
  SPOU: "Spouse",
  WIFE: "Wife",
  WITN: "Witness"
};
const REFN_UNSUPPORTED_ROOT_TAGS = new Set(["SUBM"]);
const GEDCOM551_REFN_MAX_LENGTH = 20;

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

function pushInfo(diagnostics: Diagnostic[], code: string, message: string, node: GedcomNode): void {
  diagnostics.push({
    severity: "info",
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

function normalizeRoleText(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  return ROLE_TEXT_ALIASES[value] ?? value;
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

function canUseRefn(rootTag: string, parentTag: string | undefined, value: string | undefined): boolean {
  if (parentTag !== undefined) {
    return false;
  }

  if (REFN_UNSUPPORTED_ROOT_TAGS.has(rootTag)) {
    return false;
  }

  if (!value || value.length > GEDCOM551_REFN_MAX_LENGTH) {
    return false;
  }

  return true;
}

function convertIdentifierNodeToRefn(node: GedcomNode, typeValue: string | undefined): GedcomNode {
  const children = typeValue
    ? [
        {
          level: node.level + 1,
          tag: "TYPE",
          value: typeValue,
          children: []
        }
      ]
    : [];

  return {
    ...node,
    tag: "REFN",
    children
  };
}

function hasAtPrefixedContinuation(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return value.split("\n").slice(1).some((line) => line.startsWith("@"));
}

function rewriteAtPrefixedContinuationLines(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  const [firstLine, ...rest] = value.split("\n");
  if (rest.length === 0) {
    return value;
  }

  return [firstLine, ...rest.map((line) => (line.startsWith("@") ? `Text: ${line}` : line))].join("\n");
}

function removeChildrenByTag(node: GedcomNode, tag: string): GedcomNode {
  return {
    ...node,
    children: node.children.filter((child) => child.tag !== tag)
  };
}

function removeTranslationChildren(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.filter((child) => child.tag !== "TRAN" && child.tag !== "_TRAN")
  };
}

function findPhraseChild(node: GedcomNode): GedcomNode | undefined {
  return node.children.find((child) => (child.tag === "PHRASE" || child.tag === "_PHRASE") && child.value);
}

function removePhraseChildren(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.filter((child) => child.tag !== "PHRASE" && child.tag !== "_PHRASE")
  };
}

function makeNoteNode(level: number, value: string): GedcomNode {
  return {
    level,
    tag: "NOTE",
    value,
    children: []
  };
}

function findLanguageChild(node: GedcomNode): GedcomNode | undefined {
  return node.children.find((child) => (child.tag === "LANG" || child.tag === "_LANG") && child.value);
}

function removeLanguageChildren(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.filter((child) => child.tag !== "LANG" && child.tag !== "_LANG")
  };
}

function findFormatChild(node: GedcomNode): GedcomNode | undefined {
  return node.children.find((child) => (child.tag === "FORM" || child.tag === "_FORM") && child.value);
}

function removeFormatChildren(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.filter((child) => child.tag !== "FORM" && child.tag !== "_FORM")
  };
}

function findTimeChild(node: GedcomNode): GedcomNode | undefined {
  return node.children.find((child) => (child.tag === "TIME" || child.tag === "_TIME") && child.value);
}

function removeTimeChildren(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.filter((child) => child.tag !== "TIME" && child.tag !== "_TIME")
  };
}

function rewriteDateChildWithoutTime(
  node: GedcomNode,
  noteLevel: number,
  diagnostics: Diagnostic[],
  code: string,
  message: (timeValue: string) => string,
  noteValue: (timeValue: string) => string
): { node: GedcomNode; notes: GedcomNode[] } {
  const timeChild = findTimeChild(node);

  if (!timeChild?.value) {
    return {
      node,
      notes: []
    };
  }

  pushInfo(diagnostics, code, message(timeChild.value), timeChild);

  return {
    node: removeTimeChildren(node),
    notes: [makeNoteNode(noteLevel, noteValue(timeChild.value))]
  };
}

function appendMetadataLine(value: string | undefined, label: string, metadata: string): string {
  const suffix = `[${label}: ${metadata}]`;
  return value ? `${value}\n${suffix}` : suffix;
}

function appendTranslationLine(value: string | undefined, translation: string): string {
  return value ? `${value}\n[Translation] ${translation}` : `[Translation] ${translation}`;
}

function prependLabeledValue(label: string, value: string): string {
  return `${label}: ${value}`;
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

function getPrimaryTextLine(value: string | undefined): string {
  return normalizeWhitespace(value?.split("\n", 1)[0]);
}

function formatCropNote(node: GedcomNode): string | undefined {
  const entries = node.children
    .filter((child) => child.value)
    .map((child) => `${child.tag.toLowerCase()} ${child.value}`);

  if (entries.length === 0) {
    return undefined;
  }

  return `Crop: ${entries.join(", ")}`;
}

function formatMapNote(node: GedcomNode): string | undefined {
  const lati = node.children.find((child) => child.tag === "LATI" && child.value)?.value;
  const long = node.children.find((child) => child.tag === "LONG" && child.value)?.value;

  if (!lati && !long) {
    return undefined;
  }

  if (lati && long) {
    return `Place coordinates: ${lati}, ${long}`;
  }

  return lati ? `Place latitude: ${lati}` : `Place longitude: ${long}`;
}

function hoistObjectLinkNotes(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const hoistedNotes: GedcomNode[] = [];
  const rewrittenChildren = node.children.map((child) => {
    if (child.tag !== "OBJE" || !child.value?.startsWith("@")) {
      return child;
    }

    const noteChildren = child.children.filter((grandchild) => grandchild.tag === "NOTE" && grandchild.value);
    if (noteChildren.length === 0) {
      return child;
    }

    for (const noteChild of noteChildren) {
      pushInfo(
        diagnostics,
        "OBJECT_LINK_NOTE_HOISTED",
        `Moved OBJE link note ${noteChild.value} to the parent structure for GEDCOM 5.5.1 compatibility.`,
        noteChild
      );
      hoistedNotes.push(makeNoteNode(node.level + 1, noteChild.value!));
    }

    return {
      ...child,
      children: child.children.filter((grandchild) => grandchild.tag !== "NOTE")
    };
  });

  return hoistedNotes.length > 0
    ? {
        ...node,
        children: [...rewrittenChildren, ...hoistedNotes]
      }
    : node;
}

function rewriteValueChildrenAsNotes(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  if (!["EVEN", "RESI"].includes(node.tag)) {
    return node;
  }

  const valueChildren = node.children.filter((child) => child.tag === "_VALUE" && child.value);
  if (valueChildren.length === 0) {
    return node;
  }

  const label = node.tag === "RESI" ? "Residence value" : "Event value";

  for (const valueChild of valueChildren) {
    pushInfo(
      diagnostics,
      "VALUE_NOTED",
      `Preserved ${node.tag} value ${valueChild.value} as note text for GEDCOM 5.5.1 compatibility.`,
      valueChild
    );
  }

  return {
    ...node,
    children: [
      ...node.children.filter((child) => child.tag !== "_VALUE"),
      ...valueChildren.map((valueChild) => makeNoteNode(node.level + 1, prependLabeledValue(label, valueChild.value!)))
    ]
  };
}

function hoistPointerPhraseNotes(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const hoistedNotes: GedcomNode[] = [];
  const rewrittenChildren = node.children.map((child) => {
    if (!["HUSB", "WIFE", "CHIL"].includes(child.tag)) {
      return child;
    }

    const phraseChild = child.children.find((grandchild) => (grandchild.tag === "_PHRASE" || grandchild.tag === "PHRASE") && grandchild.value);
    if (!phraseChild?.value) {
      return child;
    }

    const label =
      child.tag === "HUSB" ? "Husband phrase" :
      child.tag === "WIFE" ? "Wife phrase" :
      "Child phrase";

    pushInfo(
      diagnostics,
      "POINTER_PHRASE_NOTED",
      `Preserved ${child.tag} phrase ${phraseChild.value} as note text for GEDCOM 5.5.1 compatibility.`,
      phraseChild
    );
    hoistedNotes.push(makeNoteNode(node.level + 1, prependLabeledValue(label, phraseChild.value)));

    return removePhraseChildren(child);
  });

  return hoistedNotes.length > 0
    ? {
        ...node,
        children: [...rewrittenChildren, ...hoistedNotes]
      }
    : node;
}

function hoistNchiMetadataNotes(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const hoistedNotes: GedcomNode[] = [];
  const rewrittenChildren = node.children.map((child) => {
    if (child.tag !== "NCHI") {
      return child;
    }

    const rewrittenNchiChildren = child.children.filter((grandchild) => {
      if (grandchild.tag === "_TYPE" && grandchild.value) {
        pushInfo(
          diagnostics,
          "NCHI_METADATA_NOTED",
          `Preserved unsupported NCHI TYPE ${grandchild.value} as note text for GEDCOM 5.5.1 compatibility.`,
          grandchild
        );
        hoistedNotes.push(makeNoteNode(node.level + 1, `Number of children type: ${grandchild.value}`));
        return false;
      }

      if (grandchild.tag === "_HUSB" || grandchild.tag === "_WIFE") {
        const ageChild = grandchild.children.find((greatGrandchild) => greatGrandchild.tag === "AGE" && greatGrandchild.value);
        const label = grandchild.tag === "_HUSB" ? "Husband child-bearing age" : "Wife child-bearing age";

        pushInfo(
          diagnostics,
          "NCHI_METADATA_NOTED",
          `Preserved unsupported NCHI ${grandchild.tag.slice(1)} metadata as note text for GEDCOM 5.5.1 compatibility.`,
          grandchild
        );
        hoistedNotes.push(makeNoteNode(node.level + 1, ageChild?.value ? `${label}: ${ageChild.value}` : label));
        return false;
      }

      return true;
    });

    return {
      ...child,
      children: rewrittenNchiChildren
    };
  });

  return hoistedNotes.length > 0
    ? {
        ...node,
        children: [...rewrittenChildren, ...hoistedNotes]
      }
    : node;
}

function rewriteInvalidStatAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const lines = [`Status: ${node.value ?? ""}`];
  const dateChild = node.children.find((child) => child.tag === "DATE" && child.value);
  if (dateChild?.value) {
    lines.push(`Date: ${dateChild.value}`);
  }

  pushInfo(
    diagnostics,
    "STAT_NOTED",
    `Preserved unsupported STAT ${node.value ?? ""} as note text for GEDCOM 5.5.1 compatibility.`,
    node
  );

  return makeNoteNode(node.level, lines.join("\n"));
}

function rewriteNoNodeAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const lines = [`No ${node.value ?? "event"}`];

  for (const child of node.children) {
    if (child.tag === "DATE" && child.value) {
      lines.push(`Date: ${child.value}`);
      continue;
    }

    if ((child.tag === "NOTE" || child.tag === "_NOTE") && child.value) {
      const label = child.value.startsWith("@") ? "Related note" : "Note";
      lines.push(`${label}: ${child.value}`);
      continue;
    }

    if ((child.tag === "SOUR" || child.tag === "_SOUR") && child.value) {
      const pageChild = child.children.find(
        (grandchild) => (grandchild.tag === "PAGE" || grandchild.tag === "_PAGE") && grandchild.value
      );
      lines.push(appendSourceCitationLine(undefined, child.value, pageChild?.value));
    }
  }

  pushInfo(
    diagnostics,
    "NO_NOTED",
    `Preserved NO ${node.value ?? ""} as note text for GEDCOM 5.5.1 compatibility.`,
    node
  );

  return makeNoteNode(node.level, lines.join("\n"));
}

function rewriteUnsupportedAssociationAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const lines = [`Association${node.value ? `: ${node.value}` : ""}`];
  const roleChild = node.children.find((child) => child.tag === "RELA" && child.value);
  const noteChildren = node.children.filter((child) => (child.tag === "NOTE" || child.tag === "_NOTE") && child.value);
  const sourceChildren = node.children.filter((child) => (child.tag === "SOUR" || child.tag === "_SOUR") && child.value);

  if (roleChild?.value) {
    lines.push(`Role: ${normalizeRoleText(roleChild.value)}`);
  }

  for (const noteChild of noteChildren) {
    const noteValue = noteChild.value!;
    lines.push(`${noteValue.startsWith("@") ? "Related note" : "Note"}: ${noteValue}`);
  }

  for (const sourceChild of sourceChildren) {
    const pageChild = sourceChild.children.find(
      (child) => (child.tag === "PAGE" || child.tag === "_PAGE") && child.value
    );
    lines.push(appendSourceCitationLine(undefined, sourceChild.value, pageChild?.value));
  }

  pushInfo(
    diagnostics,
    "ASSOCIATION_NOTED",
    `Preserved unsupported ASSO ${node.value ?? ""} as note text for GEDCOM 5.5.1 compatibility.`,
    node
  );

  return makeNoteNode(node.level, lines.join("\n"));
}

function rewriteSortDateAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const lines = [`Sort date: ${node.value ?? ""}`];
  const timeChild = findTimeChild(node);

  if (timeChild?.value) {
    lines.push(`Time: ${timeChild.value}`);
  }

  pushInfo(
    diagnostics,
    "SDATE_NOTED",
    `Preserved unsupported SDATE ${node.value ?? ""} as note text for GEDCOM 5.5.1 compatibility.`,
    node
  );

  return makeNoteNode(node.level, lines.join("\n"));
}

function rewriteUnsupportedIdentifierAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const typeChild = node.children.find((child) => child.tag === "TYPE" && child.value);
  const label = node.tag === "_EXID" ? "External ID" : "User reference number";
  let value = `${label}: ${node.value ?? ""}`;

  if (typeChild?.value) {
    value = appendMetadataLine(value, "Type", typeChild.value);
  }

  pushInfo(
    diagnostics,
    node.tag === "_EXID" ? "EXID_NOTED" : "REFN_NOTED",
    `Preserved unsupported ${node.tag} ${node.value ?? ""} as note text for GEDCOM 5.5.1 compatibility.`,
    node
  );

  return makeNoteNode(node.level, value);
}

function rewriteContactIdAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const label = node.tag === "_SKYPEID" ? "Skype ID" : "Jabber ID";

  pushInfo(
    diagnostics,
    "CONTACT_ID_NOTED",
    `Preserved unsupported ${node.tag} ${node.value ?? ""} as note text for GEDCOM 5.5.1 compatibility.`,
    node
  );

  return makeNoteNode(node.level, `${label}: ${node.value ?? ""}`);
}

function rewriteInvalidSsnAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const typeChild = node.children.find((child) => child.tag === "TYPE" && child.value);
  let value = `Social Security number: ${node.value ?? ""}`;

  if (typeChild?.value) {
    value = appendMetadataLine(value, "Type", typeChild.value);
  }

  pushInfo(
    diagnostics,
    "SSN_NOTED",
    `Preserved invalid SSN ${node.value ?? ""} as note text for GEDCOM 5.5.1 compatibility.`,
    node
  );

  return makeNoteNode(node.level, value);
}

function rewriteInilAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const lines = ["Initiatory"];

  for (const child of node.children) {
    if (child.tag === "STAT" && child.value) {
      lines.push(`Status: ${child.value}`);
      const dateChild = child.children.find((grandchild) => grandchild.tag === "DATE" && grandchild.value);
      if (dateChild?.value) {
        lines.push(`Date: ${dateChild.value}`);
      }
      continue;
    }

    if (child.tag === "DATE" && child.value) {
      lines.push(`Date: ${child.value}`);
    }
  }

  pushInfo(
    diagnostics,
    "INIL_NOTED",
    "Preserved unsupported INIL structure as note text for GEDCOM 5.5.1 compatibility.",
    node
  );

  return makeNoteNode(node.level, lines.join("\n"));
}

function rewriteSlgcAsNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const lines = ["Sealing to parents"];

  for (const child of node.children) {
    if (child.tag === "DATE" && child.value) {
      lines.push(`Date: ${child.value}`);
      continue;
    }

    if (child.tag === "TEMP" && child.value) {
      lines.push(`Temple: ${child.value}`);
      continue;
    }

    if (child.tag === "PLAC" && child.value) {
      lines.push(`Place: ${child.value}`);
      continue;
    }

    if (child.tag === "STAT" && child.value) {
      lines.push(`Status: ${child.value}`);
      const dateChild = child.children.find((grandchild) => grandchild.tag === "DATE" && grandchild.value);
      if (dateChild?.value) {
        lines.push(`Status date: ${dateChild.value}`);
      }
      continue;
    }

    if ((child.tag === "NOTE" || child.tag === "_NOTE") && child.value) {
      lines.push(`${child.value.startsWith("@") ? "Related note" : "Note"}: ${child.value}`);
      continue;
    }

    if ((child.tag === "SOUR" || child.tag === "_SOUR") && child.value) {
      const pageChild = child.children.find(
        (grandchild) => (grandchild.tag === "PAGE" || grandchild.tag === "_PAGE") && grandchild.value
      );
      lines.push(appendSourceCitationLine(undefined, child.value, pageChild?.value));
    }
  }

  pushInfo(
    diagnostics,
    "SLGC_NOTED",
    "Preserved unsupported SLGC structure as note text for GEDCOM 5.5.1 compatibility.",
    node
  );

  return makeNoteNode(node.level, lines.join("\n"));
}

function rewriteObjectNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const hoistedNotes: GedcomNode[] = [];
  const rewrittenChildren = node.children.map((child) => {
    if (child.tag === "TITL" || child.tag === "_TITL") {
      if (child.value) {
        pushInfo(
          diagnostics,
          "OBJECT_TITLE_NOTED",
          `Preserved object title ${child.value} as an OBJE NOTE for GEDCOM 5.5.1.`,
          child
        );
        hoistedNotes.push(makeNoteNode(node.level + 1, prependLabeledValue("Object title", child.value)));
      }

      return null;
    }

    if (child.tag === "CROP" || child.tag === "_CROP") {
      const cropNote = formatCropNote(child);
      if (cropNote) {
        pushInfo(
          diagnostics,
          "OBJECT_CROP_NOTED",
          `Preserved object crop metadata as an OBJE NOTE for GEDCOM 5.5.1.`,
          child
        );
        hoistedNotes.push(makeNoteNode(node.level + 1, cropNote));
      }

      return null;
    }

    if (child.tag !== "FILE" && child.tag !== "_FILE") {
      return child;
    }

    let rewrittenChild = child;
    const translationChildren = rewrittenChild.children.filter(
      (grandchild) => (grandchild.tag === "_TRAN" || grandchild.tag === "TRAN") && grandchild.value
    );

    for (const translationChild of translationChildren) {
      const formatChild = findFormatChild(translationChild);
      let noteValue = prependLabeledValue("File translation", translationChild.value!);

      if (formatChild?.value && !isRedundantPlainTextForm(formatChild.value)) {
        noteValue = appendMetadataLine(noteValue, "Format", formatChild.value);
      }

      pushInfo(
        diagnostics,
        "FILE_TRANSLATION_NOTED",
        `Preserved file translation ${translationChild.value} as an OBJE NOTE for GEDCOM 5.5.1.`,
        translationChild
      );
      hoistedNotes.push(makeNoteNode(node.level + 1, noteValue));
    }

    if (translationChildren.length > 0) {
      rewrittenChild = removeTranslationChildren(rewrittenChild);
    }

    const titleChildren = rewrittenChild.children.filter((grandchild) => (grandchild.tag === "TITL" || grandchild.tag === "_TITL") && grandchild.value);
    for (const titleChild of titleChildren) {
      pushInfo(
        diagnostics,
        "FILE_TITLE_NOTED",
        `Preserved file title ${titleChild.value} as an OBJE NOTE for GEDCOM 5.5.1.`,
        titleChild
      );
      hoistedNotes.push(makeNoteNode(node.level + 1, prependLabeledValue("File title", titleChild.value!)));
    }

    if (titleChildren.length > 0) {
      rewrittenChild = {
        ...rewrittenChild,
        children: rewrittenChild.children.filter((grandchild) => grandchild.tag !== "TITL" && grandchild.tag !== "_TITL")
      };
    }

    const cropChildren = rewrittenChild.children.filter((grandchild) => grandchild.tag === "CROP" || grandchild.tag === "_CROP");
    for (const cropChild of cropChildren) {
      const cropNote = formatCropNote(cropChild);
      if (!cropNote) {
        continue;
      }

      pushInfo(
        diagnostics,
        "FILE_CROP_NOTED",
        `Preserved file crop metadata as an OBJE NOTE for GEDCOM 5.5.1.`,
        cropChild
      );
      hoistedNotes.push(makeNoteNode(node.level + 1, cropNote));
    }

    if (cropChildren.length > 0) {
      rewrittenChild = {
        ...rewrittenChild,
        children: rewrittenChild.children.filter((grandchild) => grandchild.tag !== "CROP" && grandchild.tag !== "_CROP")
      };
    }

    if (rewrittenChild.tag === "_FILE") {
      if (rewrittenChild.value) {
        pushInfo(
          diagnostics,
          "FILE_REFERENCE_NOTED",
          `Preserved unsupported file reference ${rewrittenChild.value} as an OBJE NOTE for GEDCOM 5.5.1.`,
          rewrittenChild
        );
        hoistedNotes.push(makeNoteNode(node.level + 1, prependLabeledValue("File reference", rewrittenChild.value)));
      }

      const formatChild = findFormatChild(rewrittenChild);

      if (formatChild?.value) {
        pushInfo(
          diagnostics,
          "FILE_FORMAT_NOTED",
          `Preserved unsupported file format ${formatChild.value} as an OBJE NOTE for GEDCOM 5.5.1.`,
          formatChild
        );
        hoistedNotes.push(makeNoteNode(node.level + 1, prependLabeledValue("File format", formatChild.value)));
        rewrittenChild = removeFormatChildren(rewrittenChild);
      }

      return null;
    }

    return rewrittenChild;
  });

  return hoistedNotes.length > 0
    ? {
        ...node,
        children: [...rewrittenChildren.filter((child): child is GedcomNode => child !== null), ...hoistedNotes]
      }
    : node;
}

function rewriteSourceRecordNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const rewrittenChildren = node.children.map((child) => {
    if (child.tag !== "DATA") {
      return child;
    }

    const hoistedDataNotes: GedcomNode[] = [];
    const rewrittenDataChildren = child.children.map((grandchild) => {
      if (grandchild.tag !== "EVEN") {
        return grandchild;
      }

      const rewrittenEvenChildren = grandchild.children.map((eventChild) => {
        if (eventChild.tag !== "PLAC") {
          return eventChild;
        }

        let rewrittenPlace = eventChild;
        const formatChild = findFormatChild(eventChild);
        if (formatChild?.value) {
          pushInfo(
            diagnostics,
            "SOURCE_PLACE_HIERARCHY_NOTED",
            `Preserved source-place FORM ${formatChild.value} as a DATA NOTE for GEDCOM 5.5.1.`,
            formatChild
          );
          hoistedDataNotes.push(makeNoteNode(child.level + 1, `Place hierarchy: ${formatChild.value}`));
          rewrittenPlace = removeFormatChildren(rewrittenPlace);
        }

        const languageChild = findLanguageChild(rewrittenPlace);
        if (languageChild?.value) {
          pushInfo(
            diagnostics,
            "SOURCE_PLACE_LANGUAGE_NOTED",
            `Preserved source-place LANG ${languageChild.value} as a DATA NOTE for GEDCOM 5.5.1.`,
            languageChild
          );
          hoistedDataNotes.push(makeNoteNode(child.level + 1, `Place language: ${languageChild.value}`));
          rewrittenPlace = removeLanguageChildren(rewrittenPlace);
        }

        const mapChild = rewrittenPlace.children.find((placeChild) => placeChild.tag === "MAP" || placeChild.tag === "_MAP");
        if (mapChild) {
          const mapNote = formatMapNote(mapChild);
          if (mapNote) {
            pushInfo(
              diagnostics,
              "SOURCE_PLACE_MAP_NOTED",
              "Preserved source-place map coordinates as a DATA NOTE for GEDCOM 5.5.1.",
              mapChild
            );
            hoistedDataNotes.push(makeNoteNode(child.level + 1, mapNote));
          }
          rewrittenPlace = {
            ...rewrittenPlace,
            children: rewrittenPlace.children.filter((placeChild) => placeChild !== mapChild)
          };
        }

        const exidChildren = rewrittenPlace.children.filter(
          (placeChild) => (placeChild.tag === "EXID" || placeChild.tag === "_EXID") && placeChild.value
        );
        for (const exidChild of exidChildren) {
          const typeValue = exidChild.children.find((placeChild) => placeChild.tag === "TYPE" && placeChild.value)?.value;
          const label = typeValue ? `Place external ID (${typeValue})` : "Place external ID";
          pushInfo(
            diagnostics,
            "SOURCE_PLACE_EXID_NOTED",
            `Preserved source-place EXID ${exidChild.value} as a DATA NOTE for GEDCOM 5.5.1.`,
            exidChild
          );
          hoistedDataNotes.push(makeNoteNode(child.level + 1, prependLabeledValue(label, exidChild.value!)));
        }
        if (exidChildren.length > 0) {
          rewrittenPlace = {
            ...rewrittenPlace,
            children: rewrittenPlace.children.filter(
              (placeChild) => placeChild.tag !== "EXID" && placeChild.tag !== "_EXID"
            )
          };
        }

        const noteChildren = rewrittenPlace.children.filter(
          (placeChild) => (placeChild.tag === "NOTE" || placeChild.tag === "_NOTE") && placeChild.value
        );
        for (const noteChild of noteChildren) {
          const noteValue = noteChild.value!;
          const label = noteValue.startsWith("@") ? "Place note reference" : "Place note";
          pushInfo(
            diagnostics,
            "SOURCE_PLACE_NOTE_NOTED",
            `Preserved source-place ${noteChild.tag} ${noteValue} as a DATA NOTE for GEDCOM 5.5.1.`,
            noteChild
          );
          hoistedDataNotes.push(makeNoteNode(child.level + 1, prependLabeledValue(label, noteValue)));
        }
        if (noteChildren.length > 0) {
          rewrittenPlace = {
            ...rewrittenPlace,
            children: rewrittenPlace.children.filter(
              (placeChild) => placeChild.tag !== "NOTE" && placeChild.tag !== "_NOTE"
            )
          };
        }

        const placeSourceChildren = rewrittenPlace.children.filter(
          (placeChild) => (placeChild.tag === "SOUR" || placeChild.tag === "_SOUR") && placeChild.value
        );
        for (const sourceChild of placeSourceChildren) {
          const pageChild = sourceChild.children.find(
            (placeChild) => (placeChild.tag === "PAGE" || placeChild.tag === "_PAGE") && placeChild.value
          );
          pushInfo(
            diagnostics,
            "SOURCE_PLACE_CITATION_NOTED",
            `Preserved source-place citation ${sourceChild.value} as a DATA NOTE for GEDCOM 5.5.1.`,
            sourceChild
          );
          hoistedDataNotes.push(
            makeNoteNode(child.level + 1, appendSourceCitationLine("Place source citation", sourceChild.value, pageChild?.value))
          );
        }
        if (placeSourceChildren.length > 0) {
          rewrittenPlace = {
            ...rewrittenPlace,
            children: rewrittenPlace.children.filter(
              (placeChild) => placeChild.tag !== "SOUR" && placeChild.tag !== "_SOUR"
            )
          };
        }

        return rewrittenPlace;
      });

      return {
        ...grandchild,
        children: rewrittenEvenChildren
      };
    });

    return {
      ...child,
      children: [...rewrittenDataChildren, ...hoistedDataNotes]
    };
  });

  return {
    ...node,
    children: rewrittenChildren
  };
}

function mergeUidChildren(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const uidChildren = node.children.filter((child) => child.tag === "_UID" && child.value);

  if (uidChildren.length <= 1) {
    return node;
  }

  const mergedValue = uidChildren.map((child) => child.value!).join("\n");
  pushInfo(
    diagnostics,
    "UIDS_MERGED",
    `Merged ${uidChildren.length} UID values into a single _UID block for GEDCOM 5.5.1 preservation.`,
    uidChildren[0]!
  );

  let merged = false;

  return {
    ...node,
    children: node.children.flatMap((child) => {
      if (child.tag !== "_UID" || child.value === undefined) {
        return [child];
      }

      if (merged) {
        return [];
      }

      merged = true;
      return [
        {
          ...child,
          value: mergedValue,
          children: []
        }
      ];
    })
  };
}

function rewriteUidChildrenAsNotes(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const uidChildren = node.children.filter((child) => child.tag === "_UID" && child.value);

  if (uidChildren.length === 0) {
    return node;
  }

  for (const uidChild of uidChildren) {
    pushInfo(
      diagnostics,
      "UID_NOTED",
      `Preserved UID ${uidChild.value} as note text for GEDCOM 5.5.1 compatibility.`,
      uidChild
    );
  }

  return {
    ...node,
    children: [
      ...node.children.filter((child) => child.tag !== "_UID"),
      ...uidChildren.map((uidChild) => makeNoteNode(uidChild.level, prependLabeledValue("UID", uidChild.value!)))
    ]
  };
}

function flattenChildNotesIntoRecord(record: ParsedRecord, diagnostics: Diagnostic[]): ParsedRecord {
  if (record.tag !== "NOTE") {
    return record;
  }

  const childNotes = record.children.filter((child) => child.tag === "NOTE" && child.value);
  if (childNotes.length === 0) {
    return record;
  }

  let value = record.value;
  for (const childNote of childNotes) {
    pushInfo(
      diagnostics,
      "NOTE_CHILD_FLATTENED",
      `Flattened child NOTE ${childNote.value} into NOTE record text for GEDCOM 5.5.1 compatibility.`,
      childNote
    );
    value = value ? `${value}\n${childNote.value}` : childNote.value;
  }

  return {
    ...record,
    ...(value !== undefined ? { value } : {}),
    children: record.children.filter((child) => child.tag !== "NOTE")
  };
}

function isRedundantPlainTextForm(value: string | undefined): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized === "txt" || normalized === "text/plain";
}

function restoreStandardTimeChildren(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.map((child) => (child.tag === "_TIME" ? { ...child, tag: "TIME" } : child))
  };
}

function normalizeWhitespace(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

function isSupportedLegacyAgeKeyword(value: string | undefined): value is "CHILD" | "INFANT" | "STILLBORN" {
  return ["CHILD", "INFANT", "STILLBORN"].includes(normalizeWhitespace(value).toUpperCase());
}

function isRedundantAdultAgePhrase(ageValue: string | undefined, phraseValue: string | undefined): boolean {
  if (normalizeWhitespace(phraseValue).toUpperCase() !== "ADULT") {
    return false;
  }

  const yearMatch = ageValue?.match(/(\d+)y/i);
  if (!yearMatch) {
    return false;
  }

  return Number.parseInt(yearMatch[1] ?? "", 10) >= 18;
}

function isRedundantAliasPhrase(phraseValue: string | undefined): boolean {
  return normalizeWhitespace(phraseValue).toUpperCase() === "ALIAS";
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

  if (nextNode.tag === "AGE") {
    const phraseChild = findPhraseChild(nextNode);

    if (phraseChild && !nextNode.value && isSupportedLegacyAgeKeyword(phraseChild.value)) {
      pushInfo(
        diagnostics,
        "AGE_PHRASE_PROMOTED",
        `Promoted AGE PHRASE ${phraseChild.value} into the GEDCOM 5.5.1 AGE payload.`,
        phraseChild
      );
      nextNode = {
        ...removePhraseChildren(nextNode),
        value: normalizeWhitespace(phraseChild.value).toUpperCase()
      };
    } else if (phraseChild && isRedundantAdultAgePhrase(nextNode.value, phraseChild.value)) {
      pushInfo(
        diagnostics,
        "REDUNDANT_AGE_PHRASE_DROPPED",
        `Dropped redundant AGE PHRASE ${phraseChild.value} because the numeric age already conveys adulthood.`,
        phraseChild
      );
      nextNode = removePhraseChildren(nextNode);
    }
  }

  if (nextNode.tag === "ALIA") {
    const phraseChild = findPhraseChild(nextNode);

    if (phraseChild && isRedundantAliasPhrase(phraseChild.value)) {
      pushInfo(
        diagnostics,
        "REDUNDANT_ALIAS_PHRASE_DROPPED",
        `Dropped redundant ALIA PHRASE ${phraseChild.value}.`,
        phraseChild
      );
      nextNode = removePhraseChildren(nextNode);
    }
  }

  if (nextNode.tag === "ASSO") {
    const phraseChild = findPhraseChild(nextNode);

    if (phraseChild?.value) {
      pushInfo(
        diagnostics,
        "ASSO_PHRASE_NOTED",
        `Preserved ASSO PHRASE ${phraseChild.value} as an association NOTE for GEDCOM 5.5.1.`,
        phraseChild
      );
      nextNode = {
        ...removePhraseChildren(nextNode),
        children: [...removePhraseChildren(nextNode).children, makeNoteNode(nextNode.level + 1, phraseChild.value)]
      };
    }
  }

  if (nextNode.tag === "SDATE") {
    const phraseChild = findPhraseChild(nextNode);

    if (phraseChild) {
      pushInfo(
        diagnostics,
        "SDATE_PHRASE_DROPPED",
        `Dropped SDATE PHRASE ${phraseChild.value} because GEDCOM 5.5.1 has no equivalent sorting-phrase slot.`,
        phraseChild
      );
      nextNode = removePhraseChildren(nextNode);
    }
  }

  if (nextNode.tag === "CREA") {
    nextNode = demoteTag(nextNode, "_CREA");
  }

  if (EVENT_TAGS.has(nextNode.tag)) {
    const hoistedNotes: GedcomNode[] = [];
    const rewrittenChildren = nextNode.children.map((child) => {
      if (child.tag === "DATE") {
        const timeChild = findTimeChild(child);

        if (timeChild?.value) {
          pushInfo(
            diagnostics,
            "EVENT_TIME_NOTED",
            `Preserved DATE TIME ${timeChild.value} as an event NOTE for GEDCOM 5.5.1.`,
            timeChild
          );
          hoistedNotes.push(makeNoteNode(nextNode.level + 1, `Time: ${timeChild.value}`));
          return removeTimeChildren(child);
        }
      }

      if (child.tag === "AGE") {
        const phraseChild = findPhraseChild(child);

        if (phraseChild?.value) {
          pushInfo(
            diagnostics,
            "AGE_PHRASE_NOTED",
            `Preserved AGE PHRASE ${phraseChild.value} as an event NOTE for GEDCOM 5.5.1.`,
            phraseChild
          );
          hoistedNotes.push(makeNoteNode(nextNode.level + 1, `Age phrase: ${phraseChild.value}`));
          return removePhraseChildren(child);
        }
      }

      return child;
    });

    if (hoistedNotes.length > 0) {
      nextNode = {
        ...nextNode,
        children: [...rewrittenChildren, ...hoistedNotes]
      };
    }
  }

  if (nextNode.tag === "SOUR" && context.rootTag !== "SOUR") {
    const hoistedNotes: GedcomNode[] = [];
    const rewrittenChildren = nextNode.children.map((child) => {
      if (child.tag === "EVEN") {
        const phraseChild = findPhraseChild(child);

        if (phraseChild?.value) {
          pushInfo(
            diagnostics,
            "CITATION_EVENT_PHRASE_NOTED",
            `Preserved source-citation EVEN PHRASE ${phraseChild.value} as a citation NOTE for GEDCOM 5.5.1.`,
            phraseChild
          );
          hoistedNotes.push(makeNoteNode(nextNode.level + 1, `Citation event phrase: ${phraseChild.value}`));
          return removePhraseChildren(child);
        }
      }

      if (child.tag === "DATA") {
        const rewrittenDataChildren = child.children.map((grandchild) => {
          if (grandchild.tag !== "DATE") {
            return grandchild;
          }

          const timeChild = findTimeChild(grandchild);
          if (!timeChild?.value) {
            return grandchild;
          }

          pushInfo(
            diagnostics,
            "SOURCE_DATA_TIME_NOTED",
            `Preserved source DATA TIME ${timeChild.value} as a citation NOTE for GEDCOM 5.5.1.`,
            timeChild
          );
          hoistedNotes.push(makeNoteNode(nextNode.level + 1, `Source data time: ${timeChild.value}`));
          return removeTimeChildren(grandchild);
        });

        return {
          ...child,
          children: rewrittenDataChildren
        };
      }

      return child;
    });

    if (hoistedNotes.length > 0) {
      nextNode = {
        ...nextNode,
        children: [...rewrittenChildren, ...hoistedNotes]
      };
    }
  }

  if (nextNode.tag === "SOUR" && context.parentTag === undefined) {
    nextNode = rewriteSourceRecordNode(nextNode, diagnostics);
  }

  if (nextNode.tag === "REPO" && context.rootTag === "SOUR" && context.parentTag === undefined) {
    const hoistedNotes: GedcomNode[] = [];
    const rewrittenChildren = nextNode.children.map((child) => {
      if (child.tag !== "CALN") {
        return child;
      }

      const rewrittenCalnChildren = child.children.map((grandchild) => {
        if (grandchild.tag !== "MEDI") {
          return grandchild;
        }

        const phraseChild = findPhraseChild(grandchild);
        if (!phraseChild?.value) {
          return grandchild;
        }

        pushInfo(
          diagnostics,
          "CALN_MEDI_PHRASE_NOTED",
          `Preserved CALN.MEDI PHRASE ${phraseChild.value} as a repository citation NOTE for GEDCOM 5.5.1.`,
          phraseChild
        );
        hoistedNotes.push(makeNoteNode(nextNode.level + 1, `Call number media phrase: ${phraseChild.value}`));
        return removePhraseChildren(grandchild);
      });

      return {
        ...child,
        children: rewrittenCalnChildren
      };
    });

    if (hoistedNotes.length > 0) {
      nextNode = {
        ...nextNode,
        children: [...rewrittenChildren, ...hoistedNotes]
      };
    }
  }

  if (nextNode.tag === "NAME") {
    const translationChildren = nextNode.children.filter((child) => (child.tag === "_TRAN" || child.tag === "TRAN") && child.value);

    if (translationChildren.length > 0) {
      for (const translationChild of translationChildren) {
        pushInfo(
          diagnostics,
          "NAME_TRANSLATION_NOTED",
          `Preserved NAME translation ${translationChild.value} as a NOTE for GEDCOM 5.5.1.`,
          translationChild
        );
      }

      nextNode = {
        ...removeTranslationChildren(nextNode),
        children: [
          ...removeTranslationChildren(nextNode).children,
          ...translationChildren.map((translationChild) =>
            makeNoteNode(nextNode.level + 1, prependLabeledValue("Name translation", translationChild.value!))
          )
        ]
      };
    }
  }

  if (nextNode.tag === "PLAC" && nextNode.value) {
    const translationChildren = nextNode.children.filter((child) => (child.tag === "_TRAN" || child.tag === "TRAN") && child.value);

    if (translationChildren.length > 0) {
      const retainedTranslations: GedcomNode[] = [];
      const primaryPlaceText = getPrimaryTextLine(nextNode.value);

      for (const translationChild of translationChildren) {
        if (getPrimaryTextLine(translationChild.value) === primaryPlaceText) {
          pushInfo(
            diagnostics,
            "REDUNDANT_PLACE_TRANSLATION_DROPPED",
            `Dropped PLAC translation ${translationChild.value} because it duplicates the primary place text in GEDCOM 5.5.1.`,
            translationChild
          );
          continue;
        }

        retainedTranslations.push(translationChild);
      }

      if (retainedTranslations.length !== translationChildren.length) {
        nextNode = {
          ...nextNode,
          children: [
            ...nextNode.children.filter((child) => child.tag !== "_TRAN" && child.tag !== "TRAN"),
            ...retainedTranslations
          ]
        };
      }
    }
  }

  if (nextNode.tag === "OBJE") {
    nextNode = rewriteObjectNode(nextNode, diagnostics);
  }

  if (ALWAYS_PHRASE_TAGS.has(nextNode.tag)) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "TRAN") {
    const languageChild = findLanguageChild(nextNode);

    if (languageChild?.value) {
      pushInfo(
        diagnostics,
        "TRAN_LANGUAGE_INLINED",
        `Inlined LANG ${languageChild.value} into TRAN payload for GEDCOM 5.5.1 compatibility.`,
        languageChild
      );
      nextNode = {
        ...removeLanguageChildren(nextNode),
        value: appendMetadataLine(nextNode.value, "Language", languageChild.value)
      };
    }

    return demoteTag(nextNode);
  }

  if (ALWAYS_DEMOTE_TAGS.has(nextNode.tag)) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "UID") {
    if (canUseRefn(context.rootTag, context.parentTag, nextNode.value)) {
      return convertIdentifierNodeToRefn(nextNode, "UUID");
    }

    return demoteTag(nextNode);
  }

  if (nextNode.tag === "_UID") {
    if (canUseRefn(context.rootTag, context.parentTag, nextNode.value)) {
      return convertIdentifierNodeToRefn(nextNode, "UUID");
    }
  }

  if (nextNode.tag === "_EXID") {
    if (canUseRefn(context.rootTag, context.parentTag, nextNode.value)) {
      const typeValue = nextNode.children.find((child) => child.tag === "TYPE")?.value ?? "EXID";
      return convertIdentifierNodeToRefn(nextNode, typeValue);
    }
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
    return rewriteInvalidStatAsNote(nextNode, diagnostics);
  }

  if (nextNode.tag === "SSN" && nextNode.value && nextNode.value.replace(/\D/g, "").length < 9) {
    return rewriteInvalidSsnAsNote({ ...nextNode, tag: "_SSN" }, diagnostics);
  }

  if (nextNode.tag === "_SSN") {
    return rewriteInvalidSsnAsNote(nextNode, diagnostics);
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

  if (nextNode.tag === "NOTE" || nextNode.tag === "_NOTE" || nextNode.tag === "TEXT") {
    const languageChild = findLanguageChild(nextNode);
    const formatChild = findFormatChild(nextNode);
    const translationChildren = nextNode.children.filter((child) => (child.tag === "_TRAN" || child.tag === "TRAN") && child.value);
    const noteSourceChildren = nextNode.children.filter(
      (child) => (child.tag === "SOUR" || child.tag === "_SOUR") && child.value
    );

    if (languageChild?.value) {
      pushInfo(
        diagnostics,
        "TEXT_LANGUAGE_NOTED",
        `Preserved LANG ${languageChild.value} inside ${nextNode.tag} text for GEDCOM 5.5.1.`,
        languageChild
      );
      nextNode = {
        ...removeLanguageChildren(nextNode),
        value: appendMetadataLine(nextNode.value, "Language", languageChild.value)
      };
    }

    if (formatChild?.value) {
      if (!isRedundantPlainTextForm(formatChild.value)) {
        pushInfo(
          diagnostics,
          "TEXT_FORMAT_NOTED",
          `Preserved FORM ${formatChild.value} inside ${nextNode.tag} text for GEDCOM 5.5.1.`,
          formatChild
        );
        nextNode = {
          ...removeFormatChildren(nextNode),
          value: appendMetadataLine(nextNode.value, "Format", formatChild.value)
        };
      } else {
        nextNode = removeFormatChildren(nextNode);
      }
    }

    if (translationChildren.length > 0) {
      let value = nextNode.value;

      for (const translationChild of translationChildren) {
        value = appendTranslationLine(value, translationChild.value!);
      }

      nextNode = {
        ...nextNode,
        ...(value !== undefined ? { value } : {}),
        children: nextNode.children.filter((child) => child.tag !== "_TRAN" && child.tag !== "TRAN")
      };
    }

    if (noteSourceChildren.length > 0) {
      let value = nextNode.value;

      for (const sourceChild of noteSourceChildren) {
        const pageChild = sourceChild.children.find(
          (child) => (child.tag === "PAGE" || child.tag === "_PAGE") && child.value
        );
        value = appendSourceCitationLine(value, sourceChild.value, pageChild?.value);
        pushInfo(
          diagnostics,
          "NOTE_SOURCE_CITATION_NOTED",
          `Preserved note-level source citation ${sourceChild.value} inside ${nextNode.tag} text for GEDCOM 5.5.1.`,
          sourceChild
        );
      }

      nextNode = {
        ...nextNode,
        ...(value !== undefined ? { value } : {}),
        children: nextNode.children.filter((child) => child.tag !== "SOUR" && child.tag !== "_SOUR")
      };
    }
  }

  if (nextNode.tag === "_TRAN") {
    const languageChild = findLanguageChild(nextNode);
    const formatChild = findFormatChild(nextNode);

    if (languageChild?.value) {
      pushInfo(
        diagnostics,
        "TRAN_LANGUAGE_INLINED",
        `Inlined LANG ${languageChild.value} into ${nextNode.tag} payload for GEDCOM 5.5.1 compatibility.`,
        languageChild
      );
      nextNode = {
        ...removeLanguageChildren(nextNode),
        value: appendMetadataLine(nextNode.value, "Language", languageChild.value)
      };
    }

    if (formatChild?.value) {
      nextNode = isRedundantPlainTextForm(formatChild.value)
        ? removeFormatChildren(nextNode)
        : {
            ...removeFormatChildren(nextNode),
            value: appendMetadataLine(nextNode.value, "Format", formatChild.value)
          };
    }
  }

  if (nextNode.tag === "CHAN") {
    nextNode = {
      ...nextNode,
      children: nextNode.children.map((child) => (child.tag === "DATE" ? restoreStandardTimeChildren(child) : child))
    };
  }

  if (nextNode.tag === "SLGC" || nextNode.tag === "SLGS" || nextNode.tag === "_SLGC") {
    const hoistedNotes: GedcomNode[] = [];
    const rewrittenChildren = nextNode.children.map((child) => {
      if (child.tag === "DATE") {
        const rewrittenDate = rewriteDateChildWithoutTime(
          child,
          nextNode.level + 1,
          diagnostics,
          "LDS_DATE_TIME_NOTED",
          (timeValue) => `Preserved ${nextNode.tag} DATE TIME ${timeValue} as note text for GEDCOM 5.5.1 compatibility.`,
          (timeValue) => `Time: ${timeValue}`
        );

        hoistedNotes.push(...rewrittenDate.notes);
        return rewrittenDate.node;
      }

      if (child.tag === "STAT") {
        const dateChild = child.children.find((grandchild) => grandchild.tag === "DATE");
        if (!dateChild) {
          return child;
        }

        const rewrittenDate = rewriteDateChildWithoutTime(
          dateChild,
          nextNode.level + 1,
          diagnostics,
          "LDS_STATUS_TIME_NOTED",
          (timeValue) => `Preserved ${nextNode.tag} STAT DATE TIME ${timeValue} as note text for GEDCOM 5.5.1 compatibility.`,
          (timeValue) => `Status time: ${timeValue}`
        );

        if (rewrittenDate.notes.length === 0) {
          return child;
        }

        hoistedNotes.push(...rewrittenDate.notes);
        return {
          ...child,
          children: child.children.map((grandchild) => (grandchild === dateChild ? rewrittenDate.node : grandchild))
        };
      }

      return child;
    });

    if (hoistedNotes.length > 0) {
      nextNode = {
        ...nextNode,
        children: [...rewrittenChildren, ...hoistedNotes]
      };
    }
  }

  if (nextNode.tag === "_CREA") {
    const dateChild = nextNode.children.find((child) => child.tag === "DATE");
    const timeChild = dateChild ? findTimeChild(dateChild) : undefined;

    if (dateChild?.value || timeChild?.value) {
      const noteLines: string[] = [];

      if (dateChild?.value) {
        noteLines.push(`Creation date: ${dateChild.value}`);
      }

      if (timeChild?.value) {
        pushInfo(
          diagnostics,
          "CREA_TIME_NOTED",
          `Preserved CREA TIME ${timeChild.value} as note text for GEDCOM 5.5.1 compatibility.`,
          timeChild
        );
        noteLines.push(`Creation time: ${timeChild.value}`);
      }

      pushInfo(
        diagnostics,
        "CREA_NOTED",
        "Rewrote CREA metadata as note text for GEDCOM 5.5.1 compatibility.",
        nextNode
      );
      return makeNoteNode(nextNode.level, noteLines.join("\n"));
    }
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

  if (nextNode.tag === "LANG" && context.parentTag === "PLAC") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "TIME" && context.parentTag === "DATE") {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "NO") {
    return rewriteNoNodeAsNote(nextNode, diagnostics);
  }

  if (nextNode.tag === "INIL" || nextNode.tag === "_INIL") {
    return rewriteInilAsNote(nextNode, diagnostics);
  }

  if (nextNode.tag === "SDATE") {
    return rewriteSortDateAsNote(nextNode, diagnostics);
  }

  if (nextNode.tag === "_SDATE") {
    return rewriteSortDateAsNote(nextNode, diagnostics);
  }

  if (nextNode.tag === "_ASSO") {
    return rewriteUnsupportedAssociationAsNote(nextNode, diagnostics);
  }

  if (nextNode.tag === "_EXID" || nextNode.tag === "_REFN") {
    return rewriteUnsupportedIdentifierAsNote(nextNode, diagnostics);
  }

  if (nextNode.tag === "SKYPEID" || nextNode.tag === "JABBERID") {
    return rewriteContactIdAsNote({ ...nextNode, tag: `_${nextNode.tag}` }, diagnostics);
  }

  if (nextNode.tag === "_SKYPEID" || nextNode.tag === "_JABBERID") {
    return rewriteContactIdAsNote(nextNode, diagnostics);
  }

  if (nextNode.tag === "NOTE" && hasAtPrefixedContinuation(nextNode.value)) {
    pushInfo(
      diagnostics,
      "AT_CONTINUATION_NOTED",
      "Rewrote note continuation lines that began with @ into legal GEDCOM 5.5.1 note text.",
      nextNode
    );
    const rewrittenValue = rewriteAtPrefixedContinuationLines(nextNode.value);
    return {
      ...nextNode,
      ...(rewrittenValue !== undefined ? { value: rewrittenValue } : {})
    };
  }

  if (nextNode.tag === "SLGC" && !nextNode.children.some((child) => child.tag === "FAMC")) {
    return rewriteSlgcAsNote({ ...nextNode, tag: "_SLGC" }, diagnostics);
  }

  if (nextNode.tag === "_SLGC") {
    return rewriteSlgcAsNote(nextNode, diagnostics);
  }

  if (context.parentTag === "NCHI" && ["HUSB", "TYPE", "WIFE"].includes(nextNode.tag)) {
    return demoteTag(nextNode);
  }

  if (nextNode.tag === "ASSO" && (context.rootTag === "FAM" || EVENT_TAGS.has(context.parentTag ?? ""))) {
    return rewriteUnsupportedAssociationAsNote({ ...nextNode, tag: "_ASSO" }, diagnostics);
  }

  if (nextNode.tag === "SOUR" && context.rootTag === "SOUR") {
    return demoteTag(nextNode);
  }

  if (
    nextNode.tag === "PAGE" &&
    context.parentTag === "SOUR" &&
    context.rootTag === "SOUR"
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
    return rewriteUnsupportedIdentifierAsNote({ ...nextNode, tag: "_REFN" }, diagnostics);
  }

  if (nextNode.tag === "RESN" && (context.parentTag === "OBJE" || context.rootTag === "OBJE")) {
    pushInfo(
      diagnostics,
      "OBJECT_RESN_NOTED",
      `Preserved object RESN ${nextNode.value ?? ""} as note text for GEDCOM 5.5.1 compatibility.`,
      nextNode
    );
    return makeNoteNode(nextNode.level, prependLabeledValue("Restriction", nextNode.value ?? ""));
  }

  if (nextNode.tag === "TITL" && ["FILE", "OBJE"].includes(context.parentTag ?? "")) {
    return demoteTag(nextNode);
  }

  nextNode = mergeUidChildren(nextNode, diagnostics);
  nextNode = rewriteUidChildrenAsNotes(nextNode, diagnostics);
  nextNode = hoistObjectLinkNotes(nextNode, diagnostics);
  nextNode = rewriteValueChildrenAsNotes(nextNode, diagnostics);
  nextNode = hoistPointerPhraseNotes(nextNode, diagnostics);
  nextNode = hoistNchiMetadataNotes(nextNode, diagnostics);

  return nextNode;
}

function sanitizeRecord(record: ParsedRecord, existingXrefs: Set<string>, diagnostics: Diagnostic[]): ParsedRecord {
  let nextRecord: ParsedRecord = {
    ...record,
    children: record.children
      .map((child) => sanitizeNode(child, { rootTag: record.tag }, existingXrefs, diagnostics))
      .filter((child): child is GedcomNode => child !== null)
  };

  if (nextRecord.tag === "NOTE") {
    const noteNode: GedcomNode = {
      level: 0,
      tag: "NOTE",
      ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {}),
      children: nextRecord.children
    };
    const languageChild = findLanguageChild(noteNode);
    const formatChild = findFormatChild(noteNode);
    const translationChildren = noteNode.children.filter((child) => (child.tag === "_TRAN" || child.tag === "TRAN") && child.value);

    if (languageChild?.value) {
      pushInfo(
        diagnostics,
        "TEXT_LANGUAGE_NOTED",
        `Preserved LANG ${languageChild.value} inside NOTE text for GEDCOM 5.5.1.`,
        languageChild
      );
      const rewrittenNode = {
        ...removeLanguageChildren(noteNode),
        value: appendMetadataLine(noteNode.value, "Language", languageChild.value)
      };

      nextRecord = {
        ...nextRecord,
        ...(rewrittenNode.value !== undefined ? { value: rewrittenNode.value } : {}),
        children: rewrittenNode.children
      };
    }

    if (formatChild?.value) {
      const rewrittenNode = isRedundantPlainTextForm(formatChild.value)
        ? removeFormatChildren({
            level: 0,
            tag: "NOTE",
            ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {}),
            children: nextRecord.children
          })
        : {
            ...removeFormatChildren({
              level: 0,
              tag: "NOTE",
              ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {}),
              children: nextRecord.children
            }),
            value: appendMetadataLine(nextRecord.value, "Format", formatChild.value)
          };

      nextRecord = {
        ...nextRecord,
        ...(rewrittenNode.value !== undefined ? { value: rewrittenNode.value } : {}),
        children: rewrittenNode.children
      };
    }

    if (translationChildren.length > 0) {
      let value = nextRecord.value;

      for (const translationChild of translationChildren) {
        value = appendTranslationLine(value, translationChild.value!);
      }

      nextRecord = {
        ...nextRecord,
        ...(value !== undefined ? { value } : {}),
        children: nextRecord.children.filter((child) => child.tag !== "_TRAN" && child.tag !== "TRAN")
      };
    }
  }

  if (nextRecord.tag === "OBJE") {
    const objectNode = rewriteObjectNode(
      {
        level: 0,
        tag: "OBJE",
        ...(nextRecord.xref !== undefined ? { xref: nextRecord.xref } : {}),
        ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {}),
        children: nextRecord.children
      },
      diagnostics
    );

    nextRecord = {
      tag: objectNode.tag,
      children: objectNode.children,
      ...(objectNode.xref !== undefined ? { xref: objectNode.xref } : {}),
      ...(objectNode.value !== undefined ? { value: objectNode.value } : {})
    };
  }

  if (nextRecord.tag === "SOUR") {
    const sourceNode = rewriteSourceRecordNode(
      {
        level: 0,
        tag: "SOUR",
        ...(nextRecord.xref !== undefined ? { xref: nextRecord.xref } : {}),
        ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {}),
        children: nextRecord.children
      },
      diagnostics
    );

    nextRecord = {
      tag: sourceNode.tag,
      children: sourceNode.children,
      ...(sourceNode.xref !== undefined ? { xref: sourceNode.xref } : {}),
      ...(sourceNode.value !== undefined ? { value: sourceNode.value } : {})
    };
  }

  nextRecord = mergeUidChildren(
    {
      level: 0,
      tag: nextRecord.tag,
      children: nextRecord.children,
      ...(nextRecord.xref !== undefined ? { xref: nextRecord.xref } : {}),
      ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {})
    },
    diagnostics
  );

  const uidNotedRecord = rewriteUidChildrenAsNotes(
    {
      level: 0,
      tag: nextRecord.tag,
      children: nextRecord.children,
      ...(nextRecord.xref !== undefined ? { xref: nextRecord.xref } : {}),
      ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {})
    },
    diagnostics
  );

  nextRecord = {
    tag: uidNotedRecord.tag,
    children: uidNotedRecord.children,
    ...(uidNotedRecord.xref !== undefined ? { xref: uidNotedRecord.xref } : {}),
    ...(uidNotedRecord.value !== undefined ? { value: uidNotedRecord.value } : {})
  };

  const objectLinkHoistedRecord = hoistObjectLinkNotes(
    {
      level: 0,
      tag: nextRecord.tag,
      children: nextRecord.children,
      ...(nextRecord.xref !== undefined ? { xref: nextRecord.xref } : {}),
      ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {})
    },
    diagnostics
  );

  nextRecord = {
    tag: objectLinkHoistedRecord.tag,
    children: objectLinkHoistedRecord.children,
    ...(objectLinkHoistedRecord.xref !== undefined ? { xref: objectLinkHoistedRecord.xref } : {}),
    ...(objectLinkHoistedRecord.value !== undefined ? { value: objectLinkHoistedRecord.value } : {})
  };

  const pointerPhraseHoistedRecord = hoistPointerPhraseNotes(
    {
      level: 0,
      tag: nextRecord.tag,
      children: nextRecord.children,
      ...(nextRecord.xref !== undefined ? { xref: nextRecord.xref } : {}),
      ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {})
    },
    diagnostics
  );

  nextRecord = {
    tag: pointerPhraseHoistedRecord.tag,
    children: pointerPhraseHoistedRecord.children,
    ...(pointerPhraseHoistedRecord.xref !== undefined ? { xref: pointerPhraseHoistedRecord.xref } : {}),
    ...(pointerPhraseHoistedRecord.value !== undefined ? { value: pointerPhraseHoistedRecord.value } : {})
  };

  const nchiMetadataHoistedRecord = hoistNchiMetadataNotes(
    {
      level: 0,
      tag: nextRecord.tag,
      children: nextRecord.children,
      ...(nextRecord.xref !== undefined ? { xref: nextRecord.xref } : {}),
      ...(nextRecord.value !== undefined ? { value: nextRecord.value } : {})
    },
    diagnostics
  );

  nextRecord = {
    tag: nchiMetadataHoistedRecord.tag,
    children: nchiMetadataHoistedRecord.children,
    ...(nchiMetadataHoistedRecord.xref !== undefined ? { xref: nchiMetadataHoistedRecord.xref } : {}),
    ...(nchiMetadataHoistedRecord.value !== undefined ? { value: nchiMetadataHoistedRecord.value } : {})
  };

  nextRecord = flattenChildNotesIntoRecord(nextRecord, diagnostics);

  return nextRecord;
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
