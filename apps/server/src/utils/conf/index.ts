import conf from "conf";
import { mkdirSync, readFile, readdirSync, realpathSync, writeAtomic } from "@toonflow/file";
import { resolve } from "node:path";
import tfRouter from "@toonflow/providers/language/tfRouter";
import type { RemoteTeam } from "@/utils/teams";
import type { A2aSettings } from "@/agent/a2a/settings";
import type { desktopUpdateAttempt } from "@/types/desktop";
import type { MobileLinkConfig } from "@/utils/mobileLink";
import { normalizeNodeMenu, serializeNodeMenu } from "@/lib/nodeMenu";

const autoInstallProviders = [tfRouter];
const dataDirectory = process.env.TOONFLOW_DATA_DIR ?? resolve(import.meta.dirname, "../../../../../data");
mkdirSync(dataDirectory, { recursive: true });
const configDirectory = realpathSync(dataDirectory);
process.env.TOONFLOW_DATA_DIR = configDirectory;

// ACT: conf 直接让第三方库 JSON.parse，settings.json 若被外部工具（如 PowerShell 的 utf8 写出）带上 BOM，
// 整个进程会在启动时崩在「Unrecognized token '锘?」。这里按仓库既有惯例先剥掉前缀再实例化（同一份容错
// 见 personalization.ts、agent/runtime/resources.ts、routes/skills/save.ts）；conf 之后的自身重写不含 BOM，等于自愈。
const settingsPath = resolve(configDirectory, "settings.json");
const rawSettings = await readFile(settingsPath, "utf8").catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
if (rawSettings?.startsWith("\uFEFF")) await writeAtomic(settingsPath, rawSettings.slice(1), { mode: 0o600 });

const config = new conf<{ settings: Record<string, unknown>; disabledSkills: string[]; toolConfigs: Record<string, Record<string, unknown>>; nodeConfigs: Record<string, Record<string, unknown>>; extConfigs: Record<string, Record<string, unknown>>; remoteConnections: Record<string, RemoteTeam>; a2a: A2aSettings; desktopUpdateAttempt: desktopUpdateAttempt; mobileLink: MobileLinkConfig }>({
  cwd: configDirectory,
  configName: "settings",
  configFileMode: 0o600,
  watch: true,
});

export function removeLegacySettings(settings: Record<string, unknown>) {
  let changed = false;
  // ACT: 只清理已废弃字段，保留其他设置和插件配置。
  for (const [record, key] of [[settings, "developerConfirmed"], [settings.general, "systemPrompt"], [settings.stores, "toonflow.developer"]] as const) {
    if (record && typeof record === "object" && !Array.isArray(record) && Object.hasOwn(record, key)) {
      Reflect.deleteProperty(record, key);
      changed = true;
    }
  }
  return changed;
}

export function cleanNodeMenuSettings(settings: Record<string, unknown>) {
  const general = settings.general;
  if (!general || typeof general !== "object" || Array.isArray(general) || !Object.hasOwn(general, "nodeMenu")) return false;
  const record = general as Record<string, unknown>;
  const installedTypes = new Set<string>();
  try {
    // ACT: 仅扫描已安装文件名；禁用节点保留配置，菜单清理与同步存盘间不插入异步等待。
    for (const file of readdirSync(resolve(configDirectory, "nodes"), { withFileTypes: true })) {
      if (file.isFile() && /^[a-z][a-zA-Z0-9]*\.umd\.js$/.test(file.name)) installedTypes.add(`remote-${file.name.slice(0, -7)}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const nodeMenu = serializeNodeMenu(normalizeNodeMenu(record.nodeMenu), installedTypes);
  if (!nodeMenu.length) {
    delete record.nodeMenu;
    return true;
  }
  if (JSON.stringify(record.nodeMenu) === JSON.stringify(nodeMenu)) return false;
  record.nodeMenu = nodeMenu;
  return true;
}

const settings = config.get("settings", {});
if (removeLegacySettings(settings)) config.set("settings", settings);

// ACT: 仅初始化尚未配置的文本供应商；已有列表（包括用户清空的列表）保持原样。
if (!config.has("settings.customProviders")) {
  config.set("settings.customProviders", autoInstallProviders.map(({ id, label, icon, version, apiUrl, protocol, models }) =>
    ({ id, label, icon, version, apiUrl, protocol, models, apiKey: "" })));
}

export default config;
