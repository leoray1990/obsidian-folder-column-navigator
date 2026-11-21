const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript");
const { loadI18n } = require("./i18n-test-utils.cjs");
const i18n = loadI18n("en");
const root = path.join(__dirname, "..");
const keys = new Set();
for (const filename of ["main.ts", "daily-note.ts", "holidays.ts"]) {
    const source = ts.createSourceFile(filename, fs.readFileSync(path.join(root, filename), "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "t" && ts.isStringLiteral(node.arguments[0])) keys.add(node.arguments[0].text);
        if (ts.isStringLiteral(node) && /\p{Script=Han}/u.test(node.text) &&
            !(ts.isCallExpression(node.parent) && node.parent.expression.getText(source) === "t")) {
            let persistedDefault = false;
            for (let parent = node; parent; parent = parent.parent) {
                if (ts.isVariableDeclaration(parent) && parent.name.getText(source) === "DEFAULT_SETTINGS") persistedDefault = true;
            }
            const acceptedBoolean = filename === "main.ts" && ["是", "否", "勾选", "未勾选"].includes(node.text);
            const holidayData = filename === "holidays.ts" && node.text === "周末";
            assert.ok(persistedDefault || acceptedBoolean || holidayData, `Unlocalized UI literal in ${filename}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
}
const slots = value => [...value.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort().join(",");
for (const key of keys) {
    assert.ok(Object.hasOwn(i18n.catalog, key), `Missing English: ${key}`);
    assert.ok(i18n.catalog[key].trim(), `Empty English: ${key}`);
    assert.equal(slots(i18n.catalog[key]), slots(key), `Interpolation mismatch: ${key}`);
}
for (const [key, value] of Object.entries(i18n.singularCatalog)) {
    assert.ok(Object.hasOwn(i18n.catalog, key));
    assert.equal(slots(value.text), slots(key), `Singular interpolation mismatch: ${key}`);
}
for (const code of ["zh", "zh-CN", "zh-TW", "zh_Hans", "ZH-cn"]) assert.equal(i18n.resolveLanguage(code), "zh");
for (const code of ["en", "en-US", "de", "fr", "ja", ""]) assert.equal(i18n.resolveLanguage(code), "en");
assert.equal(i18n.t("导航"), "Navigation");
for (const value of ["constructor", "__proto__", "toString", "Unknown holiday"]) assert.equal(i18n.t(value), value);
assert.equal(i18n.t("打开 {0}", ["我的笔记/{1}<literal>.md"]), "Open 我的笔记/{1}<literal>.md");
assert.equal(i18n.t("筛选：{0}", ["系统设计"]), "Filter: 系统设计");
assert.equal(i18n.t("{0} 个文件", [1]), "1 file");
assert.equal(i18n.t("{0} 个文件", [2]), "2 files");
assert.equal(i18n.t("{0}，匹配 {1} 个文件", ["2026-11-21", 1]), "2026-11-21: 1 matching file");
assert.equal(i18n.calendarWeekday(new Date(2026, 10, 16)), "Mon");
assert.equal(i18n.calendarMonth(new Date(2026, 10, 1), true), "November 2026");
for (const year of [2025, 2026, 2027]) {
    for (const day of require(path.join(root, "data/holidays", `${year}.json`)).days) {
        assert.notEqual(i18n.t(day.name), day.name, `Untranslated built-in holiday: ${day.name}`);
    }
}
i18n.setLanguage("zh-CN");
assert.equal(i18n.t("导航"), "导航");
assert.equal(i18n.calendarWeekday(new Date(2026, 10, 16)), "一");
assert.equal(i18n.calendarMonth(new Date(2026, 10, 1), true), "2026年11月");
i18n.setLanguage("de");
assert.equal(i18n.t("导航"), "Navigation", "Unsupported app languages fall back to English");

// Language changes must not translate existing paths or saved rule literals.
i18n.setLanguage("en");
const daily = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, "daily-note.ts"), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText, { exports: daily, require: name => name === "./i18n" ? i18n : {
    moment: require("moment"), Modal: class {}, AbstractInputSuggest: class {}, TFile: class {}, TFolder: class {}
} });
assert.equal(daily.DEFAULT_DAILY_NOTE.baseDirectory, "Daily", "Fresh English presets use an English folder suggestion");
const saved = { ...daily.DEFAULT_DAILY_NOTE, baseDirectory: "日记/私人的", directory: "固定/{{date:YYYY}}", name: "笔记-{{date:YYYY-MM-DD}}" };
for (const code of ["en", "zh", "fr"]) {
    i18n.setLanguage(code);
    const cleaned = daily.cleanDailyNoteConfig(saved);
    assert.equal(cleaned.baseDirectory, saved.baseDirectory);
    assert.equal(cleaned.directory, saved.directory);
    assert.equal(cleaned.name, saved.name);
    assert.equal(daily.dailyNotePath(cleaned, new Date(2026, 10, 21)), "日记/私人的/固定/2026/笔记-2026-11-21.md");
}

const main = ts.createSourceFile("main.ts", fs.readFileSync(path.join(root, "main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const cls = name => main.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === name);
const method = (owner, name) => cls(owner).members.find(node => node.name?.getText(main) === name).getText(main);
const constants = main.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(decl =>
    ["COLUMN_CLICK_ALIGNMENT_OPTIONS", "COLORFUL_PALETTE_LABELS"].includes(decl.name.getText(main)) ||
    (decl.initializer && (ts.isNumericLiteral(decl.initializer) || ts.isStringLiteral(decl.initializer))))).map(node => node.getText(main)).join("\n");
function makeSettings() {
    return vm.runInNewContext(ts.transpileModule(`${constants}\nclass Settings {
        ${["createSettingDefinitions", "itemFontSlider", "columnWidthSlider"].map(name => method("FolderColumnNavigatorSettingTab", name)).join("\n")}
    }; Settings`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, { t: i18n.t });
}
const plugin = { settings: { customFolders: [], customFolderNames: {}, hiddenRootPaths: [] }, getNavigationSettingsEntries: () => [] };
function definitions(code) {
    i18n.setLanguage(code);
    const tab = new (makeSettings())(); tab.plugin = plugin;
    return tab.createSettingDefinitions();
}
const english = definitions("en"), chinese = definitions("zh");
assert.equal(english.map(page => page.name).join("|"), "Navigation|Appearance|Folder notes|Advanced|Calendar");
assert.equal(chinese.map(page => page.name).join("|"), "导航|显示|文件夹笔记|高级|日历");
function controlKeys(pages) {
    const result = [];
    const visit = node => { if (node?.control?.key) result.push(node.control.key); if (Array.isArray(node?.items)) node.items.forEach(visit); };
    pages.forEach(visit); return result.join("|");
}
assert.equal(controlKeys(english), controlKeys(chinese), "Translation must not change persisted setting keys");
const MenuView = vm.runInNewContext(ts.transpileModule(`class View {
    ${method("FolderColumnNavigatorView", "showFileContextMenu")}
    ${method("FolderColumnNavigatorView", "showFolderContextMenu")}
    ${method("FolderColumnNavigatorView", "showGroupContextMenu")}
}; View`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, { t: i18n.t, ROOT_PATH: "/" });
const v = new MenuView();
v.plugin = { ...plugin, app: { vault: { getRoot: () => ({ path: "/" }) } }, isGroupPinned: () => false };
v.addSetGroupMenuItem = () => {}; v.addExtensionMenuItems = () => {}; v.showContextMenu = () => {};
function titles(run) {
    const result = [];
    v.createContextMenu = () => ({ addSeparator() {}, addItem(fn) {
        const builder = new Proxy({}, { get: (_, key) => value => { if (key === "setTitle") result.push(value); return builder; } }); fn(builder);
    } });
    run(); return result;
}
i18n.setLanguage("en");
assert.equal(titles(() => v.showFileContextMenu({ path: "笔记.md" }, {})).join("|"), "Open|Open in new tab|Rename|Move to…|Delete");
assert.ok(titles(() => v.showFolderContextMenu({ path: "项目", parent: {} }, {})).includes("Create folder note"));
assert.equal(titles(() => v.showGroupContextMenu("原始分组", "原始分组", {})).join("|"), "Pin group|Group: 原始分组");
i18n.setLanguage("zh");
assert.equal(titles(() => v.showFileContextMenu({}, {}))[0], "打开");
console.log(`PASS: ${keys.size} UI messages have English translations with matching placeholders; Obsidian language/fallback, all built-in holiday names, settings keys and native menu labels verified.`);
