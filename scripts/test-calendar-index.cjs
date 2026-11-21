const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict"), ts = require("typescript");
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../calendar-index.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, { exports: exportsObject, setTimeout, Date, Error });
const { CalendarFileIndex } = exportsObject;
async function run() {
    const count = 173000;
    const files = new Map(Array.from({ length: count }, (_, i) => [`notes/${i}.md`, { path: `notes/${i}.md`, dates: ["2026-11-17", "2026-11-17"] }]));
    let enumerations = 0, matches = 0, yields = 0, heartbeats = 0;
    const heartbeat = setInterval(() => { heartbeats++; }, 5);
    const collator = new Intl.Collator(undefined, { numeric: true });
    const index = new CalendarFileIndex(function* () { enumerations++; yield* files.values(); }, file => { matches++; return file.dates; },
        (a, b) => collator.compare(a.path, b.path), () => { yields++; return new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(enumerations, 0, "Index is lazy");
    const started = Date.now();
    const [month, week] = await Promise.all([index.query("2026-11-01", "2026-12-01"), index.query("2026-11-16", "2026-11-23")]);
    clearInterval(heartbeat);
    assert.equal(enumerations, 1); assert.equal(matches, count);
    assert.equal(month.get("2026-11-17").length, count); assert.equal(week.get("2026-11-17").length, count);
    assert.equal(month.get("2026-11-17")[2].path, "notes/2.md");
    assert.ok(yields > 1 && heartbeats > 1, "Large build and sorting must yield to timers");
    await index.query("2026-10-01", "2026-11-01");
    await index.query("2026-11-01", "2026-12-01");
    assert.equal(enumerations, 1); assert.equal(matches, count, "Month navigation must not rematch files");
    const changed = files.get("notes/10.md"); changed.dates = ["2026-11-18"]; index.update(changed);
    const next = await index.query("2026-11-01", "2026-12-01");
    assert.equal(matches, count + 1, "Only changed file is rematched");
    assert.equal(next.get("2026-11-17").length, count - 1); assert.equal(next.get("2026-11-18")[0], changed);
    files.delete(changed.path); const old = changed.path; changed.path = "moved/new.md"; files.set(changed.path, changed); index.update(changed, old);
    await index.query("2026-11-01", "2026-12-01");
    assert.equal(matches, count + 2);
    index.update(changed); index.remove("moved", true); files.delete(changed.path);
    const removed = await index.query("2026-11-01", "2026-12-01");
    assert.equal(removed.has("2026-11-18"), false, "Folder removal must not resurrect queued children");
    const beforeReset = matches;
    index.reset(file => { matches++; return ["2026-12-01"]; });
    const reset = await index.query("2026-12-01", "2027-01-01");
    assert.equal(reset.get("2026-12-01").length, count - 1);
    assert.equal(matches - beforeReset, count - 1);
    index.dispose(); await assert.rejects(index.query("2026-11-01", "2026-12-01"), /disposed/);
    const cancellation = new CalendarFileIndex(() => files.values(), file => file.dates, (a, b) => a.path.localeCompare(b.path));
    const obsolete = cancellation.query("2026-11-01", "2026-12-01");
    cancellation.reset(() => ["2026-12-02"]);
    assert.equal((await obsolete).size, 0, "Cancelled rebuild cannot publish the old rule result");
    cancellation.dispose();
    // Force cooperative sorting to yield, then flush a file update from a
    // second view mid-sort. The older task must not cache a stale bucket.
    const racingExports = {}; let clock = 0;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../calendar-index.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, { exports: racingExports, setTimeout, Error, Date: { now: () => ++clock } });
    const raceFiles = Array.from({length:3000}, (_,i) => ({path:`race/${i}.md`, date:'2026-11-17'}));
    let racing, injected = false, other;
    racing = new racingExports.CalendarFileIndex(() => raceFiles, file => [file.date], (a,b) => a.path.localeCompare(b.path), async () => {
        if (racing.initialized && !injected) {
            injected = true; raceFiles[0].date = '2026-11-18'; racing.update(raceFiles[0]);
            other = racing.query('2026-11-01', '2026-12-01');
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    });
    const raced = await racing.query('2026-11-01', '2026-12-01');
    assert.equal(injected, true);
    const otherResult = await other;
    assert.equal(raced.get('2026-11-17').length, 2999); assert.equal(raced.get('2026-11-18')[0], raceFiles[0]);
    assert.equal(otherResult.get('2026-11-17').length, 2999);
    racing.dispose();
    const source = ts.createSourceFile("main.ts", fs.readFileSync(path.join(__dirname, "../main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FolderColumnNavigator");
    const helpers = ["formatCalendarDate", "calendarDateKeyFromParts", "extractCalendarDateKeys", "filenamePatternToDateMatcher"];
    const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && helpers.includes(node.name?.text)).map(node => node.getText(source)).join("\n");
    const methods = ["getCalendarIndex", "configureCalendarIndex", "queryCalendarDates"].map(name => cls.members.find(node => node.name?.getText(source) === name).getText(source)).join("\n");
    class TFile { constructor(path, frontmatter = {}) { this.path = path; this.basename = path.split('/').pop().replace(/\.[^.]+$/, ''); this.extension = path.split('.').pop(); this.stat = { ctime: 0, mtime: 0 }; this.frontmatter = frontmatter; } }
    class TFolder { constructor(children) { this.children = children; } }
    const Plugin = vm.runInNewContext(ts.transpileModule(`${functions}\nclass Plugin {${methods}}; Plugin`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, { CalendarFileIndex, Intl, TFile, TFolder, Date, Set, Map });
    const examples = [new TFile("notes/2026-11-17-demo.md", { updated: "2026-11-17" }), new TFile("notes/a.md", { updated: "2026-11-18" }),
        new TFile("elsewhere/manual.pdf"), new TFile("hidden/2026-11-17.md")];
    const p = new Plugin();
    p.calendarIndex = null; p.calendarIndexRules = ""; p.calendarIndexAssociations = {};
    p.settings = { hiddenPatterns: [], calendarSearchPaths: ['notes'], calendarFileExtensions: ['md'], calendarMatchCreatedDate: false,
        calendarMatchModifiedDate: false, calendarMatchFrontmatter: true, calendarFrontmatterKeys: ['updated'], calendarMatchFilename: true,
        calendarFilenamePatterns: ['YYYY-MM-DD*'], calendarCreatedNotes: { 'elsewhere/manual.pdf': '2026-11-17' } };
    p.app = { vault: { getRoot: () => new TFolder([new TFolder(examples)]), getAbstractFileByPath: path => examples.find(file => file.path === path),
        getFiles() { throw Error('Must traverse lazily, not allocate a full file list'); } }, metadataCache: { getFileCache: file => ({frontmatter:file.frontmatter}) } };
    p.isHiddenByPattern = path => path.startsWith('hidden/');
    const actual = p.getCalendarIndex();
    const original = await actual.query('2026-11-01', '2026-12-01');
    assert.equal(original.get('2026-11-17').length, 2, 'Filename/frontmatter deduplicate; explicit creation association bypasses scope/type');
    assert.equal(original.get('2026-11-18').length, 1);
    const version = actual.version;
    p.settings.fileNameFontSize = 20; p.configureCalendarIndex();
    assert.equal(actual.version, version, 'Visual settings do not invalidate index');
    examples[1].frontmatter.updated = '2026-11-19'; actual.update(examples[1]);
    assert.equal((await actual.query('2026-11-01', '2026-12-01')).get('2026-11-19')[0], examples[1]);
    p.settings.calendarCreatedNotes['notes/a.md'] = '2026-11-20'; p.configureCalendarIndex();
    assert.equal((await actual.query('2026-11-01', '2026-12-01')).get('2026-11-20')[0], examples[1]);
    p.settings.calendarMatchFilename = false; p.settings.calendarMatchFrontmatter = false; p.configureCalendarIndex();
    const changedRules = await actual.query('2026-11-01', '2026-12-01');
    assert.equal(changedRules.get('2026-11-17').length, 1); assert.equal(changedRules.has('2026-11-19'), false);
    actual.dispose();
    let readyResolve, queryCalls = 0;
    const waiting = new Plugin();
    waiting.calendarLayoutReady = new Promise(resolve => { readyResolve = resolve; });
    waiting.getCalendarIndex = () => ({ query: async () => { queryCalls++; return new Map(); } });
    const early = waiting.queryCalendarDates('2026-11-01', '2026-12-01');
    await new Promise(resolve => setImmediate(resolve)); assert.equal(queryCalls, 0, 'Restored calendar must wait for vault loading');
    readyResolve(); await early; assert.equal(queryCalls, 1);
    const viewClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FolderColumnNavigatorView');
    const viewMethods = ['refreshCalendarDateMatches', 'getCalendarWeekStart'].map(name => viewClass.members.find(node => node.name?.getText(source) === name).getText(source)).join('\n');
    const View = vm.runInNewContext(ts.transpileModule(`${functions}\nclass View {${viewMethods}}; View`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, { Date, Map, t: require("./i18n-test-utils.cjs").loadI18n().t, console: { error() {} } });
    const v = new View(), requests = [];
    let currentDate = new Date(2026, 10, 17), paints = 0;
    v.calendar = { getDate: () => currentDate }; v.calendarExpanded = true; v.isStandaloneCalendar = true;
    v.calendarMatchKey = ''; v.calendarMatchRequest = 0;
    v.updateCalendarDateCells = () => {}; v.renderCalendarMatchedFiles = () => {};
    v.finishCalendarDateMatches = () => { paints++; };
    v.plugin = { getCalendarIndex: () => ({version:1}), queryCalendarDates: () => new Promise((resolve, reject) => requests.push({resolve,reject})), settings: {} };
    v.refreshCalendarDateMatches(); v.refreshCalendarDateMatches();
    assert.equal(requests.length, 1, 'Repeated refresh shares one pending range request');
    currentDate = new Date(2026, 11, 17); v.refreshCalendarDateMatches();
    requests[0].resolve(new Map([['2026-11-17', []]])); await new Promise(resolve => setImmediate(resolve));
    assert.equal(paints, 0, 'Old month result must not paint after navigation');
    requests[1].resolve(new Map([['2026-12-17', []]])); await new Promise(resolve => setImmediate(resolve));
    assert.equal(paints, 1); assert.equal(v.calendarDateMatches.has('2026-12-17'), true);
    currentDate = new Date(2027, 0, 1); v.refreshCalendarDateMatches();
    requests[2].reject(Error('retry')); await new Promise(resolve => setImmediate(resolve));
    assert.equal(v.calendarMatching, false); assert.ok(v.calendarMatchError);
    v.refreshCalendarDateMatches(); assert.equal(requests.length, 4, 'Error allows range retry');
    v.calendar = null; v.calendarMatchRequest++;
    requests[3].resolve(new Map()); await new Promise(resolve => setImmediate(resolve));
    assert.equal(paints, 1, 'Closed views ignore pending results');
    console.log('PASS: restored calendar waits for vault ready; duplicate requests, stale month results, retry and closed-view cancellation are guarded.');
    console.log('PASS: actual plugin matcher preserves pinyin-independent filename/frontmatter dates, hidden/scope/type rules, explicit note associations, metadata deltas and visual-setting cache reuse.');
    console.log(`PASS: ${count.toLocaleString()} files indexed once, cooperative build/sort (${yields} task yields, ${heartbeats} timer heartbeats), shared month/week cache, no rescan on navigation, single-file deltas, rename/delete, rule reset and cancellation (${Date.now() - started}ms total stress run).`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
