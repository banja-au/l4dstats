import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = new URL("../src/", import.meta.url);
const files = [];
const visitDirectory = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visitDirectory(path);
    else if (
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx") &&
      entry.name !== "i18n.tsx"
    )
      files.push(path);
  }
};
visitDirectory(root.pathname);

const userFacingAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "placeholder",
  "detail",
  "label",
  "text",
  "title",
]);
const allowedLiteralCopy = new Set(["L4D", "L4DStats", "STATS"]);
const violations = [];
const meaningful = (value) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/u.test(value);
const normalize = (value) => value.replace(/\s+/g, " ").trim();

for (const file of files) {
  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const report = (node, value, kind) => {
    const copy = normalize(value);
    if (!meaningful(copy) || allowedLiteralCopy.has(copy)) return;
    const { line, character } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    violations.push(
      `${relative(root.pathname, file)}:${line + 1}:${character + 1} ${kind}: ${JSON.stringify(copy)}`,
    );
  };
  const walk = (node) => {
    if (ts.isJsxText(node)) report(node, node.text, "raw JSX copy");
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      const expression = node.expression;
      if (
        ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression)
      )
        report(expression, expression.text, "literal JSX expression");
      if (ts.isConditionalExpression(expression)) {
        for (const branch of [expression.whenTrue, expression.whenFalse])
          if (
            ts.isStringLiteral(branch) ||
            ts.isNoSubstitutionTemplateLiteral(branch)
          )
            report(branch, branch.text, "literal JSX conditional");
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      userFacingAttributes.has(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    )
      report(node, node.initializer.text, `literal ${node.name.text}`);
    ts.forEachChild(node, walk);
  };
  walk(source);
}

if (violations.length) {
  console.error(
    "User-facing copy must go through t(...) or tx(...):\n" +
      violations.map((value) => `- ${value}`).join("\n"),
  );
  process.exit(1);
}

console.log(`i18n copy check passed (${files.length} TSX files)`);
