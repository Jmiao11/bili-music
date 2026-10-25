import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

type NativeWrite={file:string;line:number;expression:string};
function collectNativeWrites(root:string):NativeWrite[] {
  const config=ts.readConfigFile(path.join(root,"scripts/typecheck/tsconfig.main.json"),ts.sys.readFile);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.join(root,"scripts/typecheck"));
  const program=ts.createProgram([...new Set([...parsed.fileNames,...ts.sys.readDirectory(path.join(root,"ui"),[".ts"])])],parsed.options),checker=program.getTypeChecker(),writes:NativeWrite[]=[];
  const domDeclaration=(symbol:ts.Symbol|undefined)=>symbol?.declarations?.some(declaration=>/\/lib\.dom\.d\.ts$/.test(declaration.getSourceFile().fileName.replaceAll("\\","/"))) ?? false;
  function nativeType(type:ts.Type):boolean {
    if(type.isUnion())return type.types.some(nativeType);
    const symbol=type.getSymbol();
    if(domDeclaration(symbol) && ["Node","Element","CSSStyleDeclaration","DOMStringMap","DOMTokenList"].includes(symbol!.name))return true;
    return Boolean(type.flags & ts.TypeFlags.Object) && Boolean((type as ts.ObjectType).objectFlags & (ts.ObjectFlags.Class|ts.ObjectFlags.Interface)) && (checker.getBaseTypes(type as ts.InterfaceType)??[]).some(nativeType);
  }
  function domMember(node:ts.Expression):boolean {
    if(!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node))return false;
    const receiver=checker.getNonNullableType(checker.getTypeAtLocation(node.expression));
    return nativeType(receiver);
  }
  for(const source of program.getSourceFiles()) {
    const file=path.relative(root,source.fileName).replaceAll("\\","/");
    if(!file.startsWith("ui/") || file.includes("/components/") || source.isDeclarationFile || ["ui/app/root-mount.ts","ui/mini/root-mount.ts"].includes(file))continue;
    function visit(node:ts.Node):void {
      let target:ts.Expression|undefined;
      if(ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment)target=node.left;
      if((ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.operator))target=node.operand;
      if(ts.isDeleteExpression(node))target=node.expression;
      if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["setAttribute","removeAttribute","toggleAttribute","append","appendChild","prepend","replaceChildren","replaceChild","removeChild","insertBefore","insertAdjacentHTML","insertAdjacentElement","insertAdjacentText","before","after","replaceWith","setAttributeNS","removeAttributeNS","remove","add","toggle","replace","setProperty","removeProperty"].includes(node.expression.name.text))target=node.expression;
      if(ts.isCallExpression(node) && ["Object.assign","Object.defineProperty","Reflect.set","Reflect.deleteProperty"].includes(node.expression.getText(source)) && node.arguments[0] && nativeType(checker.getNonNullableType(checker.getTypeAtLocation(node.arguments[0]))))writes.push({file,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,expression:node.getText(source).replace(/\s+/g," ")});
      if(target && !(ts.isPropertyAccessExpression(target) && /^on[a-z]/.test(target.name.text)) && domMember(target))writes.push({file,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,expression:node.getText(source).replace(/\s+/g," ")});
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  return writes;
}
const allowedWrites:Readonly<Record<string,string>>={
  'ui/app/track-columns.ts:document.documentElement.style.setProperty(`--track-${column}-width`, `${trackColumnWidths[column]}px`)': "文档根列宽端口，仅三项已验证列宽；不写 Vue 宿主节点",
  "ui/features/settings/dynamic-background.ts:loadingImage.src = \"\"": "离屏 Image/canvas 采样，不进入应用树",
  "ui/features/settings/dynamic-background.ts:image.crossOrigin = \"anonymous\"": "离屏 Image/canvas 采样，不进入应用树",
  "ui/features/settings/dynamic-background.ts:image.referrerPolicy = \"no-referrer\"": "离屏 Image/canvas 采样，不进入应用树",
  "ui/features/settings/dynamic-background.ts:image.decoding = \"async\"": "离屏 Image/canvas 采样，不进入应用树",
  "ui/features/settings/dynamic-background.ts:canvas.width = canvas.height = 32": "离屏 Image/canvas 采样，不进入应用树",
  "ui/features/settings/dynamic-background.ts:canvas.height = 32": "离屏 Image/canvas 采样，不进入应用树",
  "ui/features/settings/dynamic-background.ts:image.src = \"\"": "离屏 Image/canvas 采样，不进入应用树",
  "ui/features/settings/dynamic-background.ts:image.src = source": "离屏 Image/canvas 采样，不进入应用树",
  "ui/app/sidebar.ts:root.style.setProperty(\"--sidebar-width\", `${width}px`)": "documentElement 平台、主题与启动属性",
  "ui/app/sidebar.ts:root.dataset.sidebarCollapsed = String(state.collapsed)": "documentElement 平台、主题与启动属性",
  "ui/app/sidebar.ts:delete root.dataset.sidebarDragging": "documentElement 平台、主题与启动属性",
  "ui/app/sidebar.ts:root.dataset.sidebarDragging = \"true\"": "documentElement 平台、主题与启动属性",
  "ui/app/startup-platform.ts:document.documentElement.dataset.platform = /Macintosh|Mac OS X/i.test(navigator.userAgent) ? \"macos\" : \"windows\"": "documentElement 平台、主题与启动属性",
  "ui/app/startup-platform.ts:document.documentElement.dataset.startupFailed = \"true\"": "documentElement 平台、主题与启动属性",
  "ui/app/window-controls.ts:document.documentElement.dataset.windowMaximized = String(isMaximized)": "documentElement 平台、主题与启动属性",
  "ui/features/settings/settings-view.ts:dom.root.dataset.theme=state.theme??\"dark\"": "documentElement 平台、主题与启动属性",
  "ui/features/settings/settings-view.ts:dom.root.style.removeProperty(property)": "documentElement 平台、主题与启动属性",
  "ui/features/settings/settings-view.ts:dom.root.style.setProperty(\"--glass-blur\",state.glassBlur+\"px\")": "documentElement 平台、主题与启动属性",
  "ui/features/settings/settings-view.ts:dom.root.style.setProperty(\"--panel-alpha\",String(state.panelAlpha/100))": "documentElement 平台、主题与启动属性",
  "ui/features/settings/settings-view.ts:dom.root.style.setProperty(\"--background-dim\",String(state.backgroundDim/100))": "documentElement 平台、主题与启动属性",
  "ui/features/settings/settings-view.ts:dom.root.style.setProperty('--accent-'+['r','g','b'][index],String(channel))": "documentElement 平台、主题与启动属性",
  "ui/features/settings/settings-view.ts:dom.root.style.setProperty(\"--app-background\",'url(\"'+state.background.dataUrl+'\")')": "documentElement 平台、主题与启动属性",
  "ui/features/settings/settings-view.ts:dom.root.style.removeProperty(\"--app-background\")": "documentElement 平台、主题与启动属性",
  "ui/features/playback/playback-core.ts:audio.removeAttribute(\"src\")": "Vue 宿主外唯一 audio",
  "ui/features/playback/playback-core.ts:audio.src = info.audioUrl": "Vue 宿主外唯一 audio",
  "ui/features/playback/playback-core.ts:audio.currentTime = Math.min(Math.max(0, position), maxPosition)": "Vue 宿主外唯一 audio",
  "ui/features/playback/playback-core.ts:audio.currentTime = Math.min( Math.max(0, Number(resumePosition) || 0), Number.isFinite(maxPosition) ? maxPosition : 0, )": "Vue 宿主外唯一 audio",
  "ui/features/immersive/lyrics.ts:linesElement.scrollTop = 0": "歌词几何滚动副作用",
  "ui/app/main-window-ready.ts:startupRoot.dataset.startupComplete = \"true\"": "documentElement 平台、主题与启动属性",
  "ui/mini/window-controller.ts:root.dataset.theme = [\"light\", \"image\", \"dynamic\"].includes(state.theme ?? \"\") ? state.theme ?? \"dark\" : \"dark\"": "documentElement 平台、主题与启动属性",
  "ui/mini/window-controller.ts:root.style.setProperty(\"--accent-r\",String(Number(state.accent.r)||0))": "documentElement 平台、主题与启动属性",
  "ui/mini/window-controller.ts:root.style.setProperty(\"--accent-g\",String(Number(state.accent.g)||0))": "documentElement 平台、主题与启动属性",
  "ui/mini/window-controller.ts:root.style.setProperty(\"--accent-b\",String(Number(state.accent.b)||0))": "documentElement 平台、主题与启动属性"
};
function checkNativeWrites(root:string):void {
  const used=new Set<string>();
  for(const write of collectNativeWrites(root)) {
    const key=write.file+":"+write.expression;
    assert.ok(allowedWrites[key],`Native UI write: ${write.file}:${write.line}: ${write.expression}`);
    used.add(key);
  }
  for(const key of Object.keys(allowedWrites))assert.ok(used.has(key),"Stale native-write exception: "+key);
}
export {checkNativeWrites,collectNativeWrites};
if(import.meta.main)checkNativeWrites(path.resolve(import.meta.dirname,"../.."));
