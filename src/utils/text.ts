export function decodeInput(input: string | Uint8Array): string {
  if (typeof input === "string") {
    return input.replace(/^\uFEFF/, "");
  }

  return new TextDecoder("utf-8").decode(input).replace(/^\uFEFF/, "");
}
