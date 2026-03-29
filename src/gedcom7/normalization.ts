import type { GedcomNode } from "../types.js";

export function normalizeGedcom7Node(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.map(normalizeGedcom7Node)
  };
}
