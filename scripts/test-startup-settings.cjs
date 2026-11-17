// Run the actual layout-ready callback and event batching methods without a
// live vault. The settings tab starts with the empty pre-discovery snapshot.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), ts = require("typescript");
const file = ts.createSourceFile("main.ts", fs.readFileSync(path.join(__dirname, "../main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
const cls = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FolderColumnNavigator");
const method = name => cls.members.find(node => node.name?.getText(file) === name).getText(file);
let ready;
function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "onLayoutReady") ready = node.arguments[0];
    ts.forEachChild(node, visit);
}
visit(cls.members.find(node => node.name?.getText(file) === "onload"));
assert.ok(ready && ts.isArrowFunction(ready));
let timerId = 0;
const timers = new Map();
const Plugin = vm.runInNewContext(ts.transpileModule(`class Plugin {
    loaded() ${ready.body.getText(file)}
    ${method("scheduleVaultRefresh")}
    ${method("refreshViews")}
}; Plugin`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    TFile: class {}, console,
    window: { setTimeout(fn, delay) { assert.equal(delay, 150); timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } }
});
const listeners = {};
let forcedUpdates = 0, visibleUpdates = 0, viewUpdates = 0, registrations = 0;
const folders = ["笔记", "日记", "资料"];
let cachedFolders = [];
const plugin = new Plugin();
plugin.vaultRefreshTimer = null;
plugin.settings = { calendarCreatedNotes: {} };
plugin.settingsTab = {
    update() { forcedUpdates++; cachedFolders = [...folders]; },
    updateIfVisible() { visibleUpdates++; /* Hidden tab deliberately stays cached. */ }
};
plugin.views = new Set([{ refresh() { viewUpdates++; } }]);
plugin.registerEvent = () => { registrations++; };
plugin.app = {
    vault: {
        on(name, callback) { listeners[name] = callback; return {}; },
        getAllLoadedFiles() { throw Error("Unexpected full vault scan"); },
        getAbstractFileByPath() { throw Error("No daily associations to look up"); }
    },
    metadataCache: { on(name, callback) { listeners[name] = callback; return {}; } }
};
plugin.loaded();
assert.deepEqual(cachedFolders, folders);
assert.equal(forcedUpdates, 1, "Hidden startup definitions must be refreshed once");
assert.equal(registrations, 5);
for (let index = 0; index < 3000; index++) listeners[["create", "delete", "resolved"][index % 3]]();
assert.equal(timers.size, 1, "Startup and later file bursts must share one pending timer");
const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn());
assert.equal(viewUpdates, 1);
assert.equal(visibleUpdates, 1);
assert.equal(forcedUpdates, 1, "Later batches must not force hidden settings refreshes");
const unloaded = new Plugin(); unloaded.settingsTab = null;
unloaded.registerEvent = () => { throw Error("Unloaded plugin must not register events"); };
unloaded.loaded();
assert.equal(forcedUpdates, 1);
console.log("PASS: hidden startup settings refreshed once after vault load; 3,000 filesystem/metadata events remain one debounced refresh; unloaded callback does nothing.");
