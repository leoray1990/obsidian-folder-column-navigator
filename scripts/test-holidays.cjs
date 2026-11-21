// Real offline data and injected transport; no network or live vault is used.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const root = path.join(__dirname, "..");
const i18n = require("./i18n-test-utils.cjs").loadI18n();
function load(file, requireModule) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText, { exports, require: name => name === "./i18n" ? i18n : requireModule(name), Date, Error, Map, Set });
    return exports;
}
const holidays = load("holidays.ts", name => require(path.join(root, name)));
const daily = load("daily-note.ts", () => ({ moment: require("moment"), Modal: class {}, AbstractInputSuggest: class {} }));
const { MainlandHolidayCalendar, holidayDateKey, validateHolidayYear, fetchHolidayYear, cleanHolidayCache } = holidays;
const calendar = new MainlandHolidayCalendar();
const date = value => new Date(`${value}T12:00:00`);
const last = value => holidayDateKey(calendar.lastWorkdayOfWeek(date(value)));
assert.equal(last("2026-11-17"), "2026-11-20");
assert.equal(last("2026-01-01"), "2026-01-04"); // Sunday adjusted workday.
assert.equal(last("2026-02-27"), "2026-02-28"); // Saturday adjusted workday.
assert.equal(last("2026-10-01"), "2026-09-30"); // Friday is on holiday.
assert.equal(last("2025-12-31"), "2026-01-04"); // Both annual schedules apply.
assert.throws(() => last("2026-02-18"), /没有工作日/);
assert.throws(() => last("2030-01-02"), /尚未收录/);
assert.equal(calendar.get("2026-10-01").name, "国庆节");
assert.equal(calendar.get("2026-10-10").isOffDay, false);
assert.equal(calendar.getCalendarDay("2026-11-21").name, "周末");
assert.equal(calendar.getCalendarDay("2026-11-22").isOffDay, true);
assert.equal(calendar.getCalendarDay("2026-11-20"), undefined);
assert.equal(calendar.getCalendarDay("2026-10-10").isOffDay, false);
assert.equal(calendar.getCalendarDay("2026-10-03").name, "国庆节");
assert.equal(calendar.getCalendarDay("2030-01-05").unknownSchedule, true);
assert.equal(calendar.getCalendarDay("bad-date"), undefined);
const resolve = value => calendar.lastWorkdayOfWeek(value);
assert.equal(daily.expandDailyTemplate("{{weekLastWorkday:YYYY-MM-DD}}", date("2026-01-01"), resolve), "2026-01-04");
assert.equal(daily.expandDailyTemplate("{{weekFriday:YYYY-MM-DD}}", date("2026-01-01"), resolve), "2026-01-02");
assert.equal(daily.dailyNotePath({ ...daily.DEFAULT_DAILY_NOTE, directory: "{{weekLastWorkday:MM-DD}}", name: "{{weekLastWorkday:YYYY-MM-DD}}" }, date("2026-01-01"), undefined, resolve), "日记/01-04/2026-01-04.md");
assert.throws(() => daily.expandDailyTemplate("{{weekLastWorkday:DD}}", date("2026-01-01")), /节假日/);
const data = require("../data/holidays/2026.json");
assert.equal(validateHolidayYear(data, 2026).year, 2026);
for (const invalid of [null, {}, { ...data, year: 2025 }, { ...data, days: [] },
    { ...data, days: [...data.days, data.days[0]] }, { ...data, papers: ["javascript:alert(1)"] },
    { ...data, days: data.days.map((day, index) => index ? day : { ...day, date: "2026-02-30" }) }]) {
    assert.throws(() => validateHolidayYear(invalid, 2026));
}
assert.equal(Object.keys(cleanHolidayCache({ 2026: { data, updatedAt: "invalid" } })).length, 0);
const revised = { ...data, days: data.days.map(day => day.date === "2026-01-04" ? { ...day, isOffDay: true } : day) };
const cache = { 2026: { data: revised, updatedAt: new Date().toISOString() } };
assert.equal(new MainlandHolidayCalendar(cache).get("2026-01-04").isOffDay, true);
assert.equal(calendar.get("2026-01-04").isOffDay, false); // No mutable singleton.
async function run() {
    let requests = 0;
    const fetch = async url => { requests++; assert.equal(url, `${holidays.HOLIDAY_DATA_URL}2026.json`); return data; };
    await assert.rejects(fetchHolidayYear(2026, false, fetch), /联网/);
    await assert.rejects(fetchHolidayYear(NaN, true, fetch), /年份/);
    assert.equal(requests, 0);
    assert.equal((await fetchHolidayYear(2026, true, fetch)).year, 2026);
    assert.equal(requests, 1);
    await assert.rejects(fetchHolidayYear(2026, true, async () => ({ year: 2026 })), /不完整/);
    await assert.rejects(fetchHolidayYear(2026, true, async () => { throw new Error("offline"); }), /offline/);
    // Exercise the real plugin update method: saves atomically, never refreshes
    // the whole vault, and leaves both cache and service intact after failure.
    const source = ts.createSourceFile("main.ts", fs.readFileSync(path.join(root, "main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const plugin = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FolderColumnNavigator");
    const method = plugin.members.find(node => node.name?.getText(source) === "updateHolidayData").getText(source);
    let failRequest = false;
    const Plugin = vm.runInNewContext(ts.transpileModule(`class Plugin { ${method} }; Plugin`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, { fetchHolidayYear, MainlandHolidayCalendar, setTimeout, clearTimeout, Date, Error, t: i18n.t,
        requestUrl: async () => { if (failRequest) throw new Error("network"); return { status: 200, text: JSON.stringify(data) }; }
    });
    const instance = new Plugin();
    instance.settings = { holidayOnlineUpdate: true, holidayCache: {} };
    instance.holidays = calendar;
    let refreshCount = 0;
    instance.views = new Set([{ refreshDailyNoteCreationUi() { refreshCount++; } }]);
    instance.saveData = async () => {};
    await instance.updateHolidayData(2026);
    assert.equal(refreshCount, 1);
    const savedCache = instance.settings.holidayCache, savedCalendar = instance.holidays;
    failRequest = true;
    await assert.rejects(instance.updateHolidayData(2026), /network/);
    assert.equal(instance.settings.holidayCache, savedCache);
    failRequest = false;
    instance.saveData = async () => { throw new Error("disk"); };
    await assert.rejects(instance.updateHolidayData(2026), /disk/);
    assert.equal(instance.settings.holidayCache, savedCache);
    assert.equal(instance.holidays, savedCalendar);
    assert.equal(instance.holidayUpdateBusy, false);
    instance.holidayUpdateBusy = true;
    await assert.rejects(instance.updateHolidayData(2026), /正在更新/);
    console.log("PASS: holiday rest/work markers, adjusted weekends, full holiday week, cross-year and missing-year handling, block/path resolver, cache validation and opt-in network isolation.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
