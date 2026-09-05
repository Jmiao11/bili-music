const { readFileSync } = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const mainPath = path.join(root, "src-tauri", "tauri.conf.json");
const macosPath = path.join(root, "src-tauri", "tauri.macos.conf.json");

function readConfig(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`无法读取或解析 ${path.relative(root, file)}: ${error.message}`);
  }
}

function firstWindow(config, file, allowMissing) {
  if (allowMissing && config?.app?.windows === undefined) return null;
  if (!Array.isArray(config?.app?.windows) || config.app.windows.length === 0) {
    throw new Error(`${file} 的 app.windows 缺失、不是数组或为空`);
  }

  const window = config.app.windows[0];
  if (!window || typeof window !== "object" || Array.isArray(window)) {
    throw new Error(`${file} 的 app.windows[0] 必须是对象`);
  }
  return window;
}

try {
  const mainWindow = firstWindow(readConfig(mainPath), "src-tauri/tauri.conf.json", false);
  const macosWindow = firstWindow(
    readConfig(macosPath),
    "src-tauri/tauri.macos.conf.json",
    true,
  );

  if (!macosWindow) {
    console.log("Tauri 平台配置检查通过：macOS 未覆盖 app.windows。");
  } else {
    const macosFields = new Set(Object.keys(macosWindow));
    const missingFields = Object.keys(mainWindow).filter((field) => !macosFields.has(field));

    if (missingFields.length > 0) {
      throw new Error(
        `src-tauri/tauri.macos.conf.json 的 app.windows[0] 缺少字段：\n${missingFields
          .map((field) => `  - ${field}`)
          .join("\n")}\nTauri 会整体替换 app.windows；请将上述字段添加到 macOS 配置的 app.windows[0]。`,
      );
    }

    console.log("Tauri 平台配置检查通过：macOS app.windows[0] 包含主配置的全部字段。");
  }
} catch (error) {
  console.error(`Tauri 平台配置检查失败：\n${error.message}`);
  process.exitCode = 1;
}
