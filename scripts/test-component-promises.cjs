// Native Obsidian components are fluent thenables, not ordinary JS objects.
// Reproduce the old renderer hang only in a disposable worker so the test
// runner remains responsive and can terminate the infinite microtask chain.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { Worker } = require("node:worker_threads"), ts = require("typescript");
const file = ts.createSourceFile("daily-note.ts", fs.readFileSync(path.join(__dirname, "../daily-note.ts"), "utf8"), ts.ScriptTarget.Latest, true);
let cleanup;
function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "finally" &&
        node.arguments[0]?.getText(file).includes("button.setDisabled(false)")) cleanup = node.arguments[0].getText(file);
    ts.forEachChild(node, visit);
}
visit(file);
assert.ok(cleanup, "Save cleanup callback not found");
function run(callback) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(`
            const {parentPort} = require('node:worker_threads');
            let assimilations = 0;
            const button = {
                setDisabled(value) { this.disabled = value; return this; },
                then(callback) { assimilations++; callback(this); return this; }
            };
            parentPort.postMessage({ready:true});
            Promise.resolve().finally(${callback}).then(() => parentPort.postMessage({done:true, assimilations, disabled:button.disabled}));
        `, { eval: true });
        let timer;
        worker.on("message", message => {
            if (message.ready) timer = setTimeout(() => { void worker.terminate().then(() => resolve({ hung: true })); }, 250);
            if (message.done) { clearTimeout(timer); void worker.terminate().then(() => resolve(message)); }
        });
        worker.on("error", error => { clearTimeout(timer); reject(error); });
    });
}
(async () => {
    assert.equal((await run("() => button.setDisabled(false)")).hung, true, "Legacy callback must reproduce native thenable loop");
    const fixed = await run(cleanup);
    assert.equal(fixed.done, true, "Actual cleanup callback must finish");
    assert.equal(fixed.assimilations, 0);
    assert.equal(fixed.disabled, false);
    console.log("PASS: old native-component cleanup reproduces infinite microtasks in an isolated worker; actual save cleanup returns void and completes.");
})().catch(error => { console.error(error); process.exitCode = 1; });
