// Neither grammar's DatePeriod or DateRange production allows an approximation
// or range qualifier on its FROM/TO or BET/AND dates, yet exporters such as
// MyHeritage write `FROM ABT 1920 TO BEF 1930` and `BET ABT 1936 AND 1939`.
// Stripping the qualifier yields the nearest grammar-valid period or range; the
// caller keeps the source text in a PHRASE.
const QUALIFIED_PERIOD_PATTERN = /(^|\s)(FROM|TO|BET|AND)\s+(?:ABT|EST|CAL|BEF|AFT)(?=\s)/g;

export function stripPeriodQualifiers(value: string): string {
  if (!/^(?:FROM|TO|BET)\s/.test(value)) {
    return value;
  }

  return value.replace(QUALIFIED_PERIOD_PATTERN, "$1$2");
}
