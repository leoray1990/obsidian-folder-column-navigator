// Browser integration regression. Run with Playwright available in NODE_PATH.
// Uses the real FullCalendar DOM and plugin method, not mocked date cells.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const ts = require("typescript"), esbuild = require("esbuild"), { chromium } = require("playwright");
const root = path.join(__dirname, "..");
async function run() {
    const source = ts.createSourceFile("main.ts", fs.readFileSync(path.join(root, "main.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const view = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FolderColumnNavigatorView");
    const update = view.members.find(node => node.name?.getText(source) === "updateCalendarDateCells").getText(source);
    const methods = ["ensureCalendar", "handleCalendarResize", "setCalendarDisplayMode", "updateCalendarDisplayMode", "renderCalendarToolbar", "getCalendarWeekStart", "renderCalendarWeekNumbers"]
        .map(name => view.members.find(node => node.name?.getText(source) === name).getText(source)).join("\n");
    const script = `
        import { Calendar } from '@fullcalendar/core';
        import dayGridPlugin from '@fullcalendar/daygrid';
        import interactionPlugin from '@fullcalendar/interaction';
        import zhCnLocale from '@fullcalendar/core/locales/zh-cn';
        import { MainlandHolidayCalendar } from './holidays';
        import { CalendarVirtualList } from './calendar-virtual-list';
        HTMLElement.prototype.toggleClass = function(name, on) { this.classList.toggle(name, on); };
        HTMLElement.prototype.setText = function(text) { this.textContent = text; };
        HTMLElement.prototype.empty = function() { this.replaceChildren(); };
        HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names); };
        HTMLElement.prototype.setCssProps = function(values) { Object.entries(values).forEach(([key,value]) => this.style.setProperty(key,value)); };
        HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', options); };
        HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', options); };
        HTMLElement.prototype.createEl = function(tag, options) {
            const el = document.createElement(tag);
            if (typeof options === 'string') el.className = options;
            else if (options) { el.className = options.cls || ''; el.textContent = options.text || ''; Object.entries(options.attr || {}).forEach(([key, value]) => el.setAttribute(key, value)); }
            this.append(el); return el;
        };
        class View {
            ${update}
            ${methods}
            renderCalendarYearPicker() {}
            getIsoWeekNumber() { return 42; }
            refreshCalendarDateMatches() {
                this.updateCalendarDateCells(); this.renderCalendarWeekNumbers();
                requestAnimationFrame(() => this.updateCalendarDateCells());
            }
        }
        const v = new View();
        v.plugin = { settings: { calendarShowHolidays: true, dailyNote: { enabled: true } }, holidays: new MainlandHolidayCalendar() };
        v.calendarDateMatches = new Map(); v.calendarSelectedDateKey = null;
        v.calendarGridEl = document.querySelector('.fcn-calendar-grid');
        v.calendarHostEl = document.querySelector('.fcn-calendar-host');
        v.calendarPane = document.querySelector('.fcn-calendar-pane');
        v.calendarWeekNumbersEl = document.querySelector('.fcn-calendar-week-numbers');
        v.calendarYearPickerEl = document.createElement('div');
        v.calendarDisplayMode = 'month'; v.calendarExpanded = true; v.calendarResizeFrame = null;
        v.calendar = null; v.ensureCalendar(); v.calendar.gotoDate('2026-10-01');
        v.sizeUpdates = 0;
        const updateSize = v.calendar.updateSize.bind(v.calendar);
        v.calendar.updateSize = () => { v.sizeUpdates++; updateSize(); };
        v.calendarResizeObserver = new ResizeObserver(() => v.handleCalendarResize());
        v.calendarResizeObserver.observe(v.calendarPane);
        window.fixture = v;
        window.makeVirtualFixture = count => {
            const box = document.body.createDiv('virtual-fixture folder-column-navigator-view');
            const host = box.createDiv('fcn-calendar-results-list');
            const files = Array.from({length:count}, (_,i) => ({name:'Note '+i}));
            const list = new CalendarVirtualList(host, files, (file, parent) => {
                const row = parent.createEl('button', {cls:'fcn-file-item fcn-calendar-results-item'});
                row.createSpan({text:file.name}); return row;
            });
            window.virtualFixture = {box,host,list};
        };
    `;
    const bundle = await esbuild.build({ stdin: { contents: script, resolveDir: root, loader: "ts" }, bundle: true, write: false, format: "iife" });
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 420, height: 600 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.setContent('<div class="folder-column-navigator-view"><div class="fcn-calendar-pane is-expanded"><div class="fcn-calendar-content"><div class="fcn-calendar-grid"><div class="fcn-calendar-week-numbers"></div><div class="fcn-calendar-host"></div></div></div></div></div>');
        await page.addStyleTag({ content: fs.readFileSync(path.join(root, "styles.css"), "utf8") });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.waitForTimeout(100);
        assert.deepEqual(errors, []);
        const inspect = key => page.locator(`[data-date="${key}"]`).evaluate(cell => ({
            marker: cell.querySelector('.fcn-holiday-marker')?.textContent,
            name: cell.querySelector('.fcn-holiday-name')?.textContent,
            height: cell.getBoundingClientRect().height,
            visible: [...cell.querySelectorAll('.fcn-holiday-marker, .fcn-holiday-name')].every(el => {
                const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
            })
        }));
        const october = await inspect("2026-10-01");
        console.log("October 1:", october);
        assert.equal(october.marker, "休"); assert.equal(october.name, "国庆节"); assert.equal(october.visible, true);
        await page.evaluate(() => window.fixture.calendar.gotoDate('2026-11-01'));
        await page.waitForTimeout(100);
        assert.equal((await inspect("2026-11-21")).marker, "休");
        assert.equal((await inspect("2026-11-21")).name, undefined);
        assert.equal((await inspect("2026-11-20")).marker, undefined);
        await page.evaluate(() => window.fixture.calendar.gotoDate('2026-01-01'));
        await page.waitForTimeout(100);
        assert.equal((await inspect("2026-01-04")).marker, "班");
        await page.evaluate(() => { window.fixture.calendar.gotoDate('2026-10-12'); window.fixture.setCalendarDisplayMode('week'); });
        await page.waitForTimeout(100);
        const weekRows = await page.locator('.fc-daygrid-body tbody tr').count();
        console.log('Week rows:', weekRows);
        assert.equal(weekRows, 1, 'Week view must not inherit six-week month padding');
        await page.evaluate(() => { window.fixture.calendar.gotoDate('2026-09-28'); });
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.fc-daygrid-day[data-date]').count(), 7);
        assert.equal(await page.locator('[data-date="2026-10-01"] .fcn-holiday-name').textContent(), '国庆节');
        for (let i = 0; i < 4; i++) {
            await page.evaluate(() => { window.fixture.setCalendarDisplayMode('year'); window.fixture.setCalendarDisplayMode('week'); });
            await page.setViewportSize({ width: i % 2 ? 520 : 260, height: 600 });
            await page.waitForTimeout(80);
            const geometry = await page.locator('.fc-daygrid-day[data-date]').evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().width));
            assert.equal(geometry.length, 7);
            assert.ok(geometry.every(width => width > 20), 'Week columns stay visible after hidden/year and narrow-width transitions');
        }
        const beforeIdle = await page.evaluate(() => window.fixture.sizeUpdates);
        await page.waitForTimeout(400);
        const afterIdle = await page.evaluate(() => window.fixture.sizeUpdates);
        assert.ok(afterIdle - beforeIdle <= 1, 'ResizeObserver must settle instead of continually reflowing');
        await page.evaluate(() => { window.fixture.setCalendarDisplayMode('month'); window.fixture.calendar.gotoDate('2026-01-01'); });
        await page.waitForTimeout(80);
        assert.equal(await page.locator('.fc-daygrid-body tbody tr').count(), 6);
        await page.evaluate(() => { window.fixture.plugin.settings.calendarShowHolidays = false; window.fixture.updateCalendarDateCells(); });
        assert.equal(await page.locator('.fcn-holiday-marker').count(), 0);
        await page.evaluate(() => { window.fixture.plugin.settings.calendarShowHolidays = true; window.fixture.updateCalendarDateCells(); });
        assert.equal((await inspect("2026-01-04")).marker, "班");
        assert.deepEqual(errors, []);
        await page.addStyleTag({content:'.virtual-fixture{height:240px;display:flex;flex-direction:column}.virtual-fixture .fcn-calendar-results-list{height:240px;flex:none}'});
        await page.evaluate(() => window.makeVirtualFixture(100000));
        await page.waitForTimeout(80);
        assert.ok(await page.locator('.virtual-fixture [data-fcn-virtual-index]').count() <= 120);
        await page.evaluate(() => { const f=window.virtualFixture; f.host.scrollTop=f.host.scrollHeight; });
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.virtual-fixture [data-fcn-virtual-index="99999"]').count(), 1, 'Last result remains reachable without rendering all rows');
        assert.ok(await page.locator('.virtual-fixture [data-fcn-virtual-index]').count() <= 120);
        await page.locator('.virtual-fixture [data-fcn-virtual-index="99999"]').focus();
        await page.keyboard.press('Home');
        assert.equal(await page.locator('.virtual-fixture [data-fcn-virtual-index="0"]').evaluate(el => document.activeElement === el), true);
        await page.keyboard.press('End');
        assert.equal(await page.locator('.virtual-fixture [data-fcn-virtual-index="99999"]').evaluate(el => document.activeElement === el), true);
        await page.evaluate(() => { window.virtualFixture.list.dispose(); window.virtualFixture.box.remove(); });
        assert.deepEqual(errors, []);
        console.log('PASS: 100,000 results keep at most 120 DOM rows; last row, scrolling, Home/End focus and disposal work.');
        console.log("PASS: real month/week rendering, one week/seven dates, cross-month holidays, year/week transitions, responsive widths, stable resize observer and holiday toggles.");
    } finally { await browser.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
