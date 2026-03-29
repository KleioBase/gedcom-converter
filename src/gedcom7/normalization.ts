import type { GedcomNode } from "../types.js";

export function normalizeGedcom7Node(node: GedcomNode): GedcomNode {
  return {
    ...node,
    ...(node.value?.startsWith("@@") ? { value: node.value.slice(1) } : {}),
    children: node.children.map(normalizeGedcom7Node)
  };
}
