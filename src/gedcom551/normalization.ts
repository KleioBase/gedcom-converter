import type { GedcomNode } from "../types.js";

export function normalizeGedcom551Node(node: GedcomNode): GedcomNode {
  return {
    ...node,
    // Spec §1.2: a line value whose first character is @ is written doubled
    // (@@); halve the leading @@ back to a single @ on read. This runs per
    // physical line (before CONT/CONC payloads are joined), mirroring the
    // GEDCOM 7 normalizer so continuation lines are decoded too.
    ...(node.value?.startsWith("@@") ? { value: node.value.slice(1) } : {}),
    children: node.children.map(normalizeGedcom551Node)
  };
}
