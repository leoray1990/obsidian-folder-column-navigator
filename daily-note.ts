import { AbstractInputSuggest, App, Modal, Notice, Setting, TFile, TFolder, moment as obsidianMoment } from "obsidian";
import type momentFactory from "moment";
// Obsidian exports its shared Moment function with namespace typings.
const moment = obsidianMoment as unknown as typeof momentFactory;

export type DailyNoteType = "md" | "canvas" | "base";
export type DailyTemplateSource = "none" | "obsidian" | "templater";
export interface DailyNoteConfig {
    enabled: boolean;
    /** Literal vault-relative prefix, always before the directory template. */
    baseDirectory: string;
    directory: string;
    name: string;
    type: DailyNoteType;
    templateSource: DailyTemplateSource;
    templatePath: string;
}
export const DEFAULT_DAILY_NOTE: DailyNoteConfig = {
    enabled: true, baseDirectory: "日记", directory: "", name: "{{date:YYYY-MM-DD}}", type: "md",
    templateSource: "none", templatePath: ""
};
export function cleanDailyNoteConfig(value: Partial<DailyNoteConfig> | undefined): DailyNoteConfig {
    let directory = typeof value?.directory === "string" ? value.directory : DEFAULT_DAILY_NOTE.directory;
    let baseDirectory = typeof value?.baseDirectory === "string" ? value.baseDirectory : value ? "" : DEFAULT_DAILY_NOTE.baseDirectory;
    // Migrate only whole literal path segments. The rendered path stays identical;
    // mixed segments such as "周-{{date:WW}}" remain in the template untouched.
    if (value && value.baseDirectory === undefined) {
        const segments = directory.split("/");
        const dynamic = segments.findIndex(segment => /[{}]/.test(segment));
        const boundary = dynamic < 0 ? segments.length : dynamic;
        baseDirectory = segments.slice(0, boundary).join("/");
        directory = segments.slice(boundary).join("/");
    }
    return {
        enabled: typeof value?.enabled === "boolean" ? value.enabled : true,
        baseDirectory, directory,
        name: typeof value?.name === "string" ? value.name : DEFAULT_DAILY_NOTE.name,
        type: value?.type === "canvas" || value?.type === "base" ? value.type : "md",
        templateSource: value?.templateSource === "obsidian" || value?.templateSource === "templater" ? value.templateSource : "none",
        templatePath: typeof value?.templatePath === "string" ? value.templatePath : ""
    };
}

/** Templater does not expose a versioned public integration API. Guard the
 * native creation entry point rather than patching its settings or global state.
 * Verified against Templater 2.26 and upstream core/Templater.ts. */
interface TemplaterBridge {
    templater?: {
        create_new_note_from_template?: (template: TFile, folder: TFolder, filename: string, open: boolean) => Promise<TFile | undefined>;
    };
    settings?: { templates_folder?: string };
}
interface TemplateAppAccess {
    plugins?: { getPlugin?: (id: string) => TemplaterBridge | null };
    internalPlugins?: { getEnabledPluginById?: (id: string) => { options?: { folder?: string; dateFormat?: string; timeFormat?: string } } | null };
}
function templateAccess(app: App): TemplateAppAccess { return app as App & TemplateAppAccess; }

export function renderObsidianDailyTemplate(content: string, title: string, date: Date,
    formats: { dateFormat?: string; timeFormat?: string } = {}, now = new Date()): string {
    // Daily-note date deliberately refers to the selected calendar day, while
    // time remains the actual creation time. Do not evaluate arbitrary code.
    return content.replace(/\{\{\s*(title|date|time)(?::([^{}]+?))?\s*\}\}/g,
        (whole: string, variable: string, format: string | undefined) => {
            if (variable === "title") return format ? whole : title;
            const pattern = format?.trim() || (variable === "date" ? formats.dateFormat || "YYYY-MM-DD" : formats.timeFormat || "HH:mm");
            return moment(variable === "date" ? date : now).format(pattern);
        });
}

/** Validate dependencies before creating any folders or files. */
export function validateDailyTemplate(app: App, config: DailyNoteConfig): TFile | null {
    if (config.type !== "md" || !config.templateSource || config.templateSource === "none") return null;
    const file = app.vault.getAbstractFileByPath(config.templatePath);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") throw new Error("请选择当前仓库中存在的 Markdown 模板文件。");
    if (config.templateSource === "templater") {
        const plugin = templateAccess(app).plugins?.getPlugin?.("templater-obsidian");
        if (typeof plugin?.templater?.create_new_note_from_template !== "function") {
            throw new Error("Templater 未启用，或当前版本不支持模板创建接口。请先启用或更新 Templater。");
        }
    }
    return file;
}

export class DailyTemplateFileSuggest extends AbstractInputSuggest<TFile> {
    constructor(app: App, private input: HTMLInputElement, private source: DailyTemplateSource) {
        super(app, input); this.limit = 50;
    }
    protected getSuggestions(query: string): TFile[] {
        const access = templateAccess(this.app);
        const folder = this.source === "templater" ? access.plugins?.getPlugin?.("templater-obsidian")?.settings?.templates_folder :
            access.internalPlugins?.getEnabledPluginById?.("templates")?.options?.folder;
        const results: TFile[] = [];
        const search = query.toLocaleLowerCase();
        const scan = (items: Array<TFile | TFolder>): void => {
            for (const item of items) {
                if (results.length >= 50) break;
                if (item instanceof TFolder) scan(item.children.filter((child): child is TFile | TFolder => child instanceof TFile || child instanceof TFolder));
                else if (item.extension === "md" && item.path.toLocaleLowerCase().includes(search)) results.push(item);
            }
        };
        const configured = folder ? this.app.vault.getAbstractFileByPath(folder) : null;
        const root = configured instanceof TFolder ? configured : this.app.vault.getRoot();
        scan(root.children.filter((child): child is TFile | TFolder => child instanceof TFile || child instanceof TFolder));
        return results;
    }
    renderSuggestion(file: TFile, el: HTMLElement): void { el.setText(file.path); }
    selectSuggestion(file: TFile): void {
        this.setValue(file.path); this.input.value = file.path;
        this.input.dispatchEvent(new Event("input", { bubbles: true })); this.close();
    }
}

/** The native Templater pipeline owns parsing, execution, pending-file guards
 * and lifecycle cleanup. Never run it again through an overwrite command. */
export async function createDailyNoteWithTemplate(app: App, config: DailyNoteConfig, date: Date,
    path: string, template: TFile | null): Promise<TFile> {
    if (app.vault.getAbstractFileByPath(path)) throw new Error("同名文件已存在，未覆盖。请修改名称。");
    const filename = path.slice(path.lastIndexOf("/") + 1);
    if (template && config.templateSource === "templater" && config.type === "md") {
        const plugin = templateAccess(app).plugins?.getPlugin?.("templater-obsidian");
        const engine = plugin?.templater;
        if (typeof engine?.create_new_note_from_template !== "function") throw new Error("Templater 已停用，请重新启用后再创建。");
        const folderPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : app.vault.getRoot();
        if (!(folder instanceof TFolder)) throw new Error("目标目录不存在。");
        const file = await engine.create_new_note_from_template(template, folder, filename.slice(0, -3), false);
        if (!(file instanceof TFile)) throw new Error("Templater 创建失败或已取消，请检查 Templater 的错误提示；不会改为空白笔记继续创建。");
        return file;
    }
    let content: string;
    if (config.type === "canvas") content = '{"nodes":[],"edges":[]}';
    else if (config.type === "base") content = 'views:\n  - type: table\n    name: Table\n';
    else if (template && config.templateSource === "obsidian") {
        const options = templateAccess(app).internalPlugins?.getEnabledPluginById?.("templates")?.options;
        content = renderObsidianDailyTemplate(await app.vault.cachedRead(template), filename.slice(0, -3), date, options);
    } else content = `---\ndate: ${moment(date).format("YYYY-MM-DD")}\n---\n`;
    // A template read may have yielded long enough for another action to create
    // the target. Recheck before writing, and rely on vault.create's no-overwrite contract.
    if (app.vault.getAbstractFileByPath(path)) throw new Error("同名文件已存在，未覆盖。请修改名称。");
    return app.vault.create(path, content);
}

/** All dates are local calendar dates. ISO weeks start Monday, matching the calendar. */
export type WeekWorkdayResolver = (date: Date) => Date;
export function expandDailyTemplate(template: string, date: Date, lastWorkday?: WeekWorkdayResolver): string {
    const selected = moment(date).startOf("day");
    const expanded = template.replace(/\{\{(date|weekStart|weekEnd|weekFriday|weekLastWorkday|today):([^{}]+)\}\}/g,
        (_whole: string, source: string, format: string) => {
            const supported = format.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|WW|W|dddd|ddd/g, "");
            if (/[A-Za-z{}]/.test(supported)) throw new Error("日期格式只支持年、月、日、星期和 ISO 周数。");
            if (source === "weekLastWorkday" && !lastWorkday) throw new Error("无法读取节假日数据，请重新打开插件设置。");
            const target = source === "weekLastWorkday" ? moment(lastWorkday!(date)) : source === "today" ? moment().startOf("day") : selected.clone();
            if (source === "weekStart") target.startOf("isoWeek");
            if (source === "weekEnd") target.startOf("isoWeek").add(6, "days");
            if (source === "weekFriday") target.startOf("isoWeek").add(4, "days");
            return target.format(format);
        });
    if (/[{}]/.test(expanded)) throw new Error("模板变量格式错误，请使用 {{date:YYYY-MM-DD}} 等支持的变量。");
    return expanded;
}

/** Never normalize traversal or absolute paths into another valid vault location. */
export function dailyNotePath(config: DailyNoteConfig, date: Date, editedName?: string, lastWorkday?: WeekWorkdayResolver): string {
    const suffix = expandDailyTemplate(config.directory, date, lastWorkday);
    const base = config.baseDirectory ?? "";
    const name = editedName ?? expandDailyTemplate(config.name, date, lastWorkday);
    const invalid = (segment: string): boolean => !segment.trim() || segment === "." || segment === ".." ||
        /[\\:*?"<>|\u0000-\u001f]/.test(segment) || /[. ]$/.test(segment);
    if (name.includes("/") || invalid(name)) throw new Error("笔记名称不能为空，也不能包含目录分隔符或非法字符。");
    if (/[{}]/.test(base) || (base && base.split("/").some(invalid))) throw new Error("基础目录必须是有效的仓库相对目录，不支持日期变量。");
    if (suffix && suffix.split("/").some(invalid)) throw new Error("目录包含空层级、相对路径或非法字符。");
    const directory = [base, suffix].filter(Boolean).join("/");
    if (directory && directory.split("/").some(invalid)) throw new Error("目录包含空层级、相对路径或非法字符。");
    return `${directory ? `${directory}/` : ""}${name}.${config.type}`;
}

const SOURCES = { date: "选中日期", weekStart: "周开始", weekEnd: "周结束", weekFriday: "周五", weekLastWorkday: "本周最后一个工作日", today: "今天（创建当天）" };
const FORMATS = { YYYY: "四位年", YY: "两位年", MM: "两位月", M: "月份", MMMM: "月份名称", DD: "两位日", D: "日期", WW: "两位周数", W: "周数", dddd: "星期" };
const TOKENS: Array<[string, string]> = [
    ["年", "{{date:YYYY}}"], ["月", "{{date:MM}}"], ["日", "{{date:DD}}"],
    ["周数", "{{date:WW}}"], ["星期", "{{date:dddd}}"],
    ["周开始", "{{weekStart:MM-DD}}"], ["周结束", "{{weekEnd:MM-DD}}"],
    ["周五", "{{weekFriday:MM-DD}}"],
    ["本周最后一个工作日", "{{weekLastWorkday:MM-DD}}"],
    ["周开始年", "{{weekStart:YYYY}}"], ["周开始月", "{{weekStart:MM}}"], ["周开始日", "{{weekStart:DD}}"],
    ["周结束年", "{{weekEnd:YYYY}}"], ["周结束月", "{{weekEnd:MM}}"], ["周结束日", "{{weekEnd:DD}}"],
    ["连接符 -", "-"], ["下划线 _", "_"], ["空格", " "], ["固定文字", "日记"]
];
const PRESETS: Record<string, [string, string]> = {
    "按年月": ["日记/{{date:YYYY}}/{{date:MM}}", "{{date:YYYY-MM-DD}}"],
    "平铺日期": ["日记", "{{date:YYYY-MM-DD}}"],
    "按年月周": ["日记/{{date:YYYY}}/{{date:MM}}/{{weekStart:MM-DD}}-{{weekEnd:MM-DD}}", "{{date:YYYY-MM-DD}}"]
};

/** DOM replacement briefly collapses settings content. Restore ancestor scroll
 * positions in this layout and after Obsidian's next rendering frame. */
export function preserveSettingsScroll(container: HTMLElement, render: () => void): void {
    const positions: Array<{ element: HTMLElement; top: number; left: number }> = [];
    for (let element: HTMLElement | null = container; element; element = element.parentElement) {
        positions.push({ element, top: element.scrollTop, left: element.scrollLeft });
    }
    render();
    const restore = (): void => positions.forEach(({ element, top, left }) => {
        if (element.isConnected) { element.scrollTop = top; element.scrollLeft = left; }
    });
    restore();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restore);
}
function splitBlocks(template: string): string[] {
    return template.match(/\{\{[^{}]+\}\}|[^{}/\-_ ]+|[/\-_ ]|[{}]/g) ?? [];
}
function label(block: string): string {
    const token = /^\{\{(date|weekStart|weekEnd|weekFriday|weekLastWorkday|today):(.+)\}\}$/.exec(block);
    return token ? `${SOURCES[token[1] as keyof typeof SOURCES]} · ${FORMATS[token[2] as keyof typeof FORMATS] ?? token[2]}` :
        block === " " ? "空格" : block;
}

/** Literals cannot smuggle a directory boundary or a template variable into a chip. */
export function isValidDailyLiteral(value: string): boolean {
    return value.length > 0 && !/[/\\:*?"<>|{}\u0000-\u001f]/.test(value);
}

/** Keep format changes within the component's date unit; compound formats belong in advanced mode. */
export function dailyFormatOptions(format: string): Record<string, string> {
    const families = [["YYYY", "YY"], ["MM", "M", "MMM", "MMMM"], ["DD", "D"], ["WW", "W"], ["dddd", "ddd"], ["MM-DD", "M-D", "MMDD"]];
    const family = families.find(values => values.includes(format));
    return family ? Object.fromEntries(family.map(value => [value, `${FORMATS[value as keyof typeof FORMATS] ?? value} (${value})`])) :
        { [format]: `高级模板格式：${format}` };
}

/** Draft-only editor: saving is explicit, so incomplete templates never become active. */
export function renderDailyNoteEditor(
    container: HTMLElement, config: DailyNoteConfig,
    save: (next: DailyNoteConfig) => Promise<void>,
    suggestBaseDirectory: (input: HTMLInputElement) => void,
    app: App, lastWorkday?: WeekWorkdayResolver
): void {
    const draft = { ...config };
    let saved = { ...config };
    let savingEnabled = false;
    let presetChoice = "按年月";
    let advanced = false;
    let sample = new Date();
    let selected: { key: "directory" | "name"; index: number } | null = null;
    // Declarative settings may invoke render again on an existing Setting.
    // Reuse its single editor host rather than appending another full copy.
    const hosts = Array.from(container.querySelectorAll<HTMLElement>(":scope > .fcn-daily-editor"));
    const root = hosts.shift() ?? container.createDiv("fcn-daily-editor");
    hosts.forEach(host => host.remove());
    const draw = (): void => preserveSettingsScroll(root, render);
    const render = (): void => {
        root.empty();
        let invalidLiteral = false;
        new Setting(root).setName("启用每日笔记创建").addToggle(toggle => toggle.setValue(draft.enabled).setDisabled(savingEnabled).onChange(value => {
            const previous = draft.enabled;
            draft.enabled = value;
            savingEnabled = true;
            draw();
            const next = { ...saved, enabled: value };
            void save(next).then(() => { saved = next; }).catch(error => {
                draft.enabled = previous;
                new Notice(error instanceof Error ? error.message : "保存失败，请重试。");
            }).finally(() => { savingEnabled = false; draw(); });
        }));
        if (!draft.enabled) return;
        const applyPreset = (): void => {
            const [directory, name] = PRESETS[presetChoice];
            draft.baseDirectory = "日记";
            draft.directory = directory === "日记" ? "" : directory.slice("日记/".length);
            draft.name = name; selected = null; draw();
        };
        new Setting(root).setName("常用方案").setDesc("选择方案后仍可自由编辑；已有自定义规则不会自动被覆盖，点击“应用方案”可重新应用当前选项。")
            .addDropdown(dropdown => {
            Object.keys(PRESETS).forEach(name => dropdown.addOption(name, name));
            dropdown.setValue(presetChoice);
            dropdown.onChange(value => {
                if (!PRESETS[value]) return;
                presetChoice = value; applyPreset();
            });
        }).addButton(button => button.setButtonText("应用方案").onClick(applyPreset));
        new Setting(root).setName("编辑方式").addDropdown(dropdown => dropdown
            .addOptions({ blocks: "积木组合", advanced: "高级模板" })
            .setValue(advanced ? "advanced" : "blocks").onChange(value => { advanced = value === "advanced"; draw(); }));
        const preview = root.createDiv("fcn-daily-preview");
        const validate = (): boolean => {
            try {
                if (invalidLiteral) throw new Error("固定文字不能为空，不能包含目录分隔符、模板括号或文件名非法字符。");
                validateDailyTemplate(app, draft);
                preview.setText(dailyNotePath(draft, sample, undefined, lastWorkday)); preview.removeClass("is-error"); return true;
            }
            catch (error) { preview.setText(error instanceof Error ? error.message : "模板无效"); preview.addClass("is-error"); return false; }
        };
        new Setting(root).setName("预览日期").addText(text => {
            text.inputEl.type = "date"; text.setValue(moment(sample).format("YYYY-MM-DD"));
            text.onChange(value => { const date = moment(value, "YYYY-MM-DD", true); if (date.isValid()) { sample = date.toDate(); validate(); } });
        });
        root.append(preview);
        (["directory", "name"] as const).forEach(key => {
            new Setting(root).setName(key === "directory" ? "笔记目录" : "笔记名称").setHeading();
            const editBase = (): void => {
                new Setting(root).setName("基础目录").setDesc("固定在目录组合最左侧，支持当前仓库目录提示，也可填写尚未创建的目录；清空表示仓库根目录。与后续目录自动以 / 连接。")
                    .addText(text => {
                        text.setValue(draft.baseDirectory).onChange(value => { draft.baseDirectory = value; validate(); });
                        suggestBaseDirectory(text.inputEl);
                    });
            };
            if (advanced) {
                if (key === "directory") editBase();
                const input = root.createEl("textarea", { cls: "fcn-daily-template" });
                input.value = draft[key];
                input.setAttribute("aria-label", key === "directory" ? "目录模板" : "名称模板");
                input.addEventListener("input", () => { draft[key] = input.value; validate(); });
                return;
            }
            const blocks = splitBlocks(draft[key]);
            const strip = root.createDiv("fcn-daily-blocks");
            if (key === "directory" && draft.baseDirectory) {
                const wrapper = strip.createDiv("fcn-daily-chip fcn-daily-base-chip");
                const base = wrapper.createEl("button", { text: `基础目录 · ${draft.baseDirectory}`, attr: { type: "button", title: "基础目录固定在最左侧，点击编辑" } });
                base.toggleClass("is-active", selected?.key === key && selected.index === -1);
                base.addEventListener("click", () => { selected = { key, index: -1 }; draw(); });
                // Intentionally not draggable or a drop target: the prefix cannot
                // be reordered into the template or transferred into the name.
                const remove = wrapper.createEl("button", { text: "×", cls: "fcn-daily-chip-delete", attr: { type: "button", "aria-label": "删除基础目录" } });
                remove.addEventListener("click", () => { draft.baseDirectory = ""; selected = null; draw(); });
                if (blocks.length) strip.createSpan({ text: "/", cls: "fcn-daily-base-divider", attr: { title: "基础目录与后续目录之间自动连接" } });
            }
            if (!blocks.length && !(key === "directory" && draft.baseDirectory)) strip.createSpan({ text: key === "directory" ? "仓库根目录（点击下方组件添加）" : "点击下方组件添加", cls: "fcn-daily-hint" });
            if (key === "directory" && selected?.key === key && selected.index === -1) editBase();
            const replace = (next: string[]): void => { draft[key] = next.join(""); draw(); };
            strip.addEventListener("dragover", event => event.preventDefault());
            strip.addEventListener("drop", event => {
                event.preventDefault();
                try {
                    const payload = JSON.parse(event.dataTransfer?.getData("application/x-fcn-daily-block") ?? "") as { value?: string };
                    if (typeof payload.value !== "string" || (key === "name" && payload.value.includes("/"))) return;
                    blocks.push(payload.value); selected = { key, index: blocks.length - 1 }; replace(blocks);
                } catch { /* Ignore unrelated drag payloads. */ }
            });
            blocks.forEach((block, index) => {
                const wrapper = strip.createDiv("fcn-daily-chip");
                const chip = wrapper.createEl("button", { text: label(block), attr: { type: "button", "aria-label": `选择 ${label(block)}` } });
                const remove = wrapper.createEl("button", { text: "×", cls: "fcn-daily-chip-delete",
                    attr: { type: "button", "aria-label": `删除 ${label(block)}`, title: "删除组件" } });
                remove.addEventListener("click", event => {
                    event.preventDefault(); event.stopPropagation();
                    blocks.splice(index, 1); selected = null; replace(blocks);
                });
                chip.toggleClass("is-active", selected?.key === key && selected.index === index);
                chip.setAttribute("aria-pressed", String(selected?.key === key && selected.index === index));
                chip.draggable = true;
                chip.addEventListener("dragstart", event => { event.dataTransfer?.setData("application/x-fcn-daily-block", JSON.stringify({ key, index })); });
                chip.addEventListener("dragover", event => event.preventDefault());
                chip.addEventListener("drop", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        const source = JSON.parse(event.dataTransfer?.getData("application/x-fcn-daily-block") ?? "") as { key: string; index: number; value?: string };
                        if (typeof source.value === "string") {
                            if (key === "name" && source.value.includes("/")) return;
                            blocks.splice(index, 0, source.value); selected = { key, index }; replace(blocks); return;
                        }
                        if (source.key !== key || !Number.isInteger(source.index) || !blocks[source.index]) return;
                        const next = [...blocks]; const [moved] = next.splice(source.index, 1); next.splice(index, 0, moved);
                        selected = { key, index }; replace(next);
                    } catch { /* Ignore unrelated drag payloads. */ }
                });
                chip.addEventListener("click", () => { selected = { key, index }; draw(); });
            });
            if (selected?.key === key && blocks[selected.index] !== undefined) {
                const index = selected.index;
                const block = blocks[index];
                const token = /^\{\{(date|weekStart|weekEnd|weekFriday|weekLastWorkday|today):(.+)\}\}$/.exec(block);
                const edit = new Setting(root).setName("选中组件");
                if (token) {
                    edit.setDesc("选中日期＝日历中点击的日期；周开始/结束/周五＝该日期所在自然周的对应日期，不按调休调整；今天＝实际创建当天。格式只能在同类单位内切换，复杂格式请使用高级模板。");
                    edit.addDropdown(dropdown => dropdown.addOptions(SOURCES).setValue(token[1]).onChange(value => { blocks[index] = `{{${value}:${token[2]}}}`; replace(blocks); }));
                    edit.addDropdown(dropdown => dropdown.addOptions(dailyFormatOptions(token[2])).setValue(token[2]).onChange(value => {
                        blocks[index] = `{{${token[1]}:${value}}}`; replace(blocks);
                    }));
                } else if (!["/", "-", "_", " "].includes(block)) {
                    edit.setDesc("仅编辑固定文字，不支持文件名非法字符、目录分隔符或模板变量。添加目录层级请使用“/”组件。");
                    edit.addText(text => {
                        text.setValue(block).onChange(value => {
                            invalidLiteral = !isValidDailyLiteral(value);
                            text.inputEl.setAttribute("aria-invalid", String(invalidLiteral));
                            if (!invalidLiteral) { blocks[index] = value; draft[key] = blocks.join(""); }
                            validate();
                        });
                    });
                } else {
                    edit.setDesc("分隔符内容固定，不支持编辑；可以移动或删除。");
                }
                edit.addExtraButton(button => button.setIcon("arrow-left").setTooltip("左移").setDisabled(index === 0).onClick(() => {
                    [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]]; selected = { key, index: index - 1 }; replace(blocks);
                }));
                edit.addExtraButton(button => button.setIcon("arrow-right").setTooltip("右移").setDisabled(index === blocks.length - 1).onClick(() => {
                    [blocks[index], blocks[index + 1]] = [blocks[index + 1], blocks[index]]; selected = { key, index: index + 1 }; replace(blocks);
                }));
                edit.addExtraButton(button => button.setIcon("trash").setTooltip("删除组件").onClick(() => { blocks.splice(index, 1); selected = null; replace(blocks); }));
            }
            const groups: Array<[string, Array<[string, string]>]> = [
                ["日期相关", TOKENS.filter(([, value]) => value.startsWith("{{"))],
                ["固定文字", TOKENS.filter(([, value]) => !value.startsWith("{{"))]
            ];
            if (key === "directory") {
                const baseGroup = root.createDiv("fcn-daily-palette-group");
                baseGroup.createDiv({ text: "基础", cls: "fcn-daily-palette-label" });
                const palette = baseGroup.createDiv("fcn-daily-palette");
                const add = palette.createEl("button", { text: draft.baseDirectory ? "编辑基础目录" : "+ 基础目录", attr: { type: "button" } });
                add.addEventListener("click", () => {
                    if (!draft.baseDirectory) draft.baseDirectory = "日记";
                    selected = { key, index: -1 }; draw();
                });
                const separator = palette.createEl("button", { text: "+ /", attr: { type: "button", title: "目录分隔符" } });
                separator.draggable = true;
                separator.addEventListener("dragstart", event => event.dataTransfer?.setData("application/x-fcn-daily-block", JSON.stringify({ value: "/" })));
                separator.addEventListener("click", () => {
                    const index = selected?.key === key ? selected.index + 1 : blocks.length;
                    blocks.splice(index, 0, "/"); selected = { key, index }; replace(blocks);
                });
            }
            groups.forEach(([heading, tokens]) => {
                const group = root.createDiv("fcn-daily-palette-group");
                group.createDiv({ text: heading, cls: "fcn-daily-palette-label" });
                const palette = group.createDiv("fcn-daily-palette");
                tokens.forEach(([name, value]) => {
                const button = palette.createEl("button", { text: `+ ${name}`, attr: { type: "button" } });
                button.draggable = true;
                button.addEventListener("dragstart", event => event.dataTransfer?.setData("application/x-fcn-daily-block", JSON.stringify({ value })));
                button.addEventListener("click", () => {
                    const index = selected?.key === key ? selected.index + 1 : blocks.length;
                    blocks.splice(index, 0, value); selected = { key, index }; replace(blocks);
                });
                });
            });
        });
        root.createDiv({ cls: "fcn-daily-hint", text: "日期取日历选中日，周从周一开始。周五不受调休影响；本周最后一个工作日按中国大陆节假日和调休计算，全周休假或缺少年度数据时提示错误。高级变量：{{weekLastWorkday:YYYY-MM-DD}}。拖拽可排序，也可使用左右移动按钮。" });
        new Setting(root).setName("文件类型").addDropdown(dropdown => dropdown.addOptions({ md: "Markdown (.md)", canvas: "Canvas (.canvas)", base: "Base (.base)" })
            .setValue(draft.type).onChange(value => { draft.type = value as DailyNoteType; draw(); }));
        if (draft.type === "md") {
            new Setting(root).setName("模板来源").setDesc("只用于 Markdown 日记；不使用模板时默认写入所选日期的 date 属性。")
                .addDropdown(dropdown => dropdown.addOptions({ none: "不使用模板", obsidian: "Obsidian 模板", templater: "Templater 模板" })
                    .setValue(draft.templateSource).onChange(value => { draft.templateSource = value as DailyTemplateSource; draw(); }));
            if (draft.templateSource !== "none") {
                new Setting(root).setName("模板文件").setDesc(draft.templateSource === "templater" ?
                    "必须启用 Templater。脚本将由 Templater 原生执行，请只使用可信模板；tp.date.now 等日期函数保持插件原有语义。" :
                    "支持 {{title}}、{{date}}、{{time}} 及日期格式。date 使用日历选中日，time 使用创建时间；默认格式读取核心模板设置，未启用时使用标准默认值。")
                    .addText(text => {
                        text.setPlaceholder("模板/每日笔记.md").setValue(draft.templatePath).onChange(value => { draft.templatePath = value; validate(); });
                        new DailyTemplateFileSuggest(app, text.inputEl, draft.templateSource);
                    });
            }
        } else root.createDiv({ cls: "fcn-daily-hint", text: "Canvas / Base 不应用 Markdown 模板，继续使用有效的初始内容。已选模板配置会保留。" });
        new Setting(root).addButton(button => button.setButtonText("保存创建规则").setCta().onClick(() => {
            if (!validate()) return;
            button.setDisabled(true);
            void save({ ...draft }).then(() => {
                saved = { ...draft };
                new Notice("创建规则已保存", 2000);
            }).catch(error => {
                new Notice(error instanceof Error ? error.message : "保存失败，请重试", 5000);
            }).finally(() => {
                // Obsidian components implement fluent then(callback). Returning
                // a component from a Promise callback causes recursive thenable
                // assimilation and an infinite microtask loop in the renderer.
                // Always return void from async cleanup callbacks.
                button.setDisabled(false);
            });
        }));
        validate();
    };
    draw();
}

/** Creation is always confirmed, rechecked for collisions, and never overwrites. */
export class CreateDailyNoteModal extends Modal {
    constructor(app: App, private config: DailyNoteConfig, private date: Date,
        private created: (file: TFile) => Promise<void>, private lastWorkday?: WeekWorkdayResolver) { super(app); }
    onOpen(): void {
        this.setTitle("创建每日笔记");
        let name: string;
        try { name = expandDailyTemplate(this.config.name, this.date, this.lastWorkday); dailyNotePath(this.config, this.date, undefined, this.lastWorkday); validateDailyTemplate(this.app, this.config); }
        catch (error) { this.contentEl.createEl("p", { text: error instanceof Error ? error.message : "创建规则无效，请检查日历设置。" }); return; }
        this.contentEl.createEl("p", { text: `日期：${moment(this.date).format("YYYY-MM-DD")} · 类型：.${this.config.type}` });
        if (this.config.type === "md" && this.config.templateSource !== "none") this.contentEl.createEl("p", {
            text: `模板：${this.config.templateSource === "templater" ? "Templater（会执行模板脚本）" : "Obsidian"} · ${this.config.templatePath}`
        });
        const pathEl = this.contentEl.createDiv("fcn-daily-preview");
        const errorEl = this.contentEl.createDiv("fcn-daily-error");
        let confirm: import("obsidian").ButtonComponent;
        let openExisting: import("obsidian").ButtonComponent;
        let path = ""; let busy = false;
        const validate = (): boolean => {
            try {
                path = dailyNotePath(this.config, this.date, name, this.lastWorkday); pathEl.setText(path);
                const occupied = this.app.vault.getAbstractFileByPath(path);
                openExisting?.setDisabled(!(occupied instanceof TFile));
                errorEl.setText(occupied ? "同名文件或目录已存在；请修改名称，或打开已有文件。" : "不存在的目录将自动创建。");
                return !occupied;
            } catch (error) {
                path = ""; pathEl.setText("路径无效"); openExisting?.setDisabled(true);
                errorEl.setText(error instanceof Error ? error.message : "路径无效"); return false;
            }
        };
        new Setting(this.contentEl).setName("笔记名称").addText(text => {
            text.setValue(name).onChange(value => { name = value; confirm.setDisabled(!validate()); });
            window.setTimeout(() => { if (text.inputEl.isConnected) { text.inputEl.focus(); text.inputEl.select(); } }, 0);
        });
        new Setting(this.contentEl)
            .addButton(button => button.setButtonText("取消").onClick(() => { if (!busy) this.close(); }))
            .addButton(button => { openExisting = button; button.setButtonText("打开已有文件").onClick(() => {
                const file = this.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile && !busy) void this.app.workspace.getLeaf(false).openFile(file).then(() => this.close());
            }); })
            .addButton(button => {
                confirm = button; button.setButtonText("创建并打开").setCta().onClick(() => {
                    if (busy || !validate()) return;
                    busy = true; button.setDisabled(true);
                    void (async () => {
                        const template = validateDailyTemplate(this.app, this.config);
                        const segments = path.split("/"); segments.pop(); let current = "";
                        for (const segment of segments) {
                            current = current ? `${current}/${segment}` : segment;
                            const existing = this.app.vault.getAbstractFileByPath(current);
                            if (existing && !(existing instanceof TFolder)) throw new Error(`目录路径被文件占用：${current}`);
                            if (!existing) {
                                try { await this.app.vault.createFolder(current); }
                                catch (error) { if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; }
                            }
                        }
                        if (this.app.vault.getAbstractFileByPath(path)) throw new Error("同名文件已存在，未覆盖。请修改名称。");
                        const file = await createDailyNoteWithTemplate(this.app, this.config, this.date, path, template);
                        try { await this.created(file); }
                        catch (error) {
                            throw new Error(`笔记已创建，但保存关联或打开失败。请使用“打开已有文件”。${error instanceof Error ? error.message : ""}`);
                        }
                        this.close();
                    })().catch(error => {
                        errorEl.setText(error instanceof Error ? error.message : "创建失败，请重试。");
                    }).finally(() => {
                        busy = false;
                        // Do not erase a creation error while refreshing the existing-file action.
                        openExisting.setDisabled(!(this.app.vault.getAbstractFileByPath(path) instanceof TFile));
                        button.setDisabled(Boolean(this.app.vault.getAbstractFileByPath(path)));
                    });
                });
            });
        confirm!.setDisabled(!validate());
    }
}
