// Settings UI regression harness: no real vault writes or browser are required.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript"), moment = require("moment");
class Element {
    constructor(cls = "", text = "") { this.cls = cls; this.text = text; this.children = []; this.parentElement = null; this.scrollTop = 0; this.scrollLeft = 0; this.events = {}; }
    get isConnected() { return this.parentElement ? this.parentElement.isConnected : Boolean(this.attached); }
    createEl(_tag, options = {}) { const el = new Element(options.cls, options.text); this.append(el); return el; }
    createDiv(options) { return this.createEl("div", typeof options === "string" ? { cls: options } : options); }
    createSpan(options) { return this.createEl("span", options); }
    append(el) { el.remove(); el.parentElement = this; this.children.push(el); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(el => el !== this); this.parentElement = null; }
    empty() { this.children.forEach(el => { el.parentElement = null; }); this.children = []; }
    querySelectorAll() { return this.children.filter(el => el.cls === "fcn-daily-editor"); }
    setText(text) { this.text = text; }
    setAttribute() {}
    addClass() {}
    removeClass() {}
    toggleClass() {}
    addEventListener(name, fn) { this.events[name] = fn; }
}
const settings = [];
function control() { return {
    inputEl: new Element(), options: {}, setValue(value) { this.value = value; return this; },
    setDisabled(value) { this.disabled = value; return this; }, setPlaceholder() { return this; },
    setButtonText(value) { this.label = value; return this; }, setCta() { return this; },
    setIcon() { return this; }, setTooltip() { return this; },
    addOption(value, name) { this.options[value] = name; return this; }, addOptions(options) { Object.assign(this.options, options); return this; },
    onChange(fn) { this.change = fn; return this; }, onClick(fn) { this.click = fn; return this; }
}; }
class Setting {
    constructor(container) { this.settingEl = container.createDiv("setting-item"); this.controls = []; settings.push(this); }
    setName(name) { this.name = name; return this; } setDesc(text) { this.desc = text; return this; } setHeading() { return this; }
    addText(fn) { const c = control(); this.controls.push(c); fn(c); return this; }
    addToggle(fn) { return this.addText(fn); } addDropdown(fn) { return this.addText(fn); }
    addButton(fn) { return this.addText(fn); } addExtraButton(fn) { return this.addText(fn); }
}
const exportsObject = {}, frames = [];
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../daily-note.ts"), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText, { exports: exportsObject, Error,
    require: () => ({ moment, Setting, Modal: class {}, Notice: class {}, AbstractInputSuggest: class {}, TFile: class {}, TFolder: class {} }),
    window: { requestAnimationFrame: fn => frames.push(fn) }
});
const { renderDailyNoteEditor, DEFAULT_DAILY_NOTE, preserveSettingsScroll } = exportsObject;
const walk = el => [el, ...el.children.flatMap(walk)];
const visibleSettings = () => settings.filter(s => s.settingEl.isConnected);
async function run() {
    const container = new Element(); container.attached = true; container.scrollTop = 540;
    const saved = [];
    const render = () => renderDailyNoteEditor(container, DEFAULT_DAILY_NOTE, async config => saved.push(config), () => {}, {});
    render(); render(); render();
    assert.equal(container.children.filter(el => el.cls === "fcn-daily-editor").length, 1);
    assert.equal(visibleSettings().filter(s => s.name === "常用方案").length, 1);
    assert.equal(container.scrollTop, 540);
    const preset = visibleSettings().find(s => s.name === "常用方案");
    assert.equal(Object.keys(preset.controls[0].options).join(","), "按年月,平铺日期,按年月周");
    assert.equal(preset.controls[0].value, "按年月");
    assert.match(preset.desc, /选择方案后仍可自由编辑/);
    const root = container.children[0];
    const previewDate = visibleSettings().find(s => s.name === "预览日期");
    assert.ok(root.children.indexOf(previewDate.settingEl) < root.children.findIndex(el => el.cls === "fcn-daily-preview"));
    const labels = walk(root).filter(el => el.cls === "fcn-daily-palette-label").map(el => el.text);
    assert.equal([...new Set(labels)].sort().join(","), ["基础", "固定文字", "日期相关"].sort().join(","));
    assert.ok(walk(root).some(el => el.text === "+ 周开始"));
    assert.ok(walk(root).some(el => el.text === "+ 周结束"));
    preset.controls[0].change("按年月周");
    assert.match(walk(root).find(el => el.cls === "fcn-daily-preview").text, /\d{2}-\d{2}-\d{2}-\d{2}/);
    const saveButton = visibleSettings().flatMap(s => s.controls).find(c => c.label === "保存创建规则");
    saveButton.click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(saved[0].directory, "{{date:YYYY}}/{{date:MM}}/{{weekStart:MM-DD}}-{{weekEnd:MM-DD}}");
    const toggle = visibleSettings().find(s => s.name === "启用每日笔记创建").controls[0];
    toggle.change(false); await new Promise(resolve => setImmediate(resolve));
    assert.equal(visibleSettings().length, 1); assert.equal(saved.at(-1).enabled, false);
    visibleSettings()[0].controls[0].change(true); await new Promise(resolve => setImmediate(resolve));
    assert.ok(visibleSettings().some(s => s.name === "常用方案"));
    const inner = container.createDiv(); inner.scrollTop = 28;
    preserveSettingsScroll(inner, () => { inner.scrollTop = 0; container.scrollTop = 0; });
    assert.equal(inner.scrollTop, 28); assert.equal(container.scrollTop, 540);
    frames.splice(0).forEach(fn => fn());
    assert.equal(container.scrollTop, 540);
    const failureContainer = new Element(); failureContainer.attached = true;
    renderDailyNoteEditor(failureContainer, DEFAULT_DAILY_NOTE, async () => { throw Error("save denied"); }, () => {}, {});
    const failureToggle = visibleSettings().filter(s => s.name === "启用每日笔记创建").at(-1).controls[0];
    failureToggle.change(false); await new Promise(resolve => setImmediate(resolve));
    assert.equal(visibleSettings().filter(s => s.name === "启用每日笔记创建").at(-1).controls[0].value, true);
    const main = ts.createSourceFile("main.ts", fs.readFileSync(path.join(__dirname, "../main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    let calendar;
    const visit = node => {
        if (ts.isObjectLiteralExpression(node) && node.properties.some(p => p.name?.getText(main) === "name" && p.initializer?.text === "日历")) calendar = node;
        ts.forEachChild(node, visit);
    };
    visit(main);
    const groups = calendar.properties.find(p => p.name?.getText(main) === "items").initializer.elements;
    const headings = groups.map(group => group.properties.find(p => p.name?.getText(main) === "heading")?.initializer.text);
    assert.equal(headings.at(-1), "创建每日笔记");
    assert.equal(headings.filter(name => name === "创建每日笔记").length, 1);
    console.log("PASS: idempotent rendering, preserved scroll, disable/hide and re-enable, preset defaults/order/range, week chips, preview ordering and exactly three palette categories.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
