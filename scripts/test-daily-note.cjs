// Pure rule tests use the same shared Moment API shape as Obsidian, without a running vault.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");
const moment = require("moment");
const exportsObject = {};
class Element {
    constructor() { this.children = []; this.text = ""; }
    createEl(_tag, options) { const child = new Element(); child.text = options?.text; this.children.push(child); return child; }
    createDiv() { return this.createEl(); }
    setText(value) { this.text = value; }
}
class Modal {
    constructor(app) { this.app = app; this.contentEl = new Element(); this.buttons = []; this.inputs = []; this.contentEl.owner = this; }
    setTitle() {}
    close() { this.closed = true; }
}
class TFile { constructor(path) { this.path = path; this.extension = path.split(".").pop(); } }
class TFolder { constructor(path) { this.path = path; } }
class Setting {
    constructor(container) { this.owner = container.owner; }
    setName() { return this; }
    addText(setup) {
        const input = { inputEl: {}, setValue(value) { this.value = value; return this; }, onChange(fn) { this.change = fn; return this; } };
        this.owner.inputs.push(input); setup(input); return this;
    }
    addButton(setup) {
        const button = { setButtonText(text) { this.text = text; return this; }, setDisabled(value) { this.disabled = value; return this; }, setCta() { return this; }, onClick(fn) { this.click = fn; return this; } };
        this.owner.buttons.push(button); setup(button); return this;
    }
}
const source = fs.readFileSync(path.join(__dirname, "../daily-note.ts"), "utf8");
vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, {
    exports: exportsObject,
    Error,
    require: name => {
        assert.equal(name, "obsidian");
        return { moment, Modal, Setting, TFile, TFolder, AbstractInputSuggest: class {} };
    },
    window: { setTimeout() {} }
});
const { DEFAULT_DAILY_NOTE, expandDailyTemplate, dailyNotePath, cleanDailyNoteConfig } = exportsObject;
const { isValidDailyLiteral, dailyFormatOptions } = exportsObject;
for (const text of ["日记", "我的日记", "工作记录2026"]) assert.equal(isValidDailyLiteral(text), true);
for (const text of ["", "a/b", "a\\b", "a:b", "a?b", "{{date:YYYY}}", "a\nb"]) assert.equal(isValidDailyLiteral(text), false);
assert.equal(Object.keys(dailyFormatOptions("YYYY")).join(","), "YYYY,YY");
assert.equal(Object.keys(dailyFormatOptions("DD")).join(","), "DD,D");
assert.equal(Object.keys(dailyFormatOptions("YYYY-MM-DD")).join(","), "YYYY-MM-DD");
const selected = new Date(2026, 10, 16);
assert.equal(dailyNotePath(DEFAULT_DAILY_NOTE, selected), "日记/2026-11-16.md");
const config = {
    ...DEFAULT_DAILY_NOTE,
    baseDirectory: "",
    directory: "固定目录/{{date:YYYY}}/{{date:MM}}/{{weekStart:YYYY-MM-DD}}-{{weekEnd:YYYY-MM-DD}}"
};
assert.equal(dailyNotePath(config, selected), "固定目录/2026/11/2026-11-16-2026-11-22/2026-11-16.md");
assert.equal(expandDailyTemplate("{{weekStart:YYYY-MM-DD}}/{{weekEnd:YYYY-MM-DD}}", new Date(2027, 0, 1)), "2026-12-28/2027-01-03");
assert.equal(expandDailyTemplate("{{date:YYYY-MM-DD}}", new Date(2028, 1, 29)), "2028-02-29");
assert.equal(expandDailyTemplate("{{date:WW}}", new Date(2027, 0, 1)), "53");
assert.equal(dailyNotePath({ ...config, type: "canvas" }, selected, "自定义名称"), "固定目录/2026/11/2026-11-16-2026-11-22/自定义名称.canvas");
assert.equal(dailyNotePath({ ...DEFAULT_DAILY_NOTE, baseDirectory: "", directory: "", type: "base" }, selected), "2026-11-16.base");
assert.equal(dailyNotePath({ ...DEFAULT_DAILY_NOTE, baseDirectory: "工作/日记", directory: "{{date:YYYY}}/{{date:MM}}" }, selected), "工作/日记/2026/11/2026-11-16.md");
for (const baseDirectory of ["../outside", "/absolute", "a//b", "{{date:YYYY}}", "a\\b"]) {
    assert.throws(() => dailyNotePath({ ...DEFAULT_DAILY_NOTE, baseDirectory }, selected));
}
const migrated = cleanDailyNoteConfig({ directory: "工作/日记/{{date:YYYY}}/{{date:MM}}", name: "{{date:YYYY-MM-DD}}" });
assert.equal(migrated.baseDirectory, "工作/日记");
assert.equal(migrated.directory, "{{date:YYYY}}/{{date:MM}}");
assert.equal(dailyNotePath(migrated, selected), "工作/日记/2026/11/2026-11-16.md");
assert.equal(dailyNotePath(cleanDailyNoteConfig({ directory: "日记" }), selected), "日记/2026-11-16.md");
for (const directory of ["../secret", "/absolute", "a//b", "a/../b", "a\\b", "a/b:"]) {
    assert.throws(() => dailyNotePath({ ...config, directory }, selected), undefined, directory);
}
for (const name of ["", "..", "a/b", "a\\b", "a?b", "a."]) {
    assert.throws(() => dailyNotePath(config, selected, name), undefined, name);
}
for (const template of ["{{unknown:YYYY}}", "{{date:YYYY", "{{date:HH:mm}}", "{{date:}}"])
    assert.throws(() => expandDailyTemplate(template, selected), undefined, template);
assert.equal(cleanDailyNoteConfig(undefined).enabled, true);
assert.equal(cleanDailyNoteConfig({ type: "invalid" }).type, "md");
console.log("PASS: presets, selected date, ISO week/year boundaries, leap day, custom name, three file types, root directory and invalid-path/template rejection.");

async function testCreation() {
    for (const type of ["md", "canvas", "base"]) {
        const files = new Map(); let count = 0; let content = ""; let result;
        const app = { vault: {
            getAbstractFileByPath: path => files.get(path),
            createFolder: async path => { files.set(path, new TFolder(path)); },
            create: async (path, text) => { assert.ok(!files.has(path)); count++; content = text; const file = new TFile(path); files.set(path, file); return file; }
        } };
        const config = { ...DEFAULT_DAILY_NOTE, baseDirectory: "notes", directory: "2026/11", type };
        const dialog = new exportsObject.CreateDailyNoteModal(app, config, selected, async file => { result = file; });
        dialog.onOpen();
        const confirm = dialog.buttons.find(button => button.text === "创建并打开");
        dialog.inputs[0].change("自定义名称");
        confirm.click(); confirm.click(); // A double activation must not duplicate creation.
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(count, 1); assert.equal(result.path, `notes/2026/11/自定义名称.${type}`);
        assert.equal(dialog.closed, true);
        if (type === "canvas") assert.equal(JSON.parse(content).nodes.length, 0);
        if (type === "base") assert.match(content, /type: table/);
        if (type === "md") assert.match(content, /date: 2026-11-16/);
        const duplicate = new exportsObject.CreateDailyNoteModal(app, config, selected, async () => {});
        duplicate.onOpen(); duplicate.inputs[0].change("自定义名称");
        const duplicateConfirm = duplicate.buttons.find(button => button.text === "创建并打开");
        assert.equal(duplicateConfirm.disabled, true); duplicateConfirm.click();
        await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 1);
        const failed = new exportsObject.CreateDailyNoteModal({ vault: { getAbstractFileByPath: () => undefined, createFolder: async () => { throw Error("permission denied"); } } }, config, selected, async () => {});
        failed.onOpen(); failed.buttons.find(button => button.text === "创建并打开").click();
        await new Promise(resolve => setImmediate(resolve));
        assert.notEqual(failed.closed, true); assert.ok(failed.contentEl.children.some(child => child.text === "permission denied"));
    }
    console.log("PASS: three creation payloads, edited names, missing directories, double-submit guard, collision rejection and failure preserving dialog.");
}
testCreation().catch(error => { console.error(error); process.exitCode = 1; });

async function testSaveAndMatchingPerformance() {
    const main = ts.createSourceFile("main.ts", fs.readFileSync(path.join(__dirname, "../main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const classes = main.statements.filter(ts.isClassDeclaration);
    const method = (className, methodName) => classes.find(item => item.name?.text === className).members
        .find(item => item.name?.getText(main) === methodName).getText(main);
    const compiled = ts.transpileModule(`class Plugin { ${method("FolderColumnNavigator", "saveDailyNoteConfig")} }
        class View { ${method("FolderColumnNavigatorView", "buildCalendarDateMatches")} }; ({Plugin,View})`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const { Plugin, View } = vm.runInNewContext(compiled, { TFile, Intl, formatCalendarDate: date => moment(date).format("YYYY-MM-DD") });
    const plugin = new Plugin(); let uiUpdates = 0; let saves = 0;
    plugin.settings = { dailyNote: { ...DEFAULT_DAILY_NOTE } };
    plugin.views = new Set([{ refreshDailyNoteCreationUi: () => uiUpdates++, refresh: () => { throw Error("Unexpected full view refresh"); } }]);
    plugin.refreshViews = () => { throw Error("Unexpected global refresh"); };
    plugin.saveData = async () => { saves++; };
    await plugin.saveDailyNoteConfig({ ...DEFAULT_DAILY_NOTE, baseDirectory: "changed" });
    assert.equal(saves, 1); assert.equal(uiUpdates, 0);
    await plugin.saveDailyNoteConfig({ ...DEFAULT_DAILY_NOTE, enabled: false });
    assert.equal(uiUpdates, 1);
    const previous = plugin.settings.dailyNote;
    plugin.saveData = async () => { throw Error("save denied"); };
    await assert.rejects(plugin.saveDailyNoteConfig(DEFAULT_DAILY_NOTE));
    assert.equal(plugin.settings.dailyNote, previous);

    const count = 173000;
    const files = Array.from({ length: count }, (_, index) => Object.assign(new TFile(`notes/${index}.md`), {
        extension: "md", basename: String(index), stat: { ctime: selected.getTime(), mtime: selected.getTime() }
    }));
    const view = new View();
    view.plugin = {
        settings: { calendarSearchPaths: [], calendarFileExtensions: [], calendarMatchCreatedDate: true,
            calendarMatchModifiedDate: true, calendarCreatedNotes: { "notes/0.md": "2026-11-16" } },
        isHiddenByPattern: () => false,
        app: { vault: { getFiles: () => files, getAbstractFileByPath: () => files[0] } }
    };
    const started = Date.now();
    const matches = view.buildCalendarDateMatches(new Date(2026, 10, 1), new Date(2026, 11, 1));
    assert.equal(matches.get("2026-11-16").length, count);
    assert.equal(new Set(matches.get("2026-11-16").map(file => file.path)).size, count);
    console.log(`PASS: rule saving avoids global refresh, enable changes update only creation UI, failed save rolls back; ${count.toLocaleString()} same-date files matched and deduplicated in ${Date.now() - started}ms.`);
}
testSaveAndMatchingPerformance().catch(error => { console.error(error); process.exitCode = 1; });

async function testTemplates() {
    const { renderObsidianDailyTemplate, validateDailyTemplate, createDailyNoteWithTemplate } = exportsObject;
    const selected = new Date(2026, 10, 16);
    const clock = new Date(2026, 10, 20, 9, 7);
    assert.equal(renderObsidianDailyTemplate("# {{title}}\n{{date}} {{time}} {{date:YYYY/MM/DD}}", "过去的日记", selected, {}, clock),
        "# 过去的日记\n2026-11-16 09:07 2026/11/16");
    assert.equal(renderObsidianDailyTemplate("{{date}} {{time}}", "", selected, { dateFormat: "YYYYMMDD", timeFormat: "HHmm" }, clock), "20261116 0907");
    assert.equal(renderObsidianDailyTemplate("{{unknown}} <% tp.date.now() %>", "", selected), "{{unknown}} <% tp.date.now() %>");
    const template = new TFile("templates/daily.md");
    const folder = new TFolder("notes");
    let wrote = 0; let output; let nativeCalls = 0; let nativeResult = new TFile("notes/renamed.md");
    const engine = { create_new_note_from_template: async (...args) => {
        nativeCalls++; assert.equal(args[0], template); assert.equal(args[1], folder);
        assert.equal(args[2], "2026-11-16"); assert.equal(args[3], false); return nativeResult;
    } };
    const app = {
        plugins: { getPlugin: () => ({ templater: engine }) },
        vault: {
            getAbstractFileByPath: path => path === template.path ? template : path === "notes" ? folder : undefined,
            cachedRead: async () => "# {{title}}\n{{date}}",
            create: async (path, content) => { wrote++; output = content; return new TFile(path); }
        }
    };
    const config = { ...DEFAULT_DAILY_NOTE, templateSource: "obsidian", templatePath: template.path };
    assert.equal(validateDailyTemplate(app, config), template);
    await createDailyNoteWithTemplate(app, config, selected, "notes/2026-11-16.md", template);
    assert.equal(output, "# 2026-11-16\n2026-11-16");
    assert.equal(wrote, 1);
    const templaterConfig = { ...config, templateSource: "templater" };
    const file = await createDailyNoteWithTemplate(app, templaterConfig, selected, "notes/2026-11-16.md", validateDailyTemplate(app, templaterConfig));
    assert.equal(file.path, "notes/renamed.md"); assert.equal(wrote, 1); assert.equal(nativeCalls, 1);
    nativeResult = undefined;
    await assert.rejects(createDailyNoteWithTemplate(app, templaterConfig, selected, "notes/2026-11-16.md", template));
    assert.equal(wrote, 1); // Never fall back to creating an empty file after a script failure.
    assert.throws(() => validateDailyTemplate(app, { ...config, templatePath: "missing.md" }));
    assert.throws(() => validateDailyTemplate({ vault: app.vault }, templaterConfig));
    assert.equal(validateDailyTemplate({ vault: app.vault }, { ...templaterConfig, type: "canvas" }), null);
    let collided = false;
    const racingApp = { vault: { ...app.vault,
        getAbstractFileByPath: () => collided ? new TFile("notes/2026-11-16.md") : undefined,
        cachedRead: async () => { collided = true; return "template"; }
    } };
    await assert.rejects(createDailyNoteWithTemplate(racingApp, config, selected, "notes/2026-11-16.md", template));
    assert.equal(wrote, 1);
    console.log("PASS: core template variables and format settings, selected-date semantics, native Templater invocation/rename/cancellation, disabled plugin/missing template, non-Markdown isolation and read-time collision guard.");
}
testTemplates().catch(error => { console.error(error); process.exitCode = 1; });

function testColumnAlignment() {
    const main = ts.createSourceFile("main.ts", fs.readFileSync(path.join(__dirname, "../main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const options = main.statements.find(item => ts.isVariableStatement(item) && item.declarationList.declarations.some(decl => decl.name.getText(main) === "COLUMN_CLICK_ALIGNMENT_OPTIONS"));
    const clean = main.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === "cleanColumnClickAlignment");
    const view = main.statements.find(item => ts.isClassDeclaration(item) && item.name?.text === "FolderColumnNavigatorView");
    const align = view.members.find(item => item.name?.getText(main) === "alignColumnsAfterActivation");
    const { cleanColumnClickAlignment, View } = vm.runInNewContext(ts.transpileModule(
        `${options.getText(main)}\n${clean.getText(main)}\nclass View {${align.getText(main)}}; ({cleanColumnClickAlignment,View})`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText);
    assert.equal(cleanColumnClickAlignment(undefined), "current-left");
    assert.equal(cleanColumnClickAlignment(undefined, false), "none");
    assert.equal(cleanColumnClickAlignment(undefined, true), "current-left");
    assert.equal(cleanColumnClickAlignment("next-left", false), "next-left");
    const cases = [["current-left", 3, 3, 300], ["keep-one", 3, 2, 200], ["keep-two", 3, 1, 100],
        ["next-left", 3, 4, 400], ["next-right", 7, 8, 400], ["keep-two", 0, 0, 0], ["none", 3, null, null]];
    for (const [mode, clicked, expectedIndex, expectedLeft] of cases) {
        const instance = new View(); let scrolled = null; let index = null;
        instance.plugin = { settings: { columnClickAlignment: mode } };
        instance.columnsEl = {
            scrollLeft: 300, clientLeft: 0, clientWidth: 500,
            getBoundingClientRect: () => ({ left: 100 }),
            querySelector: selector => {
                index = Number(/="(\d+)"/.exec(selector)[1]);
                return { getBoundingClientRect: () => ({ left: index * 100 - 200, right: index * 100 - 100 }) };
            },
            scrollTo: options => { assert.equal(options.top, undefined); assert.equal(options.behavior, "smooth"); scrolled = options.left; }
        };
        instance.alignColumnsAfterActivation(clicked);
        assert.equal(index, expectedIndex, mode); assert.equal(scrolled, expectedLeft, mode);
    }
    console.log("PASS: all six horizontal alignment modes, insufficient-left-columns fallback, no vertical scrolling and legacy toggle migration.");
}
testColumnAlignment();

async function testDefaultProfile() {
    const main = ts.createSourceFile("main.ts", fs.readFileSync(path.join(__dirname, "../main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const declarations = main.statements.filter(node => ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)).map(node => node.getText(main)).join("\n");
    const pluginClass = main.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FolderColumnNavigator");
    const load = pluginClass.members.find(node => node.name?.getText(main) === "loadSettings").getText(main);
    const { Plugin, defaults } = vm.runInNewContext(ts.transpileModule(`${declarations}\nclass Plugin {${load}}; ({Plugin,defaults:DEFAULT_SETTINGS})`,
        { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
        { DEFAULT_DAILY_NOTE, cleanDailyNoteConfig, TFile, TFolder });
    const make = data => {
        const plugin = new Plugin(); plugin.loadData = async () => data;
        plugin.getRootFolders = () => [];
        plugin.cleanPathList = value => Array.isArray(value) ? value : [];
        return plugin;
    };
    const fresh = make(null); await fresh.loadSettings();
    assert.deepEqual(JSON.parse(JSON.stringify(fresh.settings)), JSON.parse(JSON.stringify(defaults)));
    const expected = { wrapItemNames: true, showItemSeparators: false, alignFileTreeNames: true,
        showFolderNotes: true, hideFileExtensions: true, showRootFoldersAtTop: true, rootFolderVisibleRows: 8,
        verticalTreeEnabled: true, openFoldersInCurrentColumn: true, currentColumnStart: 3,
        folderIconStyle: "chevron", fileIconStyle: "none", showCalendarAtBottom: false,
        calendarMatchCreatedDate: false, calendarMatchModifiedDate: false };
    for (const [key, value] of Object.entries(expected)) assert.equal(fresh.settings[key], value, key);
    for (const key of ["hiddenRootPaths", "customFolders", "customFolderNames", "rootFolderOrder", "navigationOrder", "customItemOrders", "columnWidths", "calendarCreatedNotes", "calendarSearchPaths", "pinnedGroups"])
        assert.equal(Object.keys(fresh.settings[key]).length, 0, key);
    const old = make({ openFoldersInCurrentColumn: false, currentColumnStart: 2, showRootFoldersAtTop: false,
        rootFolderVisibleRows: 2, showCalendarAtBottom: true, showItemSeparators: true, calendarMatchCreatedDate: true });
    await old.loadSettings();
    assert.equal(old.settings.openFoldersInCurrentColumn, false); assert.equal(old.settings.currentColumnStart, 2);
    assert.equal(old.settings.showRootFoldersAtTop, false); assert.equal(old.settings.rootFolderVisibleRows, 2);
    assert.equal(old.settings.showCalendarAtBottom, true); assert.equal(old.settings.showItemSeparators, true);
    assert.equal(old.settings.calendarMatchCreatedDate, true);
    console.log("PASS: fresh installation uses portable personal defaults, private vault state remains empty, and explicit existing preferences are preserved.");
}
testDefaultProfile().catch(error => { console.error(error); process.exitCode = 1; });
