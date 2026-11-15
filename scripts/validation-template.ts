// Builds the human-review CSVs from ONE stored MRV1.0 evaluation document (the `result_json` of an evaluations row, exported by the owner).
// Reads a local JSON file only: no database, no network, no model.
//   node scripts/validation-template.ts <result.json> <evaluation_id> <output-prefix>
import { readFileSync, writeFileSync } from "node:fs";
import { FLAG_REVIEW_COLUMNS, MISSED_FLAG_COLUMNS, REVIEW_COLUMNS, buildReviewTemplate, toCsv } from "../src/mrv1/validation-metrics.ts";
import type { Mrv1Document } from "../src/mrv1/types.ts";

const [file, id, prefix] = process.argv.slice(2);
if (!file || !id || !prefix) {
  console.error("usage: node scripts/validation-template.ts <result.json> <evaluation_id> <output-prefix>");
  process.exit(2);
}
const doc = JSON.parse(readFileSync(file, "utf8")) as Mrv1Document;
if (doc.metadata?.rubric_version !== "MRV1.0") {
  console.error(`not an MRV1.0 evaluation document (rubric_version: ${doc.metadata?.rubric_version ?? "missing"})`);
  process.exit(2);
}
const t = buildReviewTemplate(doc, Number(id));
writeFileSync(`${prefix}-criteria.csv`, toCsv(REVIEW_COLUMNS, t.criteria), "utf8");
writeFileSync(`${prefix}-flags.csv`, toCsv(FLAG_REVIEW_COLUMNS, t.flags), "utf8");
writeFileSync(`${prefix}-missed-flags.csv`, toCsv(MISSED_FLAG_COLUMNS, []), "utf8");
console.log(`wrote ${prefix}-criteria.csv (${t.criteria.length} rows), ${prefix}-flags.csv (${t.flags.length} rows) and an empty ${prefix}-missed-flags.csv`);
