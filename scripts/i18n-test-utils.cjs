const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");

/** Load the real translation module with only Obsidian's language API mocked. */
function loadI18n(initialLanguage = "zh") {
    let language = initialLanguage;
    const cache = new Map();
    function load(name) {
        if (cache.has(name)) return cache.get(name);
        const exports = {};
        cache.set(name, exports);
        const text = fs.readFileSync(path.join(__dirname, "..", name + ".ts"), "utf8");
        vm.runInNewContext(ts.transpileModule(text, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
        }).outputText, { exports, Intl, require: target => target === "obsidian"
            ? { getLanguage: () => language } : load(target.replace(/^\.\//, "")) });
        return exports;
    }
    return { ...load("i18n"), setLanguage: value => { language = value; }, catalog: load("locales/en").en,
        singularCatalog: load("locales/en").enSingular };
}
module.exports = { loadI18n };
