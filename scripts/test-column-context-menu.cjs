// Exercise the actual event binding without requiring a running Obsidian vault.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript");
const source = ts.createSourceFile("main.ts", fs.readFileSync(path.join(__dirname, "../main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
let method;
function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === "enableDirectoryContextMenu") method = node.getText(source);
    ts.forEachChild(node, visit);
}
visit(source);
assert.ok(method);
class Element {
    constructor(excluded = false) { this.excluded = excluded; }
    instanceOf(type) { return this instanceof type; }
    closest(selector) {
        for (const name of [".fcn-navigation-item", ".fcn-file-item", ".fcn-item-group-header", "button", "[role='separator']"]) assert.ok(selector.includes(name));
        return this.excluded ? this : null;
    }
    addEventListener(name, handler) { assert.equal(name, "contextmenu"); this.handler = handler; }
    focus(options) { assert.equal(options.preventScroll, true); this.focused = true; }
}
const View = vm.runInNewContext(ts.transpileModule(`class View { ${method} }; View`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, { Element });
const view = new View();
let headers = 0;
const menus = [];
view.renderHeader = () => headers++;
view.showFolderContextMenu = (...args) => menus.push(args);
function fire(list, target) {
    const event = { targetNode: target, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    list.handler(event);
    return event;
}
// Cover both root-navigation layouts and arbitrary-depth columns. The bound
// folder is independent of the previously selected row or keyboard column.
for (const [index, folderPath] of ["/", "/", "/", "Projects", "Projects/Design", "Projects/Design/Components"].entries()) {
    const list = new Element(), folder = { path: folderPath };
    const columnIndex = index < 2 ? undefined : index - 2;
    view.enableDirectoryContextMenu(list, folder, columnIndex);
    assert.equal(list.tabIndex, -1);
    // Container background, list padding, empty-state text, title and wrappers.
    for (const target of [list, new Element(), new Element(), new Element(), new Element()]) {
        const previousColumn = view.activeColumnIndex;
        const event = fire(list, target);
        assert.equal(event.prevented, true);
        assert.equal(event.stopped, true);
        assert.equal(view.activeColumnIndex, columnIndex ?? previousColumn);
        assert.equal(list.focused, true);
        const menu = menus.at(-1);
        assert.equal(menu.length, 3, "Already-open directory must not receive child-row open semantics");
        assert.equal(menu[0], folder);
        assert.equal(menu[1], list);
        assert.equal(menu[2], event);
    }
    const count = menus.length;
    // Item/group menus and toolbar/back/filter/resize controls remain untouched.
    for (const target of [new Element(true), new Element(true), new Element(true), new Element(true), null]) {
        const event = fire(list, target);
        assert.equal(event.prevented, false);
        assert.equal(event.stopped, false);
    }
    assert.equal(menus.length, count);
}
assert.equal(headers, 20);
// Bind on full surfaces, not just short list content; this also covers column 0.
const text = source.getFullText();
assert.ok(text.includes("this.enableDirectoryContextMenu(this.topRootFolderPane, this.plugin.app.vault.getRoot())"));
assert.ok(text.includes("this.enableDirectoryContextMenu(navigationPane, this.plugin.app.vault.getRoot())"));
assert.ok(text.includes("this.enableDirectoryContextMenu(column, folder, columnIndex)"));
console.log("PASS: top/side root navigation and all-depth columns cover headers, padding and empty states; child/group/control menus remain intact without scrolling.");
