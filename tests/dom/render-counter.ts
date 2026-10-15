import ts from "typescript";

function instrumentComponentRender(source: string, name: string): string {
  const tree = ts.createSourceFile("component.ts", source, ts.ScriptTarget.Latest, true);
  const edits: { start: number; end: number; text: string }[] = [];
  const count = `globalThis.__rootRenderCounts[${JSON.stringify(name)}]++;`;
  function visit(node: ts.Node): void {
    if (ts.isReturnStatement(node) && node.expression && ts.isArrowFunction(node.expression)) {
      const body = node.expression.body;
      if (ts.isBlock(body)) edits.push({ start: body.getStart(tree) + 1, end: body.getStart(tree) + 1, text: count });
      else edits.push({ start: body.getStart(tree), end: body.end, text: `{ ${count} return ${body.getText(tree)}; }` });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

export { instrumentComponentRender };
