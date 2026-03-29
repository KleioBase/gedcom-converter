export class GedcomError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "GedcomError";
    this.code = code;
  }
}

export class ParseError extends GedcomError {
  public constructor(message: string) {
    super("PARSE_ERROR", message);
    this.name = "ParseError";
  }
}

export class ConversionError extends GedcomError {
  public constructor(message: string) {
    super("CONVERSION_ERROR", message);
    this.name = "ConversionError";
  }
}
