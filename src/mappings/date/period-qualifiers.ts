// Neither the 5.5.1 DATE_PERIOD nor the GEDCOM 7 DatePeriod production allows an
// approximation or range qualifier on its FROM/TO dates, yet exporters such as
// MyHeritage write `FROM ABT 1920 TO BEF 1930`. Stripping the qualifier yields
// the nearest grammar-valid period; the caller keeps the source text in a PHRASE.
const QUALIFIED_PERIOD_PATTERN = /(^|\s)(FROM|TO)\s+(?:ABT|EST|CAL|BEF|AFT)(?=\s)/g;

export function stripPeriodQualifiers(value: string): string {
  if (!/^(?:FROM|TO)\s/.test(value)) {
    return value;
  }

  return value.replace(QUALIFIED_PERIOD_PATTERN, "$1$2");
}
