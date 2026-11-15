// Confirms the rubric digest used by the evaluator matches docs/evaluation-rubric-v1.md (criterion IDs and names).
// Run: npm run check:rubric
import { readFileSync } from "node:fs";
import { CATEGORIES_EVALUATED, CATEGORIES_NOT_EVALUATED, CRITERIA, RUBRIC_VERSION } from "../src/evaluation/rubric.ts";

export function checkRubricAgainstDocument(markdown: string): string[] {
  const problems: string[] = [];
  for (const c of CRITERIA) {
    const re = new RegExp(`^#{3,4} ${c.id} — ${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
    if (!re.test(markdown)) problems.push(`document heading not found for ${c.id} "${c.name}"`);
  }
  for (const cat of CATEGORIES_EVALUATED) if (!markdown.includes(cat.name)) problems.push(`category name "${cat.name}" not found in the document`);
  if (CATEGORIES_NOT_EVALUATED.some((c) => CATEGORIES_EVALUATED.some((e) => e.id === c.id))) problems.push("a category is both evaluated and not evaluated");
  return problems;
}

if (process.argv[1] && process.argv[1].endsWith("check-rubric.ts")) {
  const md = readFileSync("docs/evaluation-rubric-v1.md", "utf8");
  const problems = checkRubricAgainstDocument(md);
  const rev = md.match(/Revision (\d+)/)?.[0] ?? "unknown";
  console.log(`rubric digest version: ${RUBRIC_VERSION}; document says: ${rev}`);
  console.log(`criteria loaded: ${CRITERIA.map((c) => c.id).join(", ")}`);
  console.log(`categories not evaluated (not scored): ${CATEGORIES_NOT_EVALUATED.map((c) => c.id).join(", ")}`);
  if (problems.length) {
    for (const p of problems) console.log("PROBLEM:", p);
    process.exitCode = 1;
  } else console.log("OK: all 9 criteria match the approved document headings.");
}
