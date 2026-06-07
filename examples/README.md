# Examples

Runnable recipes for `@kleiobase/gedcom-converter`. Each recipe is a single file.
Run one with [`tsx`](https://github.com/privatenumber/tsx):

```bash
npx tsx examples/<name>.ts
```

| Recipe | What it shows |
| --- | --- |
| [`parse.ts`](./parse.ts) | Read a `.ged` file, detect its version, walk records, log diagnostics. |
| [`stream.ts`](./stream.ts) | Stream a GEDCOM 7 file's top-level records one at a time without holding the whole tree in memory. |
| [`stringify.ts`](./stringify.ts) | Build a `ParsedDocument` programmatically and serialize it (with a `lineEnding` option). |
| [`convert.ts`](./convert.ts) | Convert 7.0 → 5.5.1, inspect stats/diagnostics, and decide whether `strict` mode would reject it. |
| [`diagnostics.ts`](./diagnostics.ts) | Group conversion diagnostics by severity and render a per-code report. |
| [`gedzip.ts`](./gedzip.ts) | Build a `.gdz` archive, read it back, list and extract bundled media, and re-bundle. |
| [`basic-usage.ts`](./basic-usage.ts) | The minimal detect-and-convert snippet from the README. |
