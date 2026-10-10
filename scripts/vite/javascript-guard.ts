import assert from "node:assert/strict";
import ts from "typescript";

function checkJavaScript(source: string, file: string) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let evalCalls = 0, functionConstructors = 0;
  function identifier(node: ts.Expression): string | undefined {
    if (ts.isParenthesizedExpression(node)) return identifier(node.expression);
    return ts.isIdentifier(node) ? node.text : undefined;
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && identifier(node.expression) === "eval") evalCalls++;
    if (ts.isNewExpression(node) && identifier(node.expression) === "Function") functionConstructors++;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.deepEqual({ evalCalls, functionConstructors }, { evalCalls: 0, functionConstructors: 0 }, `${file}: forbidden dynamic code generation`);
}

assert.throws(() => checkJavaScript("eval('x');", "eval-canary.js"), /forbidden dynamic code generation/);
assert.throws(() => checkJavaScript("new Function('return 1');", "function-canary.js"), /forbidden dynamic code generation/);
assert.doesNotThrow(() => checkJavaScript('const text = "eval(x); new Function()"; /* eval(x) */ object.eval();', "safe.js"));

export { checkJavaScript };
