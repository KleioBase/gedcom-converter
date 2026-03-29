const XREF_PATTERN = /^@[^@\s]+@$/;

export function isXrefToken(value: string | undefined): value is string {
  return typeof value === "string" && XREF_PATTERN.test(value);
}
