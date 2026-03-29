import type { GedcomNode } from "../types.js";

export function normalizeGedcom551Node(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.map(normalizeGedcom551Node)
  };
}
