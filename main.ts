import {
    FileView,
    ItemView,
    Menu,
    Modal,
    Notice,
    Plugin,
    PluginSettingTab,
    Setting,
    SuggestModal,
    TAbstractFile,
    TFile,
    TFolder,
    ViewStateResult,
    WorkspaceLeaf,
    setIcon
} from "obsidian";
import { match as matchPinyin } from "pinyin-pro";
import { Calendar } from "@fullcalendar/core";
import zhCnLocale from "@fullcalendar/core/locales/zh-cn";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

const VIEW_TYPE = "folder-column-navigator";
const CALENDAR_VIEW_TYPE = "folder-column-navigator-calendar";
const ROOT_PATH = "/";
const MIN_NAVIGATION_WIDTH = 145;
const MAX_NAVIGATION_WIDTH = 420;
const DEFAULT_NAVIGATION_WIDTH = 220;
const MIN_CONFIGURABLE_COLUMN_WIDTH = 80;
const MAX_CONFIGURABLE_COLUMN_WIDTH = 800;
const DEFAULT_COLUMN_MIN_WIDTH = 120;
const DEFAULT_COLUMN_MAX_WIDTH = 400;
const MIN_ITEM_FONT_SIZE = 10;
const MAX_ITEM_FONT_SIZE = 24;
const DEFAULT_ROOT_FOLDER_FONT_SIZE = 13;
const DEFAULT_FILE_NAME_FONT_SIZE = 14;
const MIN_ITEM_NAME_WRAP_LINES = 1;
const MAX_ITEM_NAME_WRAP_LINES = 6;
const DEFAULT_ITEM_NAME_WRAP_LINES = 2;
const DRAG_EXPAND_DELAY_MS = 500;
const LEGACY_SETTINGS_RENDER_METHOD = "display";
const DECLARATIVE_SETTINGS_METHOD = "getSettingDefinitions";
const DECLARATIVE_GET_CONTROL_METHOD = "getControlValue";
const DECLARATIVE_SET_CONTROL_METHOD = "setControlValue";

type SortField = "name" | "modified" | "created";
type SortDirection = "asc" | "desc";
type FolderIconStyle = "folder" | "chevron" | "none";
type FileIconStyle = "file" | "type" | "none";
type CalendarDisplayMode = "month" | "week" | "year";
type FileDateDisplay = "none" | "created" | "modified";

interface FolderColumnNavigatorSettings {
    pinnedPaths: string[];
    hiddenRootPaths: string[];
    customFolders: string[];
    customFolderNames: Record<string, string>;
    rootFolderOrder: string[];
    hiddenPatterns: string[];
    rootFolderFontSize: number;
    fileNameFontSize: number;
    wrapItemNames: boolean;
    wrapItemNameMaxLines: number;
    alignFileTreeNames: boolean;
    showFolderNotes: boolean;
    folderNoteMatchFolderName: boolean;
    folderNoteMatchSpecialName: boolean;
    folderNoteSpecialNames: string[];
    folderNoteMetadataKeys: string[];
    fileMetadataKeys: string[];
    showMetadataNames: boolean;
    fileDateDisplay: FileDateDisplay;
    hideFileExtensions: boolean;
    navigationWidth: number;
    sortField: SortField;
    sortDirection: SortDirection;
    showRootFoldersAtTop: boolean;
    rootFolderVisibleRows: number;
    showItemMetadata: boolean;
    showExtensionMenuItems: boolean;
    folderIconStyle: FolderIconStyle;
    fileIconStyle: FileIconStyle;
    columnMinWidth: number;
    columnMaxWidth: number;
    columnWidths: Record<string, number>;
    showCalendarAtBottom: boolean;
    calendarShowFileIcons: boolean;
    calendarOpenSingleMatch: boolean;
    calendarSearchPaths: string[];
    calendarMatchCreatedDate: boolean;
    calendarMatchModifiedDate: boolean;
    calendarMatchFrontmatter: boolean;
    calendarFrontmatterKeys: string[];
    calendarMatchFilename: boolean;
    calendarFilenamePatterns: string[];
    calendarFileExtensions: string[];
}

const DEFAULT_SETTINGS: FolderColumnNavigatorSettings = {
    pinnedPaths: [],
    hiddenRootPaths: [],
    customFolders: [],
    customFolderNames: {},
    rootFolderOrder: [],
    hiddenPatterns: [],
    rootFolderFontSize: DEFAULT_ROOT_FOLDER_FONT_SIZE,
    fileNameFontSize: DEFAULT_FILE_NAME_FONT_SIZE,
    wrapItemNames: false,
    wrapItemNameMaxLines: DEFAULT_ITEM_NAME_WRAP_LINES,
    alignFileTreeNames: false,
    showFolderNotes: false,
    folderNoteMatchFolderName: true,
    folderNoteMatchSpecialName: true,
    folderNoteSpecialNames: ["首页", "Readme", "Home"],
    folderNoteMetadataKeys: [],
    fileMetadataKeys: [],
    showMetadataNames: false,
    fileDateDisplay: "none",
    hideFileExtensions: false,
    navigationWidth: DEFAULT_NAVIGATION_WIDTH,
    sortField: "name",
    sortDirection: "asc",
    showRootFoldersAtTop: false,
    rootFolderVisibleRows: 2,
    showItemMetadata: true,
    showExtensionMenuItems: true,
    folderIconStyle: "folder",
    fileIconStyle: "file",
    columnMinWidth: DEFAULT_COLUMN_MIN_WIDTH,
    columnMaxWidth: DEFAULT_COLUMN_MAX_WIDTH,
    columnWidths: {},
    showCalendarAtBottom: true,
    calendarShowFileIcons: true,
    calendarOpenSingleMatch: true,
    calendarSearchPaths: [],
    calendarMatchCreatedDate: true,
    calendarMatchModifiedDate: true,
    calendarMatchFrontmatter: true,
    calendarFrontmatterKeys: ["updated", "created", "创建日期", "修改日期", "date"],
    calendarMatchFilename: true,
    calendarFilenamePatterns: ["YYYYMMDD", "YYYY年MM月DD日", "YYYY-MM-DD*"],
    calendarFileExtensions: ["md", "canvas", "base"]
};

interface NavigationEntry {
    path: string;
    name: string;
    kind: "root" | "root-folder" | "custom";
}

type FilterScope =
    | { area: "navigation" }
    | { area: "column"; columnIndex: number };

interface FilterState {
    scope: FilterScope;
    query: string;
}

interface NavigationPosition {
    columnPaths: string[];
    activeColumnIndex: number;
    selectedFilePath: string | null;
    focusedPath: string;
    focusedKind?: string;
    focusedColumnIndex: number;
}

type FolderColumnNavigatorPlugin = FolderColumnNavigator;

type LegacySettingControl =
    | { key: string; type: "toggle" }
    | { key: string; type: "dropdown"; options: Record<string, string> }
    | { key: string; type: "text"; placeholder?: string }
    | { key: string; type: "textarea"; placeholder?: string; rows?: number }
    | { key: string; type: "slider"; min: number; max: number; step: number; displayFormat?: (value: number) => string }
    | { key: string; type: "number"; placeholder?: string };

interface LegacySettingItem {
    name?: string;
    desc?: string | DocumentFragment;
    visible?: boolean | (() => boolean);
    type?: "page" | "group" | "list";
    heading?: string;
    items?: LegacySettingItem[];
    control?: LegacySettingControl;
    render?: (setting: Setting, group?: unknown) => void;
}

function normalizeFolderPath(value: string): string {
    const path = value.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
    return path ? path : ROOT_PATH;
}

function clampNavigationWidth(width: number): number {
    return Math.max(MIN_NAVIGATION_WIDTH, Math.min(MAX_NAVIGATION_WIDTH, Math.round(width)));
}

function clampConfigurableColumnWidth(value: unknown, fallback: number): number {
    return typeof value === "number"
        ? Math.max(MIN_CONFIGURABLE_COLUMN_WIDTH, Math.min(MAX_CONFIGURABLE_COLUMN_WIDTH, Math.round(value)))
        : fallback;
}

function clampItemFontSize(value: unknown, fallback: number): number {
    return typeof value === "number"
        ? Math.max(MIN_ITEM_FONT_SIZE, Math.min(MAX_ITEM_FONT_SIZE, Math.round(value)))
        : fallback;
}

function clampItemNameWrapLines(value: unknown): number {
    return typeof value === "number"
        ? Math.max(MIN_ITEM_NAME_WRAP_LINES, Math.min(MAX_ITEM_NAME_WRAP_LINES, Math.round(value)))
        : DEFAULT_ITEM_NAME_WRAP_LINES;
}

function cleanCustomFolderNames(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return Object.entries(value).reduce<Record<string, string>>((names, [path, name]) => {
        const normalizedPath = normalizeFolderPath(path);
        const displayName = typeof name === "string" ? name.trim() : "";
        if (normalizedPath !== ROOT_PATH && displayName) {
            names[normalizedPath] = displayName;
        }
        return names;
    }, {});
}

function clampColumnWidth(width: number, minimumWidth: number, maximumWidth: number): number {
    return Math.max(minimumWidth, Math.min(maximumWidth, Math.round(width)));
}

function isSortField(value: unknown): value is SortField {
    return value === "name" || value === "modified" || value === "created";
}

function isSortDirection(value: unknown): value is SortDirection {
    return value === "asc" || value === "desc";
}

function isFolderIconStyle(value: unknown): value is FolderIconStyle {
    return value === "folder" || value === "chevron" || value === "none";
}

function isFileIconStyle(value: unknown): value is FileIconStyle {
    return value === "file" || value === "type" || value === "none";
}

function isFileDateDisplay(value: unknown): value is FileDateDisplay {
    return value === "none" || value === "created" || value === "modified";
}

function isDirectRootFolder(folder: TFolder): boolean {
    return folder.parent?.path === ROOT_PATH;
}

function compareNames(a: { name: string }, b: { name: string }): number {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

function getTimestamp(file: TAbstractFile, field: SortField): number {
    if (!(file instanceof TFile) || field === "name") {
        return 0;
    }
    return field === "modified" ? file.stat.mtime : file.stat.ctime;
}

function filterNameMatches(name: string, query: string): boolean {
    const normalizedName = name.toLocaleLowerCase();
    const normalizedQuery = query.toLocaleLowerCase();
    return normalizedName.includes(normalizedQuery) ||
        matchPinyin(name, normalizedQuery, { precision: "first", v: true }) !== null;
}

function joinVaultPath(folder: TFolder, name: string): string {
    return folder.path === ROOT_PATH ? name : `${folder.path}/${name}`;
}

class TextInputModal extends Modal {
    constructor(
        app: FolderColumnNavigatorPlugin["app"],
        private readonly title: string,
        private readonly placeholder: string,
        private readonly initialValue: string,
        private readonly submitLabel: string,
        private readonly onSubmitValue: (value: string) => Promise<void> | void,
        private readonly validateValue?: (value: string) => string | null
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle(this.title);
        const input = this.contentEl.createEl("input", {
            type: "text",
            value: this.initialValue,
            placeholder: this.placeholder,
            cls: "fcn-text-input-modal"
        });
        const validation = this.contentEl.createDiv("fcn-input-validation");
        const actions = this.contentEl.createDiv("modal-button-container");
        actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
        const submitButton = actions.createEl("button", { text: this.submitLabel, cls: "mod-cta" });
        const validate = (): boolean => {
            const value = input.value.trim();
            const message = !value ? "请输入名称。" : this.validateValue?.(value) ?? "";
            validation.setText(message);
            validation.toggleClass("is-visible", Boolean(message));
            input.toggleClass("is-invalid", Boolean(message));
            submitButton.disabled = Boolean(message);
            return !message;
        };
        const submit = (): void => {
            if (!validate()) {
                input.focus();
                return;
            }
            const value = input.value.trim();
            this.close();
            void this.onSubmitValue(value);
        };
        input.addEventListener("input", validate);
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            }
        });
        submitButton.addEventListener("click", submit);
        validate();
        window.setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

class FolderDestinationModal extends SuggestModal<TFolder> {
    constructor(
        app: FolderColumnNavigatorPlugin["app"],
        private readonly excludedPaths: Set<string>,
        private readonly onChooseFolder: (folder: TFolder) => Promise<void> | void
    ) {
        super(app);
        this.setPlaceholder("搜索目标目录（支持拼音）");
        this.setInstructions([
            { command: "↑↓", purpose: "选择目录" },
            { command: "↵", purpose: "移动到此处" },
            { command: "esc", purpose: "取消" }
        ]);
    }

    getSuggestions(query: string): TFolder[] {
        return [this.app.vault.getRoot(), ...this.app.vault.getAllLoadedFiles()]
            .filter((item): item is TFolder => item instanceof TFolder)
            .filter((folder, index, folders) => folders.findIndex(candidate => candidate.path === folder.path) === index)
            .filter(folder => !this.excludedPaths.has(folder.path))
            .filter(folder => !query || filterNameMatches(folder.path === ROOT_PATH ? this.app.vault.getName() : folder.path, query))
            .sort((a, b) => compareNames(a, b));
    }

    renderSuggestion(folder: TFolder, el: HTMLElement): void {
        el.setText(folder.path === ROOT_PATH ? this.app.vault.getName() : folder.path);
    }

    onChooseSuggestion(folder: TFolder): void {
        this.close();
        void this.onChooseFolder(folder);
    }
}

function cleanGlobPatternList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value
        .filter((pattern): pattern is string => typeof pattern === "string")
        .map(pattern => pattern.trim().replace(/\\/g, "/").replace(/^\.\/+/, ""))
        .filter(Boolean))];
}

function cleanCalendarRuleList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value
        .filter((entry): entry is string => typeof entry === "string")
        .map(entry => entry.trim())
        .filter(Boolean))];
}

function cleanFileExtensionList(value: unknown): string[] {
    return [...new Set(cleanTextList(value)
        .map(extension => extension.replace(/^\.+/, "").toLocaleLowerCase())
        .filter(Boolean))];
}

function cleanStoredColumnWidths(
    value: unknown,
    minimumWidth: number,
    maximumWidth: number
): Record<string, number> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {};
    }
    return Object.entries(value).reduce<Record<string, number>>((result, [path, width]) => {
        if (typeof width !== "number" || !Number.isFinite(width)) {
            return result;
        }
        result[normalizeFolderPath(path)] = clampColumnWidth(width, minimumWidth, maximumWidth);
        return result;
    }, {});
}

function cleanTextList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value
        .filter((entry): entry is string => typeof entry === "string")
        .map(entry => entry.trim())
        .filter(Boolean))];
}

function formatCalendarDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calendarDateKeyFromParts(year: number, month: number, day: number): string | null {
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return formatCalendarDate(date);
}

function extractCalendarDateKeys(value: unknown): string[] {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return [formatCalendarDate(value)];
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? [] : [formatCalendarDate(date)];
    }
    if (Array.isArray(value)) {
        return value.flatMap(entry => extractCalendarDateKeys(entry));
    }
    if (typeof value !== "string") {
        return [];
    }

    const dateKeys = new Set<string>();
    const separatedMatches = value.matchAll(/(\d{4})\s*(?:[-/.年])\s*(\d{1,2})\s*(?:[-/.月])\s*(\d{1,2})\s*(?:日)?/g);
    for (const match of separatedMatches) {
        const key = calendarDateKeyFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
        if (key) {
            dateKeys.add(key);
        }
    }
    const compactMatches = value.matchAll(/(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?!\d)/g);
    for (const match of compactMatches) {
        const key = calendarDateKeyFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
        if (key) {
            dateKeys.add(key);
        }
    }
    return [...dateKeys];
}

function filenamePatternToDateMatcher(pattern: string): { expression: RegExp; tokens: string[] } | null {
    const tokens: string[] = [];
    let expression = "^";
    for (let index = 0; index < pattern.length;) {
        const token = ["YYYY", "MM", "DD"].find(candidate => pattern.startsWith(candidate, index));
        if (token) {
            tokens.push(token);
            expression += token === "YYYY" ? "(\\d{4})" : "(\\d{2})";
            index += token.length;
            continue;
        }
        const character = pattern[index];
        expression += character === "*" ? ".*" : /[\\^$+?.()|{}[\]]/.test(character) ? `\\${character}` : character;
        index += 1;
    }
    return ["YYYY", "MM", "DD"].every(token => tokens.includes(token))
        ? { expression: new RegExp(`${expression}$`), tokens }
        : null;
}

function extractCalendarDateKeysFromFilename(filename: string, patterns: string[]): string[] {
    const dateKeys = new Set<string>();
    patterns.forEach(pattern => {
        const matcher = filenamePatternToDateMatcher(pattern);
        const match = matcher?.expression.exec(filename);
        if (!matcher || !match) {
            return;
        }
        const values = matcher.tokens.reduce<Record<string, string>>((result, token, index) => {
            result[token] = match[index + 1];
            return result;
        }, {});
        const key = calendarDateKeyFromParts(Number(values.YYYY), Number(values.MM), Number(values.DD));
        if (key) {
            dateKeys.add(key);
        }
    });
    return [...dateKeys];
}

class DateMatchedFilesModal extends Modal {
    constructor(
        app: FolderColumnNavigatorPlugin["app"],
        private readonly date: Date,
        private readonly files: TFile[],
        private readonly onChooseFile: (file: TFile) => Promise<void> | void
    ) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass("fcn-date-match-modal");
        this.setTitle(`${formatCalendarDate(this.date)} 的文件`);
        this.contentEl.createEl("p", {
            text: `找到 ${this.files.length} 个匹配文件，请选择要打开的文件。`,
            cls: "fcn-date-match-modal-description"
        });
        const list = this.contentEl.createDiv("fcn-date-match-modal-list");
        list.setAttribute("aria-label", `${formatCalendarDate(this.date)} 的匹配文件`);
        this.files.forEach(file => {
            const row = list.createEl("button", {
                cls: "fcn-date-match-modal-item",
                attr: { type: "button", "aria-label": `打开 ${file.path}` }
            });
            const icon = row.createSpan("fcn-item-icon");
            setIcon(icon, "file-text");
            const text = row.createDiv("fcn-date-match-modal-text");
            text.createSpan({ text: file.name, cls: "fcn-date-match-modal-name" });
            const parentPath = file.parent?.path ?? ROOT_PATH;
            text.createSpan({
                text: parentPath === ROOT_PATH ? this.app.vault.getName() : parentPath,
                cls: "fcn-date-match-modal-path",
                attr: { title: file.path }
            });
            row.addEventListener("click", () => {
                this.close();
                void this.onChooseFile(file);
            });
        });
    }

    onClose(): void {
        this.modalEl.removeClass("fcn-date-match-modal");
        this.contentEl.empty();
    }
}

function globPatternToRegExp(pattern: string): RegExp {
    let expression = "^";
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === "*" && pattern[index + 1] === "*") {
            if (pattern[index + 2] === "/") {
                expression += "(?:.*/)?";
                index += 2;
            } else {
                expression += ".*";
                index += 1;
            }
            continue;
        }
        if (character === "/" && pattern[index + 1] === "*" && pattern[index + 2] === "*" && index + 3 === pattern.length) {
            expression += "(?:/.*)?";
            index += 2;
            continue;
        }
        if (character === "*") {
            expression += "[^/]*";
            continue;
        }
        if (character === "?") {
            expression += "[^/]";
            continue;
        }
        expression += /[\\^$+?.()|{}[\]]/.test(character) ? `\\${character}` : character;
    }
    return new RegExp(`${expression}$`);
}

export default class FolderColumnNavigator extends Plugin {
    settings: FolderColumnNavigatorSettings = { ...DEFAULT_SETTINGS };
    private readonly views = new Set<FolderColumnNavigatorView>();
    private readonly hiddenPatternMatchers = new Map<string, RegExp>();

    async onload(): Promise<void> {
        await this.loadSettings();

        this.registerView(VIEW_TYPE, leaf => {
            const view = new FolderColumnNavigatorView(leaf, this);
            this.views.add(view);
            return view;
        });
        this.registerView(CALENDAR_VIEW_TYPE, leaf => {
            const view = new FolderColumnNavigatorView(leaf, this, true);
            this.views.add(view);
            return view;
        });

        this.registerEvent(this.app.vault.on("create", () => this.refreshViews()));
        this.registerEvent(this.app.vault.on("delete", () => this.refreshViews()));
        this.registerEvent(this.app.vault.on("rename", () => this.refreshViews()));

        this.addRibbonIcon("folder-tree", "打开目录文件列表", () => {
            void this.activateView();
        });
        this.addCommand({
            id: "open",
            name: "打开目录文件列表",
            callback: () => void this.activateView()
        });
        this.addCommand({
            id: "reveal-active-file",
            name: "定位当前笔记",
            callback: () => this.views.forEach(view => view.revealActiveFile())
        });
        this.addCommand({
            id: "open-calendar",
            name: "打开独立日历视图",
            callback: () => void this.activateCalendarView()
        });
        this.addSettingTab(new FolderColumnNavigatorSettingTab(this.app, this));
    }

    onunload(): void {
        this.views.clear();
    }

    async loadSettings(): Promise<void> {
        const saved = (await this.loadData()) as Partial<FolderColumnNavigatorSettings> | null;
        const legacyCalendarPresentation = (saved as { calendarPresentation?: unknown } | null)?.calendarPresentation;
        const columnMinWidth = clampConfigurableColumnWidth(saved?.columnMinWidth, DEFAULT_COLUMN_MIN_WIDTH);
        const columnMaxWidth = Math.max(
            columnMinWidth,
            clampConfigurableColumnWidth(saved?.columnMaxWidth, DEFAULT_COLUMN_MAX_WIDTH)
        );
        this.settings = {
            ...DEFAULT_SETTINGS,
            ...saved,
            pinnedPaths: this.cleanPathList(saved?.pinnedPaths),
            hiddenRootPaths: this.cleanPathList(saved?.hiddenRootPaths),
            customFolders: this.cleanPathList(saved?.customFolders).filter(path => path !== ROOT_PATH),
            customFolderNames: cleanCustomFolderNames(saved?.customFolderNames),
            rootFolderOrder: this.cleanPathList(saved?.rootFolderOrder).filter(path => path !== ROOT_PATH),
            hiddenPatterns: cleanGlobPatternList(saved?.hiddenPatterns),
            rootFolderFontSize: clampItemFontSize(saved?.rootFolderFontSize, DEFAULT_ROOT_FOLDER_FONT_SIZE),
            fileNameFontSize: clampItemFontSize(saved?.fileNameFontSize, DEFAULT_FILE_NAME_FONT_SIZE),
            wrapItemNames: typeof saved?.wrapItemNames === "boolean"
                ? saved.wrapItemNames
                : DEFAULT_SETTINGS.wrapItemNames,
            wrapItemNameMaxLines: clampItemNameWrapLines(saved?.wrapItemNameMaxLines),
            alignFileTreeNames: typeof saved?.alignFileTreeNames === "boolean"
                ? saved.alignFileTreeNames
                : DEFAULT_SETTINGS.alignFileTreeNames,
            showFolderNotes: typeof saved?.showFolderNotes === "boolean"
                ? saved.showFolderNotes
                : DEFAULT_SETTINGS.showFolderNotes,
            folderNoteMatchFolderName: typeof saved?.folderNoteMatchFolderName === "boolean"
                ? saved.folderNoteMatchFolderName
                : DEFAULT_SETTINGS.folderNoteMatchFolderName,
            folderNoteMatchSpecialName: typeof saved?.folderNoteMatchSpecialName === "boolean"
                ? saved.folderNoteMatchSpecialName
                : DEFAULT_SETTINGS.folderNoteMatchSpecialName,
            folderNoteSpecialNames: cleanTextList(saved?.folderNoteSpecialNames),
            folderNoteMetadataKeys: cleanTextList(saved?.folderNoteMetadataKeys),
            fileMetadataKeys: cleanTextList(saved?.fileMetadataKeys),
            showMetadataNames: typeof saved?.showMetadataNames === "boolean"
                ? saved.showMetadataNames
                : DEFAULT_SETTINGS.showMetadataNames,
            fileDateDisplay: isFileDateDisplay(saved?.fileDateDisplay)
                ? saved.fileDateDisplay
                : DEFAULT_SETTINGS.fileDateDisplay,
            hideFileExtensions: typeof saved?.hideFileExtensions === "boolean"
                ? saved.hideFileExtensions
                : DEFAULT_SETTINGS.hideFileExtensions,
            navigationWidth: clampNavigationWidth(
                typeof saved?.navigationWidth === "number" ? saved.navigationWidth : DEFAULT_NAVIGATION_WIDTH
            ),
            sortField: isSortField(saved?.sortField) ? saved.sortField : DEFAULT_SETTINGS.sortField,
            sortDirection: isSortDirection(saved?.sortDirection) ? saved.sortDirection : DEFAULT_SETTINGS.sortDirection,
            showRootFoldersAtTop: typeof saved?.showRootFoldersAtTop === "boolean"
                ? saved.showRootFoldersAtTop
                : DEFAULT_SETTINGS.showRootFoldersAtTop,
            rootFolderVisibleRows: typeof saved?.rootFolderVisibleRows === "number"
                ? Math.max(1, Math.min(8, Math.round(saved.rootFolderVisibleRows)))
                : DEFAULT_SETTINGS.rootFolderVisibleRows,
            showItemMetadata: typeof saved?.showItemMetadata === "boolean"
                ? saved.showItemMetadata
                : DEFAULT_SETTINGS.showItemMetadata,
            showExtensionMenuItems: typeof saved?.showExtensionMenuItems === "boolean"
                ? saved.showExtensionMenuItems
                : DEFAULT_SETTINGS.showExtensionMenuItems,
            folderIconStyle: isFolderIconStyle(saved?.folderIconStyle)
                ? saved.folderIconStyle
                : DEFAULT_SETTINGS.folderIconStyle,
            fileIconStyle: isFileIconStyle(saved?.fileIconStyle)
                ? saved.fileIconStyle
                : DEFAULT_SETTINGS.fileIconStyle,
            columnMinWidth,
            columnMaxWidth,
            columnWidths: cleanStoredColumnWidths(saved?.columnWidths, columnMinWidth, columnMaxWidth),
            showCalendarAtBottom: typeof saved?.showCalendarAtBottom === "boolean"
                ? saved.showCalendarAtBottom
                : legacyCalendarPresentation !== "separate",
            calendarShowFileIcons: typeof saved?.calendarShowFileIcons === "boolean"
                ? saved.calendarShowFileIcons
                : DEFAULT_SETTINGS.calendarShowFileIcons,
            calendarOpenSingleMatch: typeof saved?.calendarOpenSingleMatch === "boolean"
                ? saved.calendarOpenSingleMatch
                : DEFAULT_SETTINGS.calendarOpenSingleMatch,
            calendarSearchPaths: this.cleanPathList(saved?.calendarSearchPaths).filter(path => path !== ROOT_PATH),
            calendarMatchCreatedDate: typeof saved?.calendarMatchCreatedDate === "boolean"
                ? saved.calendarMatchCreatedDate
                : DEFAULT_SETTINGS.calendarMatchCreatedDate,
            calendarMatchModifiedDate: typeof saved?.calendarMatchModifiedDate === "boolean"
                ? saved.calendarMatchModifiedDate
                : DEFAULT_SETTINGS.calendarMatchModifiedDate,
            calendarMatchFrontmatter: typeof saved?.calendarMatchFrontmatter === "boolean"
                ? saved.calendarMatchFrontmatter
                : DEFAULT_SETTINGS.calendarMatchFrontmatter,
            calendarFrontmatterKeys: cleanCalendarRuleList(saved?.calendarFrontmatterKeys),
            calendarMatchFilename: typeof saved?.calendarMatchFilename === "boolean"
                ? saved.calendarMatchFilename
                : DEFAULT_SETTINGS.calendarMatchFilename,
            calendarFilenamePatterns: cleanCalendarRuleList(saved?.calendarFilenamePatterns),
            calendarFileExtensions: cleanFileExtensionList(saved?.calendarFileExtensions)
        };

        if (this.settings.calendarFrontmatterKeys.length === 0 && saved?.calendarFrontmatterKeys === undefined) {
            this.settings.calendarFrontmatterKeys = [...DEFAULT_SETTINGS.calendarFrontmatterKeys];
        }
        if (this.settings.calendarFilenamePatterns.length === 0 && saved?.calendarFilenamePatterns === undefined) {
            this.settings.calendarFilenamePatterns = [...DEFAULT_SETTINGS.calendarFilenamePatterns];
        }
        if (this.settings.calendarFileExtensions.length === 0 && saved?.calendarFileExtensions === undefined) {
            this.settings.calendarFileExtensions = [...DEFAULT_SETTINGS.calendarFileExtensions];
        }
        if (this.settings.folderNoteSpecialNames.length === 0 && saved?.folderNoteSpecialNames === undefined) {
            this.settings.folderNoteSpecialNames = [...DEFAULT_SETTINGS.folderNoteSpecialNames];
        }
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        this.refreshViews();
    }

    async updateSort(field: SortField, direction: SortDirection = this.settings.sortDirection): Promise<void> {
        this.settings.sortField = field;
        this.settings.sortDirection = direction;
        await this.saveSettings();
    }

    async toggleSortDirection(): Promise<void> {
        this.settings.sortDirection = this.settings.sortDirection === "asc" ? "desc" : "asc";
        await this.saveSettings();
    }

    async updateNavigationWidth(width: number): Promise<void> {
        this.settings.navigationWidth = clampNavigationWidth(width);
        await this.saveSettings();
    }

    async updateColumnWidth(path: string, width: number): Promise<void> {
        this.settings.columnWidths = {
            ...this.settings.columnWidths,
            [normalizeFolderPath(path)]: clampColumnWidth(
                width,
                this.settings.columnMinWidth,
                this.settings.columnMaxWidth
            )
        };
        await this.saveSettings();
    }

    isHiddenByPattern(path: string): boolean {
        if (path === ROOT_PATH || this.settings.hiddenPatterns.length === 0) {
            return false;
        }
        const candidates = [path];
        let ancestor = path;
        while (ancestor.includes("/")) {
            ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"));
            candidates.push(ancestor);
        }
        return this.settings.hiddenPatterns.some(pattern => {
            let matcher = this.hiddenPatternMatchers.get(pattern);
            if (!matcher) {
                matcher = globPatternToRegExp(pattern);
                this.hiddenPatternMatchers.set(pattern, matcher);
            }
            return candidates.some(candidate => matcher.test(candidate));
        });
    }

    getRootFolders(): TFolder[] {
        const folders = this.app.vault
            .getRoot()
            .children.filter((child): child is TFolder => child instanceof TFolder && isDirectRootFolder(child))
            .sort(compareNames);
        const order = new Map(this.settings.rootFolderOrder.map((path, index) => [path, index]));
        return folders.sort((a, b) => {
            const aIndex = order.get(a.path);
            const bIndex = order.get(b.path);
            if (aIndex !== undefined || bIndex !== undefined) {
                return (aIndex ?? Number.MAX_SAFE_INTEGER) - (bIndex ?? Number.MAX_SAFE_INTEGER);
            }
            return compareNames(a, b);
        });
    }

    async reorderRootFolders(draggedPath: string, targetPath: string, insertAfter: boolean): Promise<void> {
        if (draggedPath === targetPath) {
            return;
        }
        const paths = this.getRootFolders().map(folder => folder.path);
        if (!paths.includes(draggedPath) || !paths.includes(targetPath)) {
            return;
        }
        const reordered = paths.filter(path => path !== draggedPath);
        const targetIndex = reordered.indexOf(targetPath);
        reordered.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedPath);
        this.settings.rootFolderOrder = reordered;
        await this.saveSettings();
    }

    getFolder(path: string): TFolder | null {
        if (path === ROOT_PATH) {
            return this.app.vault.getRoot();
        }
        const vault = this.app.vault as typeof this.app.vault & {
            getFolderByPath?: (folderPath: string) => TFolder | null;
        };
        if (typeof vault.getFolderByPath === "function") {
            return vault.getFolderByPath(path);
        }
        const file = vault.getAbstractFileByPath(path);
        return file instanceof TFolder ? file : null;
    }

    getNavigationEntries(): NavigationEntry[] {
        const rootFolders = this.getRootFolders();
        const hidden = new Set(this.settings.hiddenRootPaths);
        const rootEntries: NavigationEntry[] = rootFolders
            .filter(folder => !this.isHiddenByPattern(folder.path))
            .filter(folder => !hidden.has(folder.path) || this.settings.customFolders.includes(folder.path))
            .map(folder => ({ path: folder.path, name: folder.name, kind: "root-folder" }));

        const customEntries: NavigationEntry[] = [];
        this.settings.customFolders.forEach(path => {
            const folder = this.getFolder(path);
            if (folder && !this.isHiddenByPattern(folder.path)) {
                customEntries.push({
                    path: folder.path,
                    name: this.getCustomFolderDisplayName(folder.path, folder.name),
                    kind: "custom"
                });
            }
        });

        const byPath = new Map<string, NavigationEntry>();
        [...rootEntries, ...customEntries].forEach(entry => byPath.set(entry.path, entry));
        const entries = [...byPath.values()];
        const pinned = new Set(this.settings.pinnedPaths);
        const rootOrder = new Map(rootEntries.map((entry, index) => [entry.path, index]));
        entries.sort((a, b) => {
            const pinDifference = Number(pinned.has(b.path)) - Number(pinned.has(a.path));
            if (pinDifference) {
                return pinDifference;
            }
            if (a.kind === "root-folder" && b.kind === "root-folder") {
                return (rootOrder.get(a.path) ?? 0) - (rootOrder.get(b.path) ?? 0);
            }
            return compareNames(a, b);
        });

        return [{ path: ROOT_PATH, name: this.app.vault.getName(), kind: "root" }, ...entries];
    }

    isPinned(path: string): boolean {
        return this.settings.pinnedPaths.includes(path);
    }

    async togglePinned(path: string): Promise<void> {
        if (path === ROOT_PATH) {
            return;
        }
        const pinned = new Set(this.settings.pinnedPaths);
        if (pinned.has(path)) {
            pinned.delete(path);
        } else {
            pinned.add(path);
        }
        this.settings.pinnedPaths = [...pinned];
        await this.saveSettings();
    }

    async toggleHiddenRoot(path: string): Promise<void> {
        const hidden = new Set(this.settings.hiddenRootPaths);
        if (hidden.has(path)) {
            hidden.delete(path);
        } else {
            hidden.add(path);
        }
        this.settings.hiddenRootPaths = [...hidden];
        await this.saveSettings();
    }

    async addCustomFolder(input: string): Promise<boolean> {
        const path = normalizeFolderPath(input);
        if (path === ROOT_PATH || !this.getFolder(path)) {
            new Notice("请输入仓库中存在的目录路径。目录层级用 / 分隔。", 4000);
            return false;
        }
        if (this.settings.customFolders.includes(path)) {
            return false;
        }
        this.settings.customFolders.push(path);
        await this.saveSettings();
        return true;
    }

    getCustomFolderDisplayName(path: string, fallbackName: string): string {
        return this.settings.customFolderNames[path] || fallbackName;
    }

    async updateCustomFolderDisplayName(path: string, value: string): Promise<void> {
        if (!this.settings.customFolders.includes(path)) {
            return;
        }
        const displayName = value.trim();
        const names = { ...this.settings.customFolderNames };
        if (displayName) {
            names[path] = displayName;
        } else {
            delete names[path];
        }
        this.settings.customFolderNames = names;
        await this.saveSettings();
    }

    async removeCustomFolder(path: string): Promise<void> {
        this.settings.customFolders = this.settings.customFolders.filter(item => item !== path);
        this.settings.pinnedPaths = this.settings.pinnedPaths.filter(item => item !== path);
        const names = { ...this.settings.customFolderNames };
        delete names[path];
        this.settings.customFolderNames = names;
        await this.saveSettings();
    }

    refreshViews(): void {
        this.views.forEach(view => view.refresh());
    }

    removeView(view: FolderColumnNavigatorView): void {
        this.views.delete(view);
    }

    openSettings(): void {
        const settings = (this.app as typeof this.app & {
            setting?: { open: () => void; openTabById: (id: string) => void };
        }).setting;
        settings?.open();
        settings?.openTabById(this.manifest.id);
    }

    private cleanPathList(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return [...new Set(value.filter((path): path is string => typeof path === "string").map(normalizeFolderPath))];
    }

    private async activateView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (existing) {
            await this.app.workspace.revealLeaf(existing);
            return;
        }

        const leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
        await this.app.workspace.revealLeaf(leaf);
    }

    private async activateCalendarView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)[0];
        if (existing) {
            await this.app.workspace.revealLeaf(existing);
            return;
        }

        const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
        await leaf.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
        await this.app.workspace.revealLeaf(leaf);
    }
}

class FolderColumnNavigatorView extends ItemView {
    private readonly plugin: FolderColumnNavigatorPlugin;
    private navigationBasePath = ROOT_PATH;
    private columnPaths: string[] = [ROOT_PATH];
    private selectedFilePath: string | null = null;
    private activeColumnIndex = 0;
    private topRootFolderPane!: HTMLElement;
    private shellEl!: HTMLElement;
    private calendarPane!: HTMLElement;
    private calendarContentEl!: HTMLElement;
    private calendarGridEl!: HTMLElement;
    private calendarWeekNumbersEl!: HTMLElement;
    private calendarHostEl!: HTMLElement;
    private calendarToolbarTitle!: HTMLButtonElement;
    private calendarMonthModeButton!: HTMLButtonElement;
    private calendarWeekModeButton!: HTMLButtonElement;
    private calendarYearModeButton!: HTMLButtonElement;
    private calendarYearPickerEl!: HTMLElement;
    private calendarToggleButton!: HTMLButtonElement;
    private calendar: Calendar | null = null;
    private calendarExpanded = false;
    private calendarDisplayMode: CalendarDisplayMode = "month";
    private calendarDateMatches = new Map<string, TFile[]>();
    private calendarResultsEl: HTMLElement | null = null;
    private calendarSelectedDateKey: string | null = null;
    private calendarResizeObserver: ResizeObserver | null = null;
    private calendarResizeFrame: number | null = null;
    private viewHostEl: HTMLElement | null = null;
    private viewContentEl: HTMLElement | null = null;
    private navigationEl!: HTMLElement;
    private columnsEl!: HTMLElement;
    private breadcrumbEl!: HTMLElement;
    private sideNavigationFilterButton!: HTMLButtonElement;
    private topNavigationFilterButton: HTMLButtonElement | null = null;
    private sortSelect!: HTMLSelectElement;
    private sortDirectionButton!: HTMLButtonElement;
    private rootFolderGrid: HTMLElement | null = null;
    private rootFolderExpandButton: HTMLButtonElement | null = null;
    private rootFoldersExpanded = false;
    private rootFolderResizeObserver: ResizeObserver | null = null;
    private draggedRootFolderPath: string | null = null;
    private draggedItemPath: string | null = null;
    private dragHoverTargetPath: string | null = null;
    private dragExpandedTargetPath: string | null = null;
    private dragExpandTimer: number | null = null;
    private isResizing = false;
    private resizePointerId: number | null = null;
    private resizeWidth = DEFAULT_NAVIGATION_WIDTH;
    private columnResize: { path: string; pointerId: number; startX: number; startWidth: number } | null = null;
    private filterState: FilterState | null = null;
    private readonly columnWidths = new Map<string, number>();
    private readonly columnPreferredWidths = new Map<string, number>();
    private lastFocusedRow: { area: "navigation" | "column"; path: string; columnIndex?: number; kind?: string } | null = null;
    private readonly childColumnSelections = new Map<string, { childPath: string; itemPath: string; kind?: string }>();
    private readonly navigationPositions = new Map<string, NavigationPosition>();
    private readonly keydownHandler = (event: KeyboardEvent): void => this.handleKeyDown(event);
    private readonly focusinHandler = (event: FocusEvent): void => this.handleFocusIn(event);
    private readonly pointerdownHandler = (event: PointerEvent): void => this.handlePointerDown(event);
    private readonly clickHandler = (event: MouseEvent): void => this.handleBlankClick(event);
    private contextMenu: Menu | null = null;
    private contextMenuEl: HTMLElement | null = null;
    private contextMenuOrigin: HTMLElement | null = null;
    private contextMenuFilter = "";
    private contextMenuFilterEl: HTMLElement | null = null;
    private contextMenuActiveIndex = 0;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: FolderColumnNavigatorPlugin,
        private readonly isStandaloneCalendar = false
    ) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return this.isStandaloneCalendar ? CALENDAR_VIEW_TYPE : VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.isStandaloneCalendar ? "目录文件日历" : "目录文件列表";
    }

    getIcon(): string {
        return this.isStandaloneCalendar ? "calendar-days" : "folder-tree";
    }

    async onOpen(): Promise<void> {
        this.containerEl.empty();
        this.containerEl.addClass("folder-column-navigator-view");
        this.viewContentEl = this.containerEl.closest<HTMLElement>(".view-content") ?? this.containerEl;
        this.viewContentEl.addClass("fcn-view-content-reset");
        this.viewHostEl = this.containerEl.closest<HTMLElement>(".workspace-leaf-content");
        this.viewHostEl?.addClass("fcn-calendar-view-host");
        this.containerEl.tabIndex = 0;
        this.resizeWidth = this.plugin.settings.navigationWidth;

        const layout = this.containerEl.createDiv("fcn-layout");
        if (this.isStandaloneCalendar) {
            layout.addClass("fcn-calendar-standalone-layout");
            this.calendarExpanded = true;
            this.createCalendarPane(layout);
            this.refresh();
            return;
        }
        this.topRootFolderPane = layout.createDiv("fcn-top-root-folder-pane");
        this.shellEl = layout.createDiv("fcn-shell");
        this.applyNavigationWidth(this.resizeWidth);

        const navigationPane = this.shellEl.createDiv("fcn-navigation-pane");
        const navigationHeader = navigationPane.createDiv("fcn-pane-header");
        const navigationActions = navigationHeader.createDiv("fcn-pane-actions");
        this.sideNavigationFilterButton = this.createNavigationFilterButton(navigationActions);
        this.createLocateButton(navigationActions);
        this.createSettingsButton(navigationActions);
        this.navigationEl = navigationPane.createDiv("fcn-navigation-list");

        const divider = this.shellEl.createDiv("fcn-resize-divider");
        divider.setAttribute("role", "separator");
        divider.setAttribute("aria-label", "调整目录列宽度");
        divider.addEventListener("pointerdown", event => this.startResize(event));

        const contentPane = this.shellEl.createDiv("fcn-content-pane");
        const listHeader = contentPane.createDiv("fcn-list-header");
        const titleGroup = listHeader.createDiv("fcn-title-group");
        this.breadcrumbEl = titleGroup.createDiv("fcn-breadcrumb");
        const headerActions = listHeader.createDiv("fcn-list-header-actions");
        const sortControls = headerActions.createDiv("fcn-sort-controls");
        this.sortSelect = sortControls.createEl("select", {
            cls: "fcn-sort-select",
            attr: { "aria-label": "文件列表排序字段" }
        });
        [
            ["name", "名称"],
            ["modified", "修改日期"],
            ["created", "创建日期"]
        ].forEach(([value, label]) => {
            this.sortSelect.createEl("option", { value, text: label });
        });
        this.sortSelect.value = this.plugin.settings.sortField;
        this.sortSelect.addEventListener("change", () => {
            void this.plugin.updateSort(this.sortSelect.value as SortField);
        });
        this.sortDirectionButton = sortControls.createEl("button", {
            cls: "fcn-sort-direction clickable-icon",
            attr: { "aria-label": "切换排序方向" }
        });
        this.sortDirectionButton.addEventListener("click", () => void this.plugin.toggleSortDirection());
        this.columnsEl = contentPane.createDiv("fcn-columns");

        this.createCalendarPane(layout);

        this.containerEl.addEventListener("keydown", this.keydownHandler);
        this.containerEl.addEventListener("focusin", this.focusinHandler);
        this.containerEl.addEventListener("pointerdown", this.pointerdownHandler);
        this.containerEl.addEventListener("click", this.clickHandler);
        this.rootFolderResizeObserver = new ResizeObserver(() => this.updateRootFolderOverflow());
        this.refresh();
    }

    async onClose(): Promise<void> {
        this.containerEl.removeEventListener("keydown", this.keydownHandler);
        this.containerEl.removeEventListener("focusin", this.focusinHandler);
        this.containerEl.removeEventListener("pointerdown", this.pointerdownHandler);
        this.containerEl.removeEventListener("click", this.clickHandler);
        this.stopResize();
        this.stopColumnResize();
        this.clearItemDragState();
        this.closeContextMenu(false);
        this.calendar?.destroy();
        this.calendar = null;
        this.calendarResizeObserver?.disconnect();
        this.calendarResizeObserver = null;
        if (this.calendarResizeFrame !== null) {
            window.cancelAnimationFrame(this.calendarResizeFrame);
            this.calendarResizeFrame = null;
        }
        this.rootFolderResizeObserver?.disconnect();
        this.rootFolderResizeObserver = null;
        this.viewContentEl?.removeClass("fcn-view-content-reset");
        this.viewContentEl = null;
        this.viewHostEl?.removeClass("fcn-calendar-view-host");
        this.viewHostEl = null;
        this.plugin.removeView(this);
        this.containerEl.empty();
    }

    getState(): Record<string, unknown> {
        return {
            navigationBasePath: this.navigationBasePath,
            columnPaths: this.columnPaths
        };
    }

    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        if (typeof state === "object" && state !== null) {
            const next = state as { navigationBasePath?: unknown; columnPaths?: unknown; selectedPath?: unknown };
            const basePath = typeof next.navigationBasePath === "string"
                ? next.navigationBasePath
                : typeof next.selectedPath === "string" ? next.selectedPath : ROOT_PATH;
            const paths = Array.isArray(next.columnPaths)
                ? next.columnPaths.filter((path): path is string => typeof path === "string")
                : [basePath];
            this.setColumnState(basePath, paths);
        }
        await super.setState(state, result);
        this.refresh();
    }

    refresh(): void {
        if (this.isStandaloneCalendar) {
            this.updateCalendarPane();
            this.ensureCalendar();
            this.refreshCalendarDateMatches();
            return;
        }
        if (!this.navigationEl || !this.columnsEl) {
            return;
        }
        this.containerEl.setCssProps({
            "--fcn-root-folder-font-size": `${this.plugin.settings.rootFolderFontSize}px`,
            "--fcn-file-name-font-size": `${this.plugin.settings.fileNameFontSize}px`,
            "--fcn-item-name-max-lines": String(this.plugin.settings.wrapItemNameMaxLines)
        });
        this.containerEl.toggleClass("fcn-wrap-item-names", this.plugin.settings.wrapItemNames);
        this.updateCalendarPane();
        this.repairColumnState();
        this.shellEl.toggleClass("fcn-root-top-mode", this.plugin.settings.showRootFoldersAtTop);
        this.topRootFolderPane.toggleClass("is-visible", this.plugin.settings.showRootFoldersAtTop);
        this.renderNavigation();
        this.renderHeader();
        this.renderColumns();
        this.refreshCalendarDateMatches();
    }

    private createCalendarPane(layout: HTMLElement): void {
        this.calendarPane = layout.createDiv("fcn-calendar-pane");
        const header = this.calendarPane.createDiv("fcn-calendar-header");
        this.calendarToggleButton = header.createEl("button", {
            cls: "fcn-calendar-toggle",
            attr: { type: "button", "aria-expanded": "false" }
        });
        const icon = this.calendarToggleButton.createSpan("fcn-calendar-toggle-icon");
        setIcon(icon, "calendar-days");
        this.calendarToggleButton.createSpan({ text: "日历", cls: "fcn-calendar-toggle-label" });
        const chevron = this.calendarToggleButton.createSpan("fcn-calendar-toggle-chevron");
        setIcon(chevron, "chevron-up");
        this.calendarToggleButton.addEventListener("click", () => this.toggleCalendar());
        this.calendarContentEl = this.calendarPane.createDiv("fcn-calendar-content");
        const toolbar = this.calendarContentEl.createDiv("fcn-calendar-toolbar");
        const previousButton = this.createCalendarToolbarButton(toolbar, "chevron-left", "上一月");
        previousButton.addEventListener("click", () => this.navigateCalendar(-1));
        this.calendarToolbarTitle = toolbar.createEl("button", {
            cls: "fcn-calendar-title",
            attr: { type: "button", "aria-label": "切换月视图和年视图" }
        });
        this.calendarToolbarTitle.addEventListener("click", () => this.setCalendarDisplayMode(
            this.calendarDisplayMode === "month" ? "year" : "month"
        ));
        const nextButton = this.createCalendarToolbarButton(toolbar, "chevron-right", "下一月");
        nextButton.addEventListener("click", () => this.navigateCalendar(1));
        const spacer = toolbar.createSpan("fcn-calendar-toolbar-spacer");
        spacer.setAttribute("aria-hidden", "true");
        const modeSwitcher = toolbar.createDiv("fcn-calendar-mode-switcher");
        this.calendarMonthModeButton = modeSwitcher.createEl("button", {
            cls: "fcn-calendar-mode-button",
            text: "月",
            attr: { type: "button", "aria-label": "显示月视图" }
        });
        this.calendarMonthModeButton.addEventListener("click", () => this.setCalendarDisplayMode("month"));
        this.calendarWeekModeButton = modeSwitcher.createEl("button", {
            cls: "fcn-calendar-mode-button",
            text: "周",
            attr: { type: "button", "aria-label": "显示周视图" }
        });
        this.calendarWeekModeButton.addEventListener("click", () => this.setCalendarDisplayMode("week"));
        this.calendarYearModeButton = modeSwitcher.createEl("button", {
            cls: "fcn-calendar-mode-button",
            text: "年",
            attr: { type: "button", "aria-label": "显示年选择" }
        });
        this.calendarYearModeButton.addEventListener("click", () => this.setCalendarDisplayMode("year"));
        const todayButton = this.createCalendarToolbarButton(toolbar, "crosshair", "回到今天");
        todayButton.addEventListener("click", () => this.goToCalendarToday());
        this.calendarGridEl = this.calendarContentEl.createDiv("fcn-calendar-grid");
        this.calendarWeekNumbersEl = this.calendarGridEl.createDiv("fcn-calendar-week-numbers");
        this.calendarHostEl = this.calendarGridEl.createDiv("fcn-calendar-host");
        this.calendarYearPickerEl = this.calendarContentEl.createDiv("fcn-calendar-year-picker");
        this.calendarResultsEl = this.calendarContentEl.createDiv("fcn-calendar-results");
        this.calendarPane.addEventListener("keydown", event => event.stopPropagation());
        this.calendarPane.addEventListener("pointerdown", event => event.stopPropagation());
        this.calendarPane.addEventListener("click", event => event.stopPropagation());
        this.calendarResizeObserver = new ResizeObserver(() => this.handleCalendarResize());
        this.calendarResizeObserver.observe(this.calendarPane);
        this.updateCalendarPane();
        this.updateCalendarDisplayMode();
    }

    private createCalendarToolbarButton(parent: HTMLElement, iconName: string, label: string): HTMLButtonElement {
        const button = parent.createEl("button", {
            cls: "fcn-calendar-toolbar-button clickable-icon",
            attr: { type: "button", "aria-label": label, title: label }
        });
        setIcon(button, iconName);
        return button;
    }

    private toggleCalendar(): void {
        this.calendarExpanded = !this.calendarExpanded;
        this.updateCalendarPane();
        if (!this.calendarExpanded) {
            return;
        }
        this.ensureCalendar();
        window.requestAnimationFrame(() => this.calendar?.updateSize());
    }

    private updateCalendarPane(): void {
        const shouldShowBottomCalendar = this.isStandaloneCalendar || this.plugin.settings.showCalendarAtBottom;
        this.calendarPane.toggleClass("is-expanded", this.calendarExpanded);
        this.calendarPane.toggleClass("is-standalone", this.isStandaloneCalendar);
        this.calendarPane.toggleClass("is-hidden-by-presentation", !shouldShowBottomCalendar);
        this.calendarToggleButton.setAttribute("aria-expanded", String(this.calendarExpanded));
        this.calendarToggleButton.setAttribute("aria-label", this.calendarExpanded ? "收起日历" : "展开日历");
        const chevron = this.calendarToggleButton.querySelector<HTMLElement>(".fcn-calendar-toggle-chevron");
        if (chevron) {
            setIcon(chevron, this.calendarExpanded ? "chevron-down" : "chevron-up");
        }
        this.handleCalendarResize();
    }

    private handleCalendarResize(): void {
        if (!this.calendar || !this.calendarExpanded || this.calendarResizeFrame !== null) {
            return;
        }
        this.calendarResizeFrame = window.requestAnimationFrame(() => {
            this.calendarResizeFrame = null;
            this.calendar?.updateSize();
            this.updateCalendarDateCells();
        });
    }

    private ensureCalendar(): void {
        if (this.calendar) {
            return;
        }
        this.calendar = new Calendar(this.calendarHostEl, {
            plugins: [dayGridPlugin, interactionPlugin],
            initialView: "dayGridMonth",
            initialDate: new Date(),
            locale: zhCnLocale,
            firstDay: 1,
            weekNumbers: false,
            dayCellContent: info => String(info.date.getDate()),
            dayHeaderContent: info => ["日", "一", "二", "三", "四", "五", "六"][info.date.getDay()],
            headerToolbar: false,
            fixedWeekCount: true,
            showNonCurrentDates: false,
            height: "auto",
            dateClick: info => this.openCalendarDate(info.date),
            datesSet: () => this.refreshCalendarDateMatches()
        });
        this.calendar.render();
        this.refreshCalendarDateMatches();
    }

    private navigateCalendar(offset: number): void {
        const currentDate = this.calendar?.getDate() ?? new Date();
        const nextDate = new Date(currentDate);
        if (this.calendarDisplayMode === "year") {
            nextDate.setFullYear(nextDate.getFullYear() + offset);
        } else if (this.calendarDisplayMode === "week") {
            nextDate.setDate(nextDate.getDate() + offset * 7);
        } else {
            nextDate.setMonth(nextDate.getMonth() + offset);
        }
        this.calendar?.gotoDate(nextDate);
        this.refreshCalendarDateMatches();
    }

    private goToCalendarToday(): void {
        this.calendar?.gotoDate(new Date());
        this.setCalendarDisplayMode("month");
    }

    private setCalendarDisplayMode(mode: CalendarDisplayMode): void {
        if (this.calendarDisplayMode === mode) {
            return;
        }
        this.calendarDisplayMode = mode;
        if (mode !== "year") {
            this.calendar?.changeView(mode === "week" ? "dayGridWeek" : "dayGridMonth");
        }
        this.updateCalendarDisplayMode();
        this.refreshCalendarDateMatches();
        if (mode === "month") {
            window.requestAnimationFrame(() => this.calendar?.updateSize());
        }
    }

    private updateCalendarDisplayMode(): void {
        const isYearMode = this.calendarDisplayMode === "year";
        this.calendarGridEl?.toggleClass("is-hidden", isYearMode);
        this.calendarGridEl?.toggleClass("is-week-view", this.calendarDisplayMode === "week");
        this.calendarYearPickerEl?.toggleClass("is-hidden", !isYearMode);
        this.calendarMonthModeButton?.toggleClass("is-active", this.calendarDisplayMode === "month");
        this.calendarWeekModeButton?.toggleClass("is-active", this.calendarDisplayMode === "week");
        this.calendarYearModeButton?.toggleClass("is-active", isYearMode);
        this.renderCalendarToolbar();
        if (isYearMode) {
            this.renderCalendarYearPicker();
        }
    }

    private renderCalendarToolbar(): void {
        if (!this.calendarToolbarTitle) {
            return;
        }
        const date = this.calendar?.getDate() ?? new Date();
        this.calendarToolbarTitle.setText(this.calendarDisplayMode === "year"
            ? `${date.getFullYear()} 年`
            : this.calendarDisplayMode === "week"
                ? `${date.getFullYear()} 年第 ${this.getIsoWeekNumber(date)} 周`
            : `${date.getFullYear()}年${date.getMonth() + 1}月`);
    }

    private renderCalendarYearPicker(): void {
        if (!this.calendarYearPickerEl) {
            return;
        }
        this.calendarYearPickerEl.empty();
        const date = this.calendar?.getDate() ?? new Date();
        const year = date.getFullYear();
        const currentMonth = date.getMonth();
        for (let month = 0; month < 12; month += 1) {
            const monthButton = this.calendarYearPickerEl.createEl("button", {
                cls: "fcn-calendar-year-month",
                text: `${month + 1} 月`,
                attr: { type: "button", "aria-label": `查看 ${year} 年 ${month + 1} 月` }
            });
            const hasMatches = [...this.calendarDateMatches.keys()].some(key => key.startsWith(
                `${year}-${String(month + 1).padStart(2, "0")}`
            ));
            monthButton.toggleClass("has-matches", hasMatches);
            monthButton.toggleClass("is-current", month === currentMonth);
            monthButton.addEventListener("click", () => {
                this.calendar?.gotoDate(new Date(year, month, 1));
                this.setCalendarDisplayMode("month");
            });
        }
    }

    private openCalendarDate(date: Date): void {
        const files = this.calendarDateMatches.get(formatCalendarDate(date)) ?? [];
        if (files.length === 0) {
            return;
        }
        if (this.isStandaloneCalendar) {
            this.calendarSelectedDateKey = formatCalendarDate(date);
            this.updateCalendarDateCells();
            this.renderCalendarMatchedFiles();
            if (files.length === 1 && this.plugin.settings.calendarOpenSingleMatch) {
                void this.openFile(files[0]);
            }
            return;
        }
        if (files.length === 1 && this.plugin.settings.calendarOpenSingleMatch) {
            void this.openCalendarMatchedFile(files[0]);
            return;
        }
        new DateMatchedFilesModal(this.plugin.app, date, files, file => this.openCalendarMatchedFile(file)).open();
    }

    private async openCalendarMatchedFile(file: TFile): Promise<void> {
        const matchingEntries = this.plugin.getNavigationEntries()
            .filter(entry => entry.path === ROOT_PATH || file.path.startsWith(`${entry.path}/`))
            .sort((left, right) => right.path.length - left.path.length);
        const basePath = matchingEntries[0]?.path ?? ROOT_PATH;
        this.navigationBasePath = basePath;
        this.columnPaths = this.buildFolderChain(basePath, file.parent?.path ?? ROOT_PATH);
        this.activeColumnIndex = this.columnPaths.length - 1;
        this.selectedFilePath = file.path;
        this.filterState = null;
        this.refresh();
        await this.openFile(file);
    }

    private refreshCalendarDateMatches(): void {
        if (!this.calendar) {
            return;
        }
        const date = this.calendar.getDate();
        const start = this.calendarDisplayMode === "year"
            ? new Date(date.getFullYear(), 0, 1)
            : this.calendarDisplayMode === "week"
                ? this.getCalendarWeekStart(date)
                : new Date(date.getFullYear(), date.getMonth(), 1);
        const end = this.calendarDisplayMode === "year"
            ? new Date(date.getFullYear() + 1, 0, 1)
            : this.calendarDisplayMode === "week"
                ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
                : new Date(date.getFullYear(), date.getMonth() + 1, 1);
        this.calendarDateMatches = this.buildCalendarDateMatches(start, end);
        if (this.isStandaloneCalendar && !this.calendarSelectedDateKey) {
            const todayKey = formatCalendarDate(new Date());
            if (this.calendarDateMatches.has(todayKey)) {
                this.calendarSelectedDateKey = todayKey;
            }
        }
        if (this.calendarSelectedDateKey && !this.calendarDateMatches.has(this.calendarSelectedDateKey)) {
            this.calendarSelectedDateKey = null;
        }
        this.updateCalendarDateCells();
        window.requestAnimationFrame(() => this.updateCalendarDateCells());
        this.renderCalendarWeekNumbers();
        this.renderCalendarToolbar();
        if (this.calendarDisplayMode === "year") {
            this.renderCalendarYearPicker();
        }
        this.renderCalendarMatchedFiles();
    }

    private buildCalendarDateMatches(start: Date, end: Date): Map<string, TFile[]> {
        const settings = this.plugin.settings;
        const matches = new Map<string, TFile[]>();
        const startKey = formatCalendarDate(start);
        const endKey = formatCalendarDate(end);
        const addMatch = (key: string, file: TFile): void => {
            if (key < startKey || key >= endKey) {
                return;
            }
            const files = matches.get(key) ?? [];
            if (!files.some(candidate => candidate.path === file.path)) {
                files.push(file);
                matches.set(key, files);
            }
        };

        this.plugin.app.vault.getFiles()
            .filter(file => !this.plugin.isHiddenByPattern(file.path))
            .filter(file => settings.calendarSearchPaths.length === 0 || settings.calendarSearchPaths.some(path =>
                file.path.startsWith(`${path}/`)
            ))
            .filter(file => settings.calendarFileExtensions.length === 0 || settings.calendarFileExtensions.includes(
                file.extension.toLocaleLowerCase()
            ))
            .forEach(file => {
                if (settings.calendarMatchCreatedDate) {
                    addMatch(formatCalendarDate(new Date(file.stat.ctime)), file);
                }
                if (settings.calendarMatchModifiedDate) {
                    addMatch(formatCalendarDate(new Date(file.stat.mtime)), file);
                }
                if (settings.calendarMatchFrontmatter) {
                    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
                    settings.calendarFrontmatterKeys.forEach(key => {
                        extractCalendarDateKeys(frontmatter?.[key]).forEach(dateKey => addMatch(dateKey, file));
                    });
                }
                if (settings.calendarMatchFilename) {
                    extractCalendarDateKeysFromFilename(file.basename, settings.calendarFilenamePatterns)
                        .forEach(dateKey => addMatch(dateKey, file));
                }
            });

        matches.forEach(files => files.sort((left, right) => left.path.localeCompare(
            right.path,
            undefined,
            { numeric: true, sensitivity: "base" }
        )));
        return matches;
    }

    private updateCalendarDateCells(): void {
        if (!this.calendarHostEl) {
            return;
        }
        this.calendarHostEl.querySelectorAll<HTMLElement>(".fc-daygrid-day[data-date]").forEach(cell => {
            const dateKey = cell.dataset.date ?? "";
            const matchCount = this.calendarDateMatches.get(dateKey)?.length ?? 0;
            const hasMatches = matchCount > 0;
            cell.toggleClass("fcn-calendar-date-available", hasMatches);
            cell.toggleClass("fcn-calendar-date-single", matchCount === 1);
            cell.toggleClass("fcn-calendar-date-multiple", matchCount > 1);
            cell.toggleClass("fcn-calendar-date-selected", dateKey === this.calendarSelectedDateKey);
            cell.toggleClass("fcn-calendar-date-unavailable", !hasMatches);
            cell.dataset.fcnMatchCount = hasMatches ? String(matchCount) : "";
            cell.setAttribute("aria-disabled", String(!hasMatches));
            if (dateKey === this.calendarSelectedDateKey) {
                cell.setAttribute("aria-current", "date");
            } else {
                cell.removeAttribute("aria-current");
            }
            cell.setAttribute("title", hasMatches ? `匹配 ${matchCount} 个文件` : "没有匹配文件");
            const dayNumber = cell.querySelector<HTMLElement>(".fc-daygrid-day-number");
            dayNumber?.setAttribute(
                "aria-label",
                hasMatches ? `${dateKey}，匹配 ${matchCount} 个文件` : `${dateKey}，没有匹配文件`
            );
            if (dayNumber) {
                dayNumber.dataset.fcnMatchCount = hasMatches ? String(matchCount) : "";
            }
        });
    }

    private renderCalendarMatchedFiles(): void {
        if (!this.calendarResultsEl) {
            return;
        }
        this.calendarResultsEl.empty();
        this.calendarResultsEl.toggleClass("is-visible", this.isStandaloneCalendar && Boolean(this.calendarSelectedDateKey));
        if (!this.isStandaloneCalendar || !this.calendarSelectedDateKey) {
            return;
        }
        const files = this.calendarDateMatches.get(this.calendarSelectedDateKey) ?? [];
        if (files.length === 0) {
            this.calendarSelectedDateKey = null;
            this.calendarResultsEl.removeClass("is-visible");
            return;
        }
        const header = this.calendarResultsEl.createDiv("fcn-calendar-results-header");
        header.createSpan({ text: this.calendarSelectedDateKey, cls: "fcn-calendar-results-date" });
        header.createSpan({ text: `${files.length} 个文件`, cls: "fcn-calendar-results-count" });
        const list = this.calendarResultsEl.createDiv("fcn-calendar-results-list");
        files.forEach(file => {
            const row = list.createEl("button", {
                cls: "fcn-file-item fcn-calendar-results-item",
                attr: { type: "button", title: file.path, "aria-label": `打开 ${file.path}` }
            });
            if (this.plugin.settings.calendarShowFileIcons) {
                const icon = row.createSpan("fcn-item-icon");
                setIcon(icon, "file-text");
            }
            const text = row.createDiv("fcn-calendar-results-text");
            text.createSpan({ text: file.name, cls: "fcn-calendar-results-name" });
            text.createSpan({ text: file.parent?.path ?? this.plugin.app.vault.getName(), cls: "fcn-calendar-results-path" });
            row.addEventListener("click", () => void this.openFile(file));
        });
    }

    private getCalendarWeekStart(date: Date): Date {
        const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        return start;
    }

    private renderCalendarWeekNumbers(): void {
        if (!this.calendarWeekNumbersEl) {
            return;
        }
        this.calendarWeekNumbersEl.empty();
        this.calendarWeekNumbersEl.createDiv("fcn-calendar-week-number-spacer");
        const date = this.calendar?.getDate() ?? new Date();
        const firstDay = this.calendarDisplayMode === "week"
            ? this.getCalendarWeekStart(date)
            : new Date(date.getFullYear(), date.getMonth(), 1);
        const leadingDays = this.calendarDisplayMode === "week" ? 0 : (firstDay.getDay() + 6) % 7;
        const firstVisibleDate = this.calendarDisplayMode === "week"
            ? firstDay
            : new Date(date.getFullYear(), date.getMonth(), 1 - leadingDays);
        const rowCount = this.calendarDisplayMode === "week" ? 1 : 6;
        for (let row = 0; row < rowCount; row += 1) {
            const weekDate = new Date(firstVisibleDate);
            weekDate.setDate(firstVisibleDate.getDate() + row * 7);
            this.calendarWeekNumbersEl.createDiv({
                cls: "fcn-calendar-week-number",
                text: String(this.getIsoWeekNumber(weekDate))
            });
        }
    }

    private getIsoWeekNumber(date: Date): number {
        const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const day = target.getUTCDay() || 7;
        target.setUTCDate(target.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
        return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    }

    private renderNavigation(): void {
        this.navigationEl.empty();
        this.rootFolderGrid = null;
        this.rootFolderExpandButton = null;
        this.topNavigationFilterButton = null;
        this.rootFolderResizeObserver?.disconnect();

        const entries = this.plugin.getNavigationEntries();
        const rootEntry = entries[0];
        const rootFolders = entries.filter(entry => entry.kind === "root-folder");
        const customEntries = entries.filter(entry => entry.kind === "custom");

        if (this.plugin.settings.showRootFoldersAtTop) {
            this.renderTopRootFolders(rootEntry, [...rootFolders, ...customEntries]);
            return;
        }

        this.topRootFolderPane.empty();
        if (!this.plugin.settings.showRootFoldersAtTop) {
            entries.forEach(entry => this.createNavigationRow(
                this.navigationEl,
                entry,
                entry.kind === "custom" ? "fcn-custom-folder-list-item" : undefined
            ));
            return;
        }
    }

    private renderTopRootFolders(rootEntry: NavigationEntry, rootFolders: NavigationEntry[]): void {
        this.navigationEl.empty();
        this.topRootFolderPane.empty();
        const topSection = this.topRootFolderPane.createDiv("fcn-root-folder-section");
        const toolbar = topSection.createDiv("fcn-root-folder-toolbar");
        this.createNavigationRow(toolbar, rootEntry, "fcn-root-vault-item");
        const toolbarActions = toolbar.createDiv("fcn-pane-actions");
        this.topNavigationFilterButton = this.createNavigationFilterButton(toolbarActions);
        this.rootFolderExpandButton = toolbarActions.createEl("button", {
            cls: "fcn-root-folder-expand clickable-icon",
            attr: { type: "button", "aria-label": "展开更多一级目录" }
        });
        this.rootFolderExpandButton.createSpan("fcn-root-folder-expand-icon");
        this.rootFolderExpandButton.createSpan("fcn-root-folder-expand-label");
        this.createLocateButton(toolbarActions);
        this.createSettingsButton(toolbarActions);
        this.rootFolderGrid = topSection.createDiv("fcn-root-folder-grid");
        this.rootFolderGrid.setCssProps({
            "--fcn-visible-root-rows": String(this.plugin.settings.rootFolderVisibleRows)
        });
        rootFolders.forEach(entry => this.createNavigationRow(this.rootFolderGrid as HTMLElement, entry, "fcn-root-folder-item"));
        this.rootFolderExpandButton.addEventListener("click", () => {
            this.rootFoldersExpanded = !this.rootFoldersExpanded;
            this.updateRootFolderOverflow();
        });
        this.updateRootFolderOverflow();
        this.rootFolderResizeObserver?.observe(this.rootFolderGrid);
    }

    private createLocateButton(parent: HTMLElement): HTMLButtonElement {
        const button = parent.createEl("button", {
            cls: "fcn-icon-button clickable-icon",
            attr: { type: "button", "aria-label": "定位当前笔记" }
        });
        setIcon(button, "locate-fixed");
        button.addEventListener("click", () => this.revealActiveFile());
        return button;
    }

    private createSettingsButton(parent: HTMLElement): HTMLButtonElement {
        const button = parent.createEl("button", {
            cls: "fcn-icon-button clickable-icon",
            attr: { type: "button", "aria-label": "打开目录文件列表设置" }
        });
        setIcon(button, "settings");
        button.addEventListener("click", () => this.plugin.openSettings());
        return button;
    }

    private createNavigationFilterButton(parent: HTMLElement): HTMLButtonElement {
        const button = parent.createEl("button", {
            cls: "fcn-filter-badge fcn-navigation-filter-badge is-hidden",
            attr: { type: "button", title: "点击清除筛选" }
        });
        button.addEventListener("click", () => this.clearFilter());
        return button;
    }

    private createItemIcon(parent: HTMLElement, iconName: string | null): void {
        if (!iconName) {
            return;
        }
        const icon = parent.createSpan("fcn-item-icon");
        setIcon(icon, iconName);
    }

    private getFolderIcon(): string | null {
        if (this.plugin.settings.folderIconStyle === "none") {
            return null;
        }
        return this.plugin.settings.folderIconStyle === "chevron" ? "chevron-right" : "folder";
    }

    private getFolderNoteIcon(): string | null {
        return this.plugin.settings.folderIconStyle === "none" ? null : "bookmark";
    }

    private getFileIcon(file: TFile): string | null {
        if (this.plugin.settings.fileIconStyle === "none") {
            return null;
        }
        if (this.plugin.settings.fileIconStyle === "file") {
            return "file";
        }

        const extension = file.extension.toLocaleLowerCase();
        if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(extension)) {
            return "image";
        }
        if (["mp3", "wav", "flac", "ogg", "m4a", "aac"].includes(extension)) {
            return "music";
        }
        if (["mp4", "mov", "mkv", "avi", "webm", "m4v"].includes(extension)) {
            return "film";
        }
        if (["ts", "tsx", "js", "jsx", "py", "java", "kt", "go", "rs", "c", "cpp", "h", "css", "scss", "html", "xml", "yaml", "yml", "sh", "sql"].includes(extension)) {
            return "code-2";
        }
        if (extension === "json") {
            return "braces";
        }
        if (["csv", "tsv", "xls", "xlsx", "ods"].includes(extension)) {
            return "table-2";
        }
        if (["ppt", "pptx", "key"].includes(extension)) {
            return "presentation";
        }
        if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(extension)) {
            return "archive";
        }
        if (["md", "txt", "pdf", "doc", "docx", "rtf"].includes(extension)) {
            return "file-text";
        }
        return "file";
    }

    private createNavigationRow(parent: HTMLElement, entry: NavigationEntry, extraClass?: string, depth = 0): HTMLElement {
        const row = parent.createDiv(`fcn-navigation-item${extraClass ? ` ${extraClass}` : ""}`);
        const isTopFolderTag = extraClass?.includes("fcn-root-folder-item") ?? false;
        if (entry.kind === "root-folder" && !isTopFolderTag) {
            row.addClass("fcn-root-folder-list-item");
        }
        row.toggleClass("is-selected", entry.path === this.navigationBasePath);
        row.toggleClass("is-filtered-out", this.isNavigationFiltering() && !filterNameMatches(entry.name, this.filterState?.query ?? ""));
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.dataset.fcnRow = "navigation";
        row.dataset.fcnPath = entry.path;
        if (depth > 0) {
            row.setCssStyles({ paddingLeft: `${7 + depth * 14}px` });
        }

        this.createItemIcon(row, entry.kind === "root" ? "vault" : isTopFolderTag ? null : this.getFolderIcon());
        row.createSpan({ text: entry.name, cls: "fcn-item-name" });

        row.addEventListener("click", () => this.selectNavigationPath(entry.path));
        row.addEventListener("contextmenu", event => {
            event.preventDefault();
            this.markKeyboardSelection(row);
            row.focus();
            const folder = this.plugin.getFolder(entry.path);
            if (folder) {
                this.showFolderContextMenu(folder, row, event);
            } else {
                this.showNavigationMenu(event);
            }
        });
        const folder = this.plugin.getFolder(entry.path);
        if (folder) {
            this.enableMoveDropTarget(row, folder, entry.kind === "root-folder");
        }
        if (entry.kind === "root-folder") {
            this.enableRootFolderDragging(row, entry.path);
        } else if (folder && entry.kind !== "root") {
            this.enableItemDragging(row, folder);
        }
        return row;
    }

    private enableRootFolderDragging(row: HTMLElement, path: string): void {
        row.draggable = true;
        row.addClass("fcn-root-folder-draggable");
        row.addEventListener("dragstart", event => {
            const folder = this.plugin.getFolder(path);
            if (!folder) {
                return;
            }
            this.startItemDrag(row, folder, event);
            this.draggedRootFolderPath = path;
            row.addClass("is-root-folder-dragging");
        });
        row.addEventListener("dragover", event => {
            if (!this.draggedRootFolderPath || this.draggedRootFolderPath === path) {
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
            this.showRootFolderDropIndicator(row, event);
        });
        row.addEventListener("dragleave", event => {
            if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) {
                return;
            }
            row.removeClass("is-root-folder-drop-before", "is-root-folder-drop-after");
        });
        row.addEventListener("drop", event => {
            const draggedPath = this.draggedRootFolderPath;
            if (!draggedPath || draggedPath === path) {
                return;
            }
            event.preventDefault();
            const insertAfter = this.isRootFolderDropAfter(row, event);
            this.clearRootFolderDragState();
            this.clearItemDragState();
            void this.plugin.reorderRootFolders(draggedPath, path, insertAfter);
        });
        row.addEventListener("dragend", () => {
            this.clearRootFolderDragState();
            this.clearItemDragState();
        });
    }

    private isRootFolderDropAfter(row: HTMLElement, event: DragEvent): boolean {
        const rect = row.getBoundingClientRect();
        return row.parentElement === this.rootFolderGrid
            ? event.clientX >= rect.left + rect.width / 2
            : event.clientY >= rect.top + rect.height / 2;
    }

    private showRootFolderDropIndicator(row: HTMLElement, event: DragEvent): void {
        this.containerEl.querySelectorAll<HTMLElement>(".is-root-folder-drop-before, .is-root-folder-drop-after").forEach(item => {
            item.removeClass("is-root-folder-drop-before", "is-root-folder-drop-after");
        });
        row.addClass(this.isRootFolderDropAfter(row, event) ? "is-root-folder-drop-after" : "is-root-folder-drop-before");
    }

    private clearRootFolderDragState(): void {
        this.containerEl.querySelectorAll<HTMLElement>(
            ".is-root-folder-dragging, .is-root-folder-drop-before, .is-root-folder-drop-after"
        ).forEach(item => item.removeClass("is-root-folder-dragging", "is-root-folder-drop-before", "is-root-folder-drop-after"));
        this.draggedRootFolderPath = null;
    }

    private enableItemDragging(row: HTMLElement, item: TAbstractFile): void {
        row.draggable = true;
        row.addClass("fcn-item-draggable");
        row.addEventListener("dragstart", event => this.startItemDrag(row, item, event));
        row.addEventListener("dragend", () => this.clearItemDragState());
    }

    private startItemDrag(row: HTMLElement, item: TAbstractFile, event: DragEvent): void {
        this.clearItemDragState();
        this.draggedItemPath = item.path;
        row.addClass("is-item-dragging");
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-folder-column-navigator-path", item.path);
            event.dataTransfer.setData("text/plain", item.path);
        }
    }

    private enableMoveDropTarget(row: HTMLElement, folder: TFolder, isRootFolderReorderTarget = false): void {
        row.addEventListener("dragover", event => {
            if (isRootFolderReorderTarget && this.draggedRootFolderPath) {
                return;
            }
            const item = this.getDraggedItem();
            if (!item || !this.canMoveItemTo(item, folder)) {
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = "move";
            }
            row.addClass("is-move-drop-target");
            this.scheduleDragTargetExpansion(folder, row);
        });
        row.addEventListener("dragleave", event => {
            if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) {
                return;
            }
            row.removeClass("is-move-drop-target");
            this.cancelDragTargetExpansion(folder.path);
        });
        row.addEventListener("drop", event => {
            if (isRootFolderReorderTarget && this.draggedRootFolderPath) {
                return;
            }
            const item = this.getDraggedItem();
            if (!item || !this.canMoveItemTo(item, folder)) {
                return;
            }
            event.preventDefault();
            this.clearItemDragState();
            void this.moveItemTo(item, folder);
        });
    }

    private getDraggedItem(): TAbstractFile | null {
        return this.draggedItemPath
            ? this.plugin.app.vault.getAbstractFileByPath(this.draggedItemPath)
            : null;
    }

    private scheduleDragTargetExpansion(folder: TFolder, row: HTMLElement): void {
        if (this.dragExpandedTargetPath === folder.path || this.dragHoverTargetPath === folder.path) {
            return;
        }
        this.cancelDragTargetExpansion();
        this.dragExpandedTargetPath = null;
        this.dragHoverTargetPath = folder.path;
        this.dragExpandTimer = window.setTimeout(() => {
            this.dragExpandTimer = null;
            if (this.dragHoverTargetPath !== folder.path) {
                return;
            }
            this.dragExpandedTargetPath = folder.path;
            this.expandDragTarget(folder, row);
        }, DRAG_EXPAND_DELAY_MS);
    }

    private cancelDragTargetExpansion(path?: string): void {
        if (path && this.dragHoverTargetPath !== path) {
            return;
        }
        if (this.dragExpandTimer !== null) {
            window.clearTimeout(this.dragExpandTimer);
            this.dragExpandTimer = null;
        }
        this.dragHoverTargetPath = null;
    }

    private expandDragTarget(folder: TFolder, row: HTMLElement): void {
        const columnIndex = Number(row.dataset.fcnColumn);
        if (Number.isInteger(columnIndex)) {
            this.openFolderColumn(folder.path, columnIndex, false);
            return;
        }
        this.previewNavigationPath(folder.path);
    }

    private clearItemDragState(): void {
        this.cancelDragTargetExpansion();
        this.dragExpandedTargetPath = null;
        this.draggedItemPath = null;
        this.containerEl?.querySelectorAll<HTMLElement>(".is-item-dragging, .is-move-drop-target").forEach(item => {
            item.removeClass("is-item-dragging", "is-move-drop-target");
        });
    }

    private renderFolderTree(parent: HTMLElement, folder: TFolder, depth: number): void {
        const children = folder.children
            .filter((child): child is TFolder => child instanceof TFolder)
            .filter(child => !this.plugin.isHiddenByPattern(child.path))
            .sort(compareNames);
        children.forEach(child => {
            this.createNavigationRow(parent, { path: child.path, name: child.name, kind: "custom" }, "fcn-tree-item", depth);
            this.renderFolderTree(parent, child, depth + 1);
        });
    }

    private updateRootFolderOverflow(): void {
        if (!this.rootFolderGrid || !this.rootFolderExpandButton) {
            return;
        }
        this.rootFolderGrid.toggleClass("is-expanded", this.rootFoldersExpanded);
        const collapsedHeight = this.plugin.settings.rootFolderVisibleRows * 34 + 6;
        const hasOverflow = this.rootFolderGrid.scrollHeight > collapsedHeight + 1;
        this.rootFolderExpandButton.toggleClass("is-hidden", !hasOverflow);
        const icon = this.rootFolderExpandButton.querySelector<HTMLElement>(".fcn-root-folder-expand-icon");
        const label = this.rootFolderExpandButton.querySelector<HTMLElement>(".fcn-root-folder-expand-label");
        if (icon) {
            setIcon(icon, this.rootFoldersExpanded ? "chevron-up" : "chevron-down");
        }
        label?.setText(this.rootFoldersExpanded ? "收起" : "展开");
        this.rootFolderExpandButton.setAttribute(
            "aria-label",
            this.rootFoldersExpanded ? "收起一级目录" : "展开更多一级目录"
        );
    }

    private renderHeader(): void {
        const activePath = this.columnPaths[this.activeColumnIndex] ?? this.columnPaths[this.columnPaths.length - 1] ?? ROOT_PATH;
        const folder = this.plugin.getFolder(activePath) ?? this.plugin.app.vault.getRoot();
        this.breadcrumbEl.setText(folder.path === ROOT_PATH ? this.plugin.app.vault.getName() : folder.path);
        this.sortSelect.value = this.plugin.settings.sortField;
        setIcon(this.sortDirectionButton, this.plugin.settings.sortDirection === "asc" ? "arrow-up" : "arrow-down");
        this.sortDirectionButton.setAttribute(
            "aria-label",
            this.plugin.settings.sortDirection === "asc" ? "当前正序，点击切换为倒序" : "当前倒序，点击切换为正序"
        );
        this.updateNavigationFilterButtons();
    }

    private updateNavigationFilterButtons(): void {
        const navigationFilterQuery = this.filterState?.scope.area === "navigation" ? this.filterState.query : "";
        [this.sideNavigationFilterButton, this.topNavigationFilterButton].forEach(button => {
            if (!button) {
                return;
            }
            button.toggleClass("is-hidden", !navigationFilterQuery);
            button.setText(navigationFilterQuery ? `筛选：${navigationFilterQuery}` : "");
        });
    }

    private renderColumns(): void {
        this.columnsEl.empty();
        this.columnPaths.forEach((path, columnIndex) => this.renderColumn(path, columnIndex));
        window.requestAnimationFrame(() => this.ensureColumnVisible(this.activeColumnIndex));
    }

    private renderColumn(path: string, columnIndex: number): void {
        const folder = this.plugin.getFolder(path);
        if (!folder) {
            return;
        }

        const column = this.columnsEl.createDiv("fcn-column");
        column.dataset.fcnColumn = String(columnIndex);
        column.dataset.fcnPath = path;
        column.setCssProps({
            "--fcn-column-min-width": `${this.plugin.settings.columnMinWidth}px`,
            "--fcn-column-max-width": `${this.plugin.settings.columnMaxWidth}px`,
            "--fcn-column-width": `${this.getColumnWidth(path)}px`
        });
        const header = column.createDiv("fcn-column-header");
        header.createSpan({ text: folder.path === ROOT_PATH ? this.plugin.app.vault.getName() : folder.name });
        const filterQuery = this.getColumnFilterQuery(columnIndex);
        if (filterQuery) {
            const filterBadge = header.createEl("button", {
                cls: "fcn-filter-badge",
                text: `筛选：${filterQuery}`,
                attr: { type: "button", title: "点击或按 Esc 清除筛选" }
            });
            filterBadge.addEventListener("click", () => this.clearFilter());
        }
        const list = column.createDiv("fcn-column-list");
        const divider = column.createDiv("fcn-column-resize-divider");
        divider.setAttribute("role", "separator");
        divider.setAttribute("aria-label", `调整“${folder.name}”列宽度`);
        divider.addEventListener("pointerdown", event => this.startColumnResize(event, path));

        if (columnIndex > 0) {
            this.addSpecialListItem(list, columnIndex, "返回上一级", "arrow-left", () => {
                this.columnPaths = this.columnPaths.slice(0, columnIndex);
                this.selectedFilePath = null;
                this.activeColumnIndex = columnIndex - 1;
                this.refresh();
                this.focusFirstColumnItem(columnIndex - 1);
            });
        }

        const children = [...folder.children]
            .filter(child => !this.plugin.isHiddenByPattern(child.path))
            .filter(child => !filterQuery || filterNameMatches(child.name, filterQuery))
            .sort((a, b) => this.compareItems(a, b, folder));
        if (children.length === 0) {
            const empty = list.createDiv("fcn-empty-state");
            empty.setText(filterQuery ? `未找到“${filterQuery}”相关条目` : "此目录暂无文件或子目录");
            this.updateColumnPreferredWidth(column, path);
            return;
        }

        children.forEach((child, itemIndex) => {
            if (child instanceof TFolder) {
                this.addFolderListItem(list, child, columnIndex, itemIndex);
            } else if (child instanceof TFile) {
                this.addFileListItem(list, child, columnIndex, itemIndex, this.isFolderNote(child, folder));
            }
        });
        this.updateColumnPreferredWidth(column, path);
    }

    private addSpecialListItem(
        list: HTMLElement,
        columnIndex: number,
        name: string,
        iconName: string,
        onClick: () => void
    ): void {
        const row = list.createDiv("fcn-file-item fcn-special-item");
        this.setRowMetadata(row, columnIndex, 0, "special", "");
        row.setAttribute("tabindex", "0");
        const icon = row.createSpan("fcn-item-icon");
        setIcon(icon, iconName);
        row.createSpan({ text: name, cls: "fcn-item-name" });
        row.addEventListener("click", onClick);
    }

    private addFolderListItem(list: HTMLElement, folder: TFolder, columnIndex: number, itemIndex: number): void {
        const row = list.createDiv("fcn-file-item fcn-file-tree-item");
        this.setRowMetadata(row, columnIndex, itemIndex, "folder", folder.path);
        row.toggleClass("is-selected", this.columnPaths[columnIndex + 1] === folder.path);
        row.setAttribute("tabindex", "0");
        this.createItemIcon(row, this.getFolderIcon());
        const folderNote = this.getFolderNote(folder);
        this.createItemContent(row, folder.name, folderNote ? this.getFrontmatterDetail(
            folderNote,
            this.plugin.settings.folderNoteMetadataKeys
        ) : null);
        if (this.plugin.settings.showItemMetadata) {
            const visibleChildCount = folder.children.filter(child => !this.plugin.isHiddenByPattern(child.path)).length;
            row.createSpan({ text: `${visibleChildCount}`, cls: "fcn-item-meta" });
        }
        this.enableItemDragging(row, folder);
        this.enableMoveDropTarget(row, folder);
        row.addEventListener("click", () => this.openFolderColumn(folder.path, columnIndex));
        row.addEventListener("contextmenu", event => {
            event.preventDefault();
            this.markKeyboardSelection(row);
            row.focus();
            this.showFolderContextMenu(folder, row, event, columnIndex);
        });
    }

    private addFileListItem(
        list: HTMLElement,
        file: TFile,
        columnIndex: number,
        itemIndex: number,
        isFolderNote: boolean
    ): void {
        const row = list.createDiv("fcn-file-item fcn-file-tree-item");
        this.setRowMetadata(row, columnIndex, itemIndex, "file", file.path);
        row.toggleClass("is-selected", file.path === this.selectedFilePath);
        row.setAttribute("tabindex", "0");
        const iconName = isFolderNote ? this.getFolderNoteIcon() : this.getFileIcon(file);
        this.createItemIcon(row, iconName);
        if (this.plugin.settings.alignFileTreeNames && this.getFolderIcon() && !iconName) {
            row.createSpan("fcn-item-icon fcn-item-icon-placeholder");
        }
        this.createItemContent(row, this.getFileDisplayName(file), this.getFileDetail(file));
        if (this.plugin.settings.showItemMetadata) {
            row.createSpan({ text: file.extension.toUpperCase(), cls: "fcn-item-meta" });
        }
        this.enableItemDragging(row, file);
        row.addEventListener("click", event => {
            this.selectedFilePath = file.path;
            this.activeColumnIndex = columnIndex;
            this.renderColumns();
            void this.openFile(file, event.metaKey);
        });
        row.addEventListener("contextmenu", event => {
            event.preventDefault();
            this.markKeyboardSelection(row);
            row.focus();
            this.showFileContextMenu(file, row, event);
        });
    }

    private createItemContent(parent: HTMLElement, name: string, detail: string | null): void {
        parent.toggleClass("has-item-detail", Boolean(detail));
        const content = parent.createDiv("fcn-item-content");
        content.createSpan({ text: name, cls: "fcn-item-name" });
        if (detail) {
            content.createSpan({ text: detail, cls: "fcn-item-detail" });
        }
    }

    private showFileContextMenu(file: TFile, origin: HTMLElement, event?: MouseEvent): void {
        const menu = this.createContextMenu(file, origin, event);
        menu.addItem(item => item.setSection("open").setTitle("打开").setIcon("file").onClick(() => void this.openFile(file)));
        menu.addItem(item => item.setSection("open").setTitle("在新标签页打开").setIcon("file-plus").onClick(() => void this.openFileInNewTab(file)));
        menu.addSeparator();
        menu.addItem(item => item.setSection("action").setTitle("重命名").setIcon("edit-3").onClick(() => this.promptRename(file)));
        menu.addItem(item => item.setSection("action").setTitle("移动到…").setIcon("folder-input").onClick(() => this.promptMove(file)));
        menu.addSeparator();
        menu.addItem(item => item.setSection("danger").setTitle("删除").setIcon("trash-2").setWarning(true).onClick(() => void this.deleteItem(file)));
        this.addExtensionMenuItems(menu, file);
        this.showContextMenu(menu, origin, event);
    }

    private showFolderContextMenu(folder: TFolder, origin: HTMLElement, event?: MouseEvent, columnIndex?: number): void {
        const menu = this.createContextMenu(folder, origin, event);
        if (columnIndex !== undefined) {
            menu.addItem(item => item.setSection("open").setTitle("打开目录").setIcon("folder-open").onClick(() => this.openFolderColumn(folder.path, columnIndex)));
        }
        menu.addItem(item => item.setSection("action-primary").setTitle("新建笔记").setIcon("file-plus").onClick(() => this.promptCreateNote(folder)));
        menu.addItem(item => item.setSection("action-primary").setTitle("新建子文件夹").setIcon("folder-plus").onClick(() => this.promptCreateFolder(folder)));
        menu.addItem(item => item.setSection("action-primary").setTitle("新建白板").setIcon("layout-dashboard").onClick(() => this.promptCreateCanvas(folder)));
        menu.addItem(item => item.setSection("action-primary").setTitle("新建数据库").setIcon("table-properties").onClick(() => this.promptCreateBase(folder)));
        if (folder.parent) {
            menu.addSeparator();
            menu.addItem(item => item.setSection("action").setTitle("重命名").setIcon("edit-3").onClick(() => this.promptRename(folder)));
            menu.addItem(item => item.setSection("action").setTitle("移动到…").setIcon("folder-input").onClick(() => this.promptMove(folder)));
        }
        this.addExtensionMenuItems(menu, folder);
        this.showContextMenu(menu, origin, event);
    }

    private createContextMenu(_item: TAbstractFile, _origin: HTMLElement, _event?: MouseEvent): Menu {
        this.closeContextMenu(false);
        return new Menu().setUseNativeMenu(false);
    }

    private addExtensionMenuItems(menu: Menu, item: TAbstractFile): void {
        if (this.plugin.settings.showExtensionMenuItems) {
            this.plugin.app.workspace.trigger("file-menu", menu, item, "folder-column-navigator");
        }
    }

    private showContextMenu(menu: Menu, origin: HTMLElement, event?: MouseEvent): void {
        this.contextMenu = menu;
        this.contextMenuOrigin = origin;
        this.contextMenuFilter = "";
        this.contextMenuActiveIndex = 0;
        this.configureContextMenuKeyboard(menu);
        menu.onHide(() => {
            if (this.contextMenu !== menu) {
                return;
            }
            const focusTarget = this.contextMenuOrigin;
            this.clearContextMenuState();
            focusTarget?.focus();
        });
        if (event) {
            menu.showAtMouseEvent(event);
        } else {
            const rect = origin.getBoundingClientRect();
            menu.showAtPosition({ x: rect.left + 8, y: rect.bottom, width: rect.width });
        }
        window.requestAnimationFrame(() => this.initializeContextMenuKeyboard(menu));
    }

    private initializeContextMenuKeyboard(menu: Menu): void {
        if (this.contextMenu !== menu) {
            return;
        }
        const menus = Array.from(document.querySelectorAll<HTMLElement>(".menu"));
        this.contextMenuEl = menus[menus.length - 1] ?? null;
        if (!this.contextMenuEl) {
            return;
        }
        this.contextMenuEl.tabIndex = -1;
        this.contextMenuFilterEl = this.contextMenuEl.createDiv("fcn-context-menu-filter");
        this.contextMenuFilterEl.hide();
        this.selectContextMenuItem(0);
        this.contextMenuEl.focus();
    }

    private closeContextMenu(restoreFocus = true): void {
        const menu = this.contextMenu;
        const origin = this.contextMenuOrigin;
        this.clearContextMenuState();
        menu?.hide();
        if (restoreFocus) {
            origin?.focus();
        }
    }

    private clearContextMenuState(): void {
        this.contextMenu = null;
        this.contextMenuEl = null;
        this.contextMenuOrigin = null;
        this.contextMenuFilter = "";
        this.contextMenuFilterEl = null;
        this.contextMenuActiveIndex = 0;
    }

    private configureContextMenuKeyboard(menu: Menu): void {
        const menuInternals = menu as unknown as {
            scope: {
                keys: Array<{ key: string | null }>;
                register(
                    modifiers: string[] | null,
                    key: string | null,
                    callback: (event: KeyboardEvent) => boolean | void
                ): unknown;
            };
        };
        const scope = menuInternals.scope;
        scope.keys = scope.keys.filter(binding => !["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(binding.key ?? ""));
        scope.register(null, null, event => this.handleContextMenuKeyDown(event) ? false : undefined);
    }

    private handleContextMenuKeyDown(event: KeyboardEvent): boolean {
        if (!this.contextMenu) {
            return false;
        }
        const items = this.getVisibleContextMenuItems();
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            this.selectContextMenuItem(this.contextMenuActiveIndex + (event.key === "ArrowDown" ? 1 : -1));
            return true;
        }
        if (event.key === "Enter") {
            items[this.contextMenuActiveIndex]?.click();
            return true;
        }
        if (event.key === "Escape" || event.key === "Backspace") {
            if (this.contextMenuFilter) {
                this.updateContextMenuFilter("");
            } else {
                this.closeContextMenu();
            }
            return true;
        }
        if (event.key === " " || event.code === "Space") {
            this.closeContextMenu();
            return true;
        }
        if (/^[\p{L}\p{N}]$/u.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
            this.updateContextMenuFilter(`${this.contextMenuFilter}${event.key.toLocaleLowerCase()}`);
            return true;
        }
        return false;
    }

    private getVisibleContextMenuItems(): HTMLElement[] {
        return Array.from(this.contextMenuEl?.querySelectorAll<HTMLElement>(".menu-item") ?? [])
            .filter(item => !item.hasClass("fcn-context-menu-filtered-out"))
            .filter(item => !item.hasClass("is-disabled") && item.getAttribute("aria-disabled") !== "true");
    }

    private selectContextMenuItem(index: number): void {
        const items = this.getVisibleContextMenuItems();
        this.contextMenuEl?.querySelectorAll<HTMLElement>(".fcn-context-menu-active")
            .forEach(item => item.removeClass("fcn-context-menu-active"));
        if (items.length === 0) {
            this.contextMenuActiveIndex = 0;
            return;
        }
        this.contextMenuActiveIndex = (index % items.length + items.length) % items.length;
        const activeItem = items[this.contextMenuActiveIndex];
        activeItem.addClass("fcn-context-menu-active");
        activeItem.scrollIntoView({ block: "nearest" });
    }

    private updateContextMenuFilter(query: string): void {
        this.contextMenuFilter = query;
        const menuEl = this.contextMenuEl;
        if (!menuEl) {
            return;
        }
        menuEl.querySelectorAll<HTMLElement>(".menu-item").forEach(item => {
            const title = item.querySelector<HTMLElement>(".menu-item-title")?.getText() ?? item.getText();
            item.toggleClass("fcn-context-menu-filtered-out", Boolean(query) && !filterNameMatches(title, query));
        });
        menuEl.querySelectorAll<HTMLElement>(".menu-separator").forEach(separator => {
            separator.toggleClass("fcn-context-menu-filtered-out", Boolean(query));
        });
        if (this.contextMenuFilterEl) {
            this.contextMenuFilterEl.setText(`筛选：${query}`);
            this.contextMenuFilterEl.toggle(Boolean(query));
        }
        this.selectContextMenuItem(0);
    }

    private promptRename(item: TAbstractFile): void {
        if (!item.parent) {
            new Notice("仓库根目录不能重命名。", 2500);
            return;
        }
        new TextInputModal(this.plugin.app, "重命名", "输入新名称", item.name, "保存", async name => {
            const nextPath = joinVaultPath(item.parent!, name);
            if (nextPath === item.path) {
                return;
            }
            if (this.plugin.app.vault.getAbstractFileByPath(nextPath)) {
                new Notice("同名文件或目录已存在。", 3000);
                return;
            }
            await this.plugin.app.fileManager.renameFile(item, nextPath);
        }, name => {
            const nextPath = joinVaultPath(item.parent!, name);
            return nextPath !== item.path && this.plugin.app.vault.getAbstractFileByPath(nextPath)
                ? "同名文件或目录已存在。"
                : null;
        }).open();
    }

    private promptMove(item: TAbstractFile): void {
        const excludedPaths = new Set<string>();
        if (item.parent) {
            excludedPaths.add(item.parent.path);
        }
        if (item instanceof TFolder) {
            this.plugin.app.vault.getAllLoadedFiles()
                .filter((candidate): candidate is TFolder => candidate instanceof TFolder)
                .filter(candidate => candidate.path === item.path || candidate.path.startsWith(`${item.path}/`))
                .forEach(candidate => excludedPaths.add(candidate.path));
        }
        new FolderDestinationModal(this.plugin.app, excludedPaths, async targetFolder => {
            await this.moveItemTo(item, targetFolder);
        }).open();
    }

    private canMoveItemTo(item: TAbstractFile, targetFolder: TFolder): boolean {
        if (!item.parent || targetFolder.path === item.parent.path) {
            return false;
        }
        if (item instanceof TFolder && (targetFolder.path === item.path || targetFolder.path.startsWith(`${item.path}/`))) {
            return false;
        }
        return !this.plugin.app.vault.getAbstractFileByPath(joinVaultPath(targetFolder, item.name));
    }

    private async moveItemTo(item: TAbstractFile, targetFolder: TFolder): Promise<void> {
        if (!item.parent || targetFolder.path === item.parent.path) {
            return;
        }
        if (item instanceof TFolder && (targetFolder.path === item.path || targetFolder.path.startsWith(`${item.path}/`))) {
            new Notice("不能将文件夹移动到自身或其子目录。", 3000);
            return;
        }
        const nextPath = joinVaultPath(targetFolder, item.name);
        if (this.plugin.app.vault.getAbstractFileByPath(nextPath)) {
            new Notice("目标目录已有同名文件或目录。", 3000);
            return;
        }
        const itemKind = item instanceof TFolder ? "folder" : "file";
        await this.plugin.app.fileManager.renameFile(item, nextPath);
        this.revealMovedItem(targetFolder, nextPath, itemKind);
    }

    private async deleteItem(item: TAbstractFile): Promise<void> {
        if (await this.plugin.app.fileManager.promptForDeletion(item)) {
            const fileManager = this.plugin.app.fileManager as typeof this.plugin.app.fileManager & {
                trashFile?: (file: TAbstractFile) => Promise<void>;
            };
            if (typeof fileManager.trashFile === "function") {
                await fileManager.trashFile(item);
            } else {
                await this.plugin.app.vault.trash(item, false);
            }
        }
    }

    private promptCreateNote(folder: TFolder): void {
        this.promptCreateFile(folder, "新建笔记", "未命名笔记.md", "创建", name => name.endsWith(".md") ? name : `${name}.md`, "");
    }

    private promptCreateFolder(folder: TFolder): void {
        new TextInputModal(this.plugin.app, "新建子文件夹", "输入文件夹名称", "未命名文件夹", "创建", async name => {
            const path = joinVaultPath(folder, name);
            if (this.plugin.app.vault.getAbstractFileByPath(path)) {
                new Notice("同名文件或目录已存在。", 3000);
                return;
            }
            const vault = this.plugin.app.vault as typeof this.plugin.app.vault & {
                createFolder?: (folderPath: string) => Promise<TFolder>;
            };
            if (typeof vault.createFolder !== "function") {
                new Notice("当前 Obsidian 版本不支持创建文件夹，请升级到 1.4.0 或更高版本。", 4000);
                return;
            }
            await vault.createFolder(path);
        }, name => this.getDuplicateNameError(folder, name)).open();
    }

    private promptCreateCanvas(folder: TFolder): void {
        this.promptCreateFile(folder, "新建白板", "未命名白板.canvas", "创建", name => name.endsWith(".canvas") ? name : `${name}.canvas`, "{\n\t\"nodes\": [],\n\t\"edges\": []\n}");
    }

    private promptCreateBase(folder: TFolder): void {
        this.promptCreateFile(folder, "新建数据库", "未命名数据库.base", "创建", name => name.endsWith(".base") ? name : `${name}.base`, "views:\n  - type: table\n    name: 表格\n");
    }

    private promptCreateFile(
        folder: TFolder,
        title: string,
        initialName: string,
        submitLabel: string,
        normalizeName: (name: string) => string,
        content: string
    ): void {
        new TextInputModal(this.plugin.app, title, "输入名称", initialName, submitLabel, async name => {
            const path = joinVaultPath(folder, normalizeName(name));
            if (this.plugin.app.vault.getAbstractFileByPath(path)) {
                new Notice("同名文件或目录已存在。", 3000);
                return;
            }
            const file = await this.plugin.app.vault.create(path, content);
            await this.openFile(file);
        }, name => this.getDuplicateNameError(folder, normalizeName(name))).open();
    }

    private getDuplicateNameError(folder: TFolder, name: string): string | null {
        return this.plugin.app.vault.getAbstractFileByPath(joinVaultPath(folder, name))
            ? "同名文件或目录已存在。"
            : null;
    }

    private async openFileInNewTab(file: TFile): Promise<void> {
        await this.openFile(file, true);
    }

    private setRowMetadata(row: HTMLElement, columnIndex: number, itemIndex: number, kind: string, path: string): void {
        row.dataset.fcnRow = "column";
        row.dataset.fcnColumn = String(columnIndex);
        row.dataset.fcnIndex = String(itemIndex);
        row.dataset.fcnKind = kind;
        row.dataset.fcnPath = path;
    }

    private getFileDisplayName(file: TFile): string {
        return this.plugin.settings.hideFileExtensions ? file.basename : file.name;
    }

    private getFolderNote(folder: TFolder): TFile | null {
        if (!this.plugin.settings.showFolderNotes) {
            return null;
        }
        const directFiles = folder.children.filter((child): child is TFile => child instanceof TFile);
        if (this.plugin.settings.folderNoteMatchFolderName) {
            const sameNameNote = directFiles.find(file => file.basename === folder.name);
            if (sameNameNote) {
                return sameNameNote;
            }
        }
        if (!this.plugin.settings.folderNoteMatchSpecialName) {
            return null;
        }
        const specialNames = new Set(this.plugin.settings.folderNoteSpecialNames.map(name => name.toLocaleLowerCase()));
        return directFiles.find(file => specialNames.has(file.basename.toLocaleLowerCase())) ?? null;
    }

    private isFolderNote(file: TAbstractFile, parent: TFolder): boolean {
        return file instanceof TFile && this.getFolderNote(parent)?.path === file.path;
    }

    private getFrontmatterDetail(file: TFile, keys: string[]): string | null {
        if (keys.length === 0) {
            return null;
        }
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        const details = keys.map(key => {
            const value = this.formatMetadataValue(frontmatter?.[key]);
            return value ? (this.plugin.settings.showMetadataNames ? `${key}: ${value}` : value) : null;
        }).filter((detail): detail is string => Boolean(detail));
        return details.length > 0 ? details.join(" · ") : null;
    }

    private formatMetadataValue(value: unknown): string | null {
        if (typeof value === "string") {
            return value.trim() || null;
        }
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return formatCalendarDate(value);
        }
        if (Array.isArray(value)) {
            const values = value.map(entry => this.formatMetadataValue(entry)).filter((entry): entry is string => Boolean(entry));
            return values.length > 0 ? values.join(" · ") : null;
        }
        return null;
    }

    private getFileDetail(file: TFile): string | null {
        const details = [this.getFrontmatterDetail(file, this.plugin.settings.fileMetadataKeys)];
        if (this.plugin.settings.fileDateDisplay === "created") {
            details.push(`创建于 ${formatCalendarDate(new Date(file.stat.ctime))}`);
        } else if (this.plugin.settings.fileDateDisplay === "modified") {
            details.push(`修改于 ${formatCalendarDate(new Date(file.stat.mtime))}`);
        }
        const visibleDetails = details.filter((detail): detail is string => Boolean(detail));
        return visibleDetails.length > 0 ? visibleDetails.join(" · ") : null;
    }

    private compareItems(a: TAbstractFile, b: TAbstractFile, parent: TFolder): number {
        const folderNoteDifference = Number(this.isFolderNote(b, parent)) - Number(this.isFolderNote(a, parent));
        if (folderNoteDifference !== 0) {
            return folderNoteDifference;
        }
        const folderDifference = Number(b instanceof TFolder) - Number(a instanceof TFolder);
        if (folderDifference !== 0) {
            return folderDifference;
        }

        if (this.plugin.settings.sortField === "name") {
            const nameDifference = compareNames(a, b);
            return this.plugin.settings.sortDirection === "asc" ? nameDifference : -nameDifference;
        }

        const timestampDifference = getTimestamp(a, this.plugin.settings.sortField) - getTimestamp(b, this.plugin.settings.sortField);
        if (timestampDifference !== 0) {
            return this.plugin.settings.sortDirection === "asc" ? timestampDifference : -timestampDifference;
        }
        return compareNames(a, b);
    }

    private selectNavigationPath(path: string): void {
        if (!this.plugin.getFolder(path)) {
            return;
        }
        this.rememberNavigationPosition();
        const position = this.navigationPositions.get(path);
        if (position) {
            this.restoreNavigationPosition(path, position);
            return;
        }
        this.setColumnState(path, [path]);
        this.selectedFilePath = null;
        this.childColumnSelections.clear();
        this.activeColumnIndex = 0;
        this.refresh();
        this.focusFirstColumnItem(0);
    }

    private rememberNavigationPosition(): void {
        const existing = this.navigationPositions.get(this.navigationBasePath);
        const focusedRow = this.lastFocusedRow?.area === "column" ? this.lastFocusedRow : null;
        this.navigationPositions.set(this.navigationBasePath, {
            columnPaths: [...this.columnPaths],
            activeColumnIndex: this.activeColumnIndex,
            selectedFilePath: this.selectedFilePath,
            focusedPath: focusedRow?.path ?? existing?.focusedPath ?? "",
            focusedKind: focusedRow?.kind ?? existing?.focusedKind,
            focusedColumnIndex: focusedRow?.columnIndex ?? existing?.focusedColumnIndex ?? this.activeColumnIndex
        });
    }

    private restoreNavigationPosition(path: string, position: NavigationPosition): void {
        this.setColumnState(path, position.columnPaths);
        this.selectedFilePath = position.selectedFilePath;
        this.activeColumnIndex = Math.max(0, Math.min(position.activeColumnIndex, this.columnPaths.length - 1));
        this.refresh();
        window.requestAnimationFrame(() => this.focusNavigationPosition(position));
    }

    private focusNavigationPosition(position: NavigationPosition): void {
        const columnIndex = Math.max(0, Math.min(position.focusedColumnIndex, this.columnPaths.length - 1));
        const column = this.columnsEl.querySelector<HTMLElement>(`.fcn-column[data-fcn-column="${columnIndex}"]`);
        const row = position.focusedPath
            ? Array.from(column?.querySelectorAll<HTMLElement>('[data-fcn-row="column"]') ?? [])
                .find(item => item.dataset.fcnPath === position.focusedPath && item.dataset.fcnKind === position.focusedKind)
            : null;
        if (row) {
            this.activeColumnIndex = columnIndex;
            this.ensureColumnVisible(columnIndex);
            row.focus();
            this.ensureRowVisibleVertically(row);
            return;
        }
        this.focusFirstColumnItem(this.activeColumnIndex);
    }

    private previewNavigationPath(path: string): void {
        if (!this.plugin.getFolder(path)) {
            return;
        }
        this.setColumnState(path, [path]);
        this.selectedFilePath = null;
        this.childColumnSelections.clear();
        this.activeColumnIndex = 0;
        this.refresh();
        this.focusNavigationPath();
    }

    private openFolderColumn(path: string, columnIndex: number, focusNextColumn = true): void {
        if (!this.plugin.getFolder(path)) {
            return;
        }
        this.columnPaths = [...this.columnPaths.slice(0, columnIndex + 1), path];
        this.selectedFilePath = null;
        this.activeColumnIndex = focusNextColumn ? columnIndex + 1 : columnIndex;
        this.refresh();
        if (focusNextColumn) {
            const remembered = this.childColumnSelections.get(this.columnPaths[columnIndex]);
            if (remembered?.childPath === path) {
                this.focusRememberedChildItem(columnIndex + 1, remembered);
            } else {
                this.focusFirstColumnItem(columnIndex + 1);
            }
        } else {
            this.focusFolderPath(path, columnIndex);
        }
    }

    private async openFile(file: TFile, openInNewTab = false): Promise<void> {
        const workspace = this.plugin.app.workspace;
        const existingLeaf = workspace.getLeavesOfType("markdown")
            .find(leaf => leaf.view instanceof FileView && leaf.view.file?.path === file.path);
        if (existingLeaf) {
            workspace.setActiveLeaf(existingLeaf, { focus: false });
            window.setTimeout(() => this.focusFilePath(file.path), 0);
            return;
        }

        const targetLeaf = workspace.getLeaf(openInNewTab ? "tab" : false);
        await targetLeaf.openFile(file, { active: true });
        window.setTimeout(() => this.focusFilePath(file.path), 0);
    }

    revealActiveFile(): void {
        const file = this.plugin.app.workspace.getActiveFile();
        if (!file) {
            new Notice("当前没有打开的笔记。", 3000);
            return;
        }

        const matchingEntries = this.plugin.getNavigationEntries()
            .filter(entry => entry.path === ROOT_PATH || file.path.startsWith(`${entry.path}/`))
            .sort((a, b) => b.path.length - a.path.length);
        const basePath = matchingEntries[0]?.path ?? ROOT_PATH;
        const parentPath = file.parent?.path ?? ROOT_PATH;
        const columnPaths = this.buildFolderChain(basePath, parentPath);
        this.navigationBasePath = basePath;
        this.columnPaths = columnPaths;
        this.activeColumnIndex = columnPaths.length - 1;
        this.selectedFilePath = file.path;
        this.filterState = null;
        this.refresh();
        window.requestAnimationFrame(() => this.focusFilePath(file.path));
    }

    private revealMovedItem(targetFolder: TFolder, movedPath: string, itemKind: "file" | "folder"): void {
        const matchingEntries = this.plugin.getNavigationEntries()
            .filter(entry => entry.path === ROOT_PATH || targetFolder.path.startsWith(`${entry.path}/`) || entry.path === targetFolder.path)
            .sort((a, b) => b.path.length - a.path.length);
        const basePath = matchingEntries[0]?.path ?? ROOT_PATH;
        const columnPaths = this.buildFolderChain(basePath, targetFolder.path);
        this.navigationBasePath = basePath;
        this.columnPaths = columnPaths;
        this.activeColumnIndex = columnPaths.length - 1;
        this.selectedFilePath = itemKind === "file" ? movedPath : null;
        this.filterState = null;
        this.childColumnSelections.clear();
        this.refresh();
        window.requestAnimationFrame(() => {
            if (columnPaths.length === 1) {
                this.focusNavigationPath();
                return;
            }
            this.focusFolderPath(targetFolder.path, columnPaths.length - 2);
        });
    }

    private buildFolderChain(basePath: string, targetPath: string): string[] {
        if (basePath === targetPath) {
            return [basePath];
        }

        const descendants: string[] = [];
        let currentPath = targetPath;
        while (currentPath !== basePath && currentPath !== ROOT_PATH) {
            descendants.push(currentPath);
            const folder = this.plugin.getFolder(currentPath);
            currentPath = folder?.parent?.path ?? ROOT_PATH;
        }
        if (currentPath !== basePath) {
            return [basePath];
        }
        return [basePath, ...descendants.reverse()];
    }

    private focusFilePath(path: string): void {
        const row = Array.from(this.columnsEl.querySelectorAll<HTMLElement>('[data-fcn-row="column"]'))
            .find(item => item.dataset.fcnKind === "file" && item.dataset.fcnPath === path);
        if (!row) {
            return;
        }
        const columnIndex = Number(row.dataset.fcnColumn ?? this.activeColumnIndex);
        this.activeColumnIndex = columnIndex;
        this.ensureColumnVisible(columnIndex);
        row.focus();
        this.ensureRowVisibleVertically(row);
    }

    private setColumnState(basePath: string, paths: string[]): void {
        const normalizedBase = this.plugin.getFolder(basePath) ? basePath : ROOT_PATH;
        const nextPaths: string[] = [normalizedBase];
        paths.forEach(path => {
            if (path === normalizedBase || !this.plugin.getFolder(path) || nextPaths.includes(path)) {
                return;
            }
            const parent = this.plugin.getFolder(path)?.parent;
            const previous = nextPaths[nextPaths.length - 1];
            if (parent?.path === previous) {
                nextPaths.push(path);
            }
        });
        this.navigationBasePath = normalizedBase;
        this.columnPaths = nextPaths;
        this.activeColumnIndex = Math.max(0, nextPaths.length - 1);
    }

    private repairColumnState(): void {
        const previousActiveColumnIndex = this.activeColumnIndex;
        const base = this.plugin.getFolder(this.navigationBasePath) ? this.navigationBasePath : ROOT_PATH;
        this.setColumnState(base, this.columnPaths);
        this.activeColumnIndex = Math.max(0, Math.min(previousActiveColumnIndex, this.columnPaths.length - 1));
    }

    private applyNavigationWidth(width: number): void {
        this.resizeWidth = clampNavigationWidth(width);
        this.shellEl.setCssStyles({ gridTemplateColumns: `${this.resizeWidth}px 5px minmax(0, 1fr)` });
    }

    private startResize(event: PointerEvent): void {
        event.preventDefault();
        this.isResizing = true;
        this.resizePointerId = event.pointerId;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.containerEl.addClass("fcn-is-resizing");
        document.addEventListener("pointermove", this.handleResizeMove);
        document.addEventListener("pointerup", this.handleResizeEnd, { once: true });
        document.addEventListener("pointercancel", this.handleResizeEnd, { once: true });
    }

    private readonly handleResizeMove = (event: PointerEvent): void => {
        if (!this.isResizing || this.resizePointerId !== event.pointerId) {
            return;
        }
        const rect = this.shellEl.getBoundingClientRect();
        this.applyNavigationWidth(event.clientX - rect.left);
    };

    private readonly handleResizeEnd = (): void => {
        if (!this.isResizing) {
            return;
        }
        const width = this.resizeWidth;
        this.stopResize();
        void this.plugin.updateNavigationWidth(width);
    };

    private stopResize(): void {
        this.isResizing = false;
        this.resizePointerId = null;
        this.containerEl.removeClass("fcn-is-resizing");
        document.removeEventListener("pointermove", this.handleResizeMove);
        document.removeEventListener("pointerup", this.handleResizeEnd);
        document.removeEventListener("pointercancel", this.handleResizeEnd);
    }

    private getColumnWidth(path: string): number {
        return clampColumnWidth(
            this.columnWidths.get(path)
                ?? this.plugin.settings.columnWidths[path]
                ?? this.columnPreferredWidths.get(path)
                ?? this.plugin.settings.columnMinWidth,
            this.plugin.settings.columnMinWidth,
            this.plugin.settings.columnMaxWidth
        );
    }

    private updateColumnPreferredWidth(column: HTMLElement, path: string): void {
        const preferredWidth = Math.ceil(this.measureColumnContentWidth(column));
        this.columnPreferredWidths.set(path, preferredWidth);
        const width = this.getColumnWidth(path);
        if (this.columnWidths.has(path)) {
            this.columnWidths.set(path, width);
        }
        column.setCssProps({
            "--fcn-column-min-width": `${this.plugin.settings.columnMinWidth}px`,
            "--fcn-column-max-width": `${this.plugin.settings.columnMaxWidth}px`,
            "--fcn-column-width": `${width}px`
        });
    }

    private measureColumnContentWidth(column: HTMLElement): number {
        const items = Array.from(column.querySelectorAll<HTMLElement>(".fcn-file-item"));
        const header = column.querySelector<HTMLElement>(".fcn-column-header");
        const emptyState = column.querySelector<HTMLElement>(".fcn-empty-state");
        return Math.max(
            1,
            ...items.map(item => this.measureRowContentWidth(item)),
            header ? this.measureRowContentWidth(header) : 0,
            emptyState ? this.measureRowContentWidth(emptyState) : 0
        );
    }

    private measureRowContentWidth(row: HTMLElement): number {
        const style = window.getComputedStyle(row);
        const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        const gap = parseFloat(style.columnGap || style.gap) || 0;
        const children = Array.from(row.children).filter((child): child is HTMLElement => child.instanceOf(HTMLElement));
        const contentWidth = children.reduce((total, child) => total + Math.ceil(child.scrollWidth), 0);
        return horizontalPadding + contentWidth + Math.max(0, children.length - 1) * gap;
    }

    private startColumnResize(event: PointerEvent, path: string): void {
        event.preventDefault();
        event.stopPropagation();
        const divider = event.currentTarget as HTMLElement;
        this.columnResize = {
            path,
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: this.getColumnWidth(path)
        };
        divider.setPointerCapture(event.pointerId);
        this.containerEl.addClass("fcn-is-resizing");
        document.addEventListener("pointermove", this.handleColumnResizeMove);
        document.addEventListener("pointerup", this.handleColumnResizeEnd, { once: true });
        document.addEventListener("pointercancel", this.handleColumnResizeEnd, { once: true });
    }

    private readonly handleColumnResizeMove = (event: PointerEvent): void => {
        const resize = this.columnResize;
        if (!resize || resize.pointerId !== event.pointerId) {
            return;
        }
        const width = clampColumnWidth(
            resize.startWidth + event.clientX - resize.startX,
            this.plugin.settings.columnMinWidth,
            this.plugin.settings.columnMaxWidth
        );
        this.columnWidths.set(resize.path, width);
        const column = Array.from(this.columnsEl.querySelectorAll<HTMLElement>(".fcn-column"))
            .find(item => item.dataset.fcnPath === resize.path);
        column?.setCssProps({ "--fcn-column-width": `${width}px` });
    };

    private readonly handleColumnResizeEnd = (): void => {
        const resize = this.columnResize;
        const width = resize ? this.columnWidths.get(resize.path) : undefined;
        this.stopColumnResize();
        if (resize && width !== undefined) {
            void this.plugin.updateColumnWidth(resize.path, width);
        }
    };

    private stopColumnResize(): void {
        this.columnResize = null;
        this.containerEl.removeClass("fcn-is-resizing");
        document.removeEventListener("pointermove", this.handleColumnResizeMove);
        document.removeEventListener("pointerup", this.handleColumnResizeEnd);
        document.removeEventListener("pointercancel", this.handleColumnResizeEnd);
    }

    private handleKeyDown(event: KeyboardEvent): void {
        const target = event.targetNode?.instanceOf(HTMLElement) ? event.targetNode : null;
        if (!target) {
            return;
        }

        if (event.key === "Escape" && this.filterState) {
            event.preventDefault();
            this.clearFilter();
            return;
        }
        if (target.instanceOf(HTMLButtonElement) || target.instanceOf(HTMLSelectElement) || target.instanceOf(HTMLInputElement)) {
            return;
        }

        const navigationRow = target.closest<HTMLElement>('[data-fcn-row="navigation"]');
        const columnRow = target.closest<HTMLElement>('[data-fcn-row="column"]');
        const row = navigationRow ?? columnRow ?? this.restoreLastFocusedRow();
        const filterScope = navigationRow || columnRow
            ? this.resolveFilterScope(row)
            : this.filterState?.scope ?? this.resolveFilterScope(row);
        if (filterScope && /^[a-z0-9]$/i.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            this.appendFilter(filterScope, event.key);
            return;
        }
        if (filterScope && (event.key === "Backspace" || event.key === "Escape") && this.isFilterForScope(filterScope)) {
            event.preventDefault();
            this.updateFilter(filterScope, event.key === "Escape" ? "" : (this.filterState?.query.slice(0, -1) ?? ""));
            return;
        }

        const isDirectionalKey = event.key === "ArrowUp" || event.key === "ArrowDown" ||
            event.key === "ArrowLeft" || event.key === "ArrowRight";
        if (isDirectionalKey) {
            event.preventDefault();
        }
        if (!row) {
            return;
        }
        if (!navigationRow && !columnRow) {
            row.focus();
        }
        if (event.shiftKey && event.key === "ArrowUp" && columnRow && this.plugin.settings.showRootFoldersAtTop) {
            event.preventDefault();
            this.focusNavigationPath();
            return;
        }
        if (event.key === " " || event.code === "Space") {
            event.preventDefault();
            this.showContextMenuForRow(row);
            return;
        }
        if (isDirectionalKey || event.key === "Enter") {
            event.preventDefault();
            this.handleRowKey(row, event.key);
        }
    }

    private showContextMenuForRow(row: HTMLElement): void {
        const path = row.dataset.fcnPath ?? "";
        const kind = row.dataset.fcnKind;
        if (kind === "file") {
            const file = this.plugin.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                this.showFileContextMenu(file, row);
            }
            return;
        }
        if (kind === "folder" || row.dataset.fcnRow === "navigation") {
            const folder = this.plugin.getFolder(path);
            if (folder) {
                const columnIndex = row.dataset.fcnRow === "column"
                    ? Number(row.dataset.fcnColumn ?? this.activeColumnIndex)
                    : undefined;
                this.showFolderContextMenu(folder, row, undefined, columnIndex);
            }
        }
    }

    private resolveFilterScope(row: HTMLElement | null): FilterScope | null {
        if (row?.dataset.fcnRow === "navigation") {
            return { area: "navigation" };
        }
        if (row?.dataset.fcnRow === "column") {
            return { area: "column", columnIndex: Number(row.dataset.fcnColumn ?? this.activeColumnIndex) };
        }
        return this.filterState?.scope ?? null;
    }

    private appendFilter(scope: FilterScope, character: string): void {
        const previousQuery = this.isFilterForScope(scope) ? this.filterState?.query ?? "" : "";
        this.updateFilter(scope, `${previousQuery}${character.toLocaleLowerCase()}`);
    }

    private updateFilter(scope: FilterScope, query: string): void {
        this.filterState = query ? { scope, query } : null;
        if (scope.area === "navigation") {
            this.renderNavigation();
            this.renderHeader();
            this.focusFirstVisibleNavigationItem();
            return;
        }
        this.activeColumnIndex = scope.columnIndex;
        this.renderColumns();
        window.requestAnimationFrame(() => this.focusFirstFilteredColumnItem(scope.columnIndex));
    }

    private clearFilter(): void {
        const filter = this.filterState;
        if (filter) {
            this.updateFilter(filter.scope, "");
        }
    }

    private isFilterForScope(scope: FilterScope): boolean {
        if (!this.filterState || this.filterState.scope.area !== scope.area) {
            return false;
        }
        if (scope.area === "navigation") {
            return true;
        }
        return this.filterState.scope.area === "column" && this.filterState.scope.columnIndex === scope.columnIndex;
    }

    private isNavigationFiltering(): boolean {
        return this.filterState?.scope.area === "navigation" && this.filterState.query.length > 0;
    }

    private getColumnFilterQuery(columnIndex: number): string {
        return this.filterState?.scope.area === "column" && this.filterState.scope.columnIndex === columnIndex
            ? this.filterState.query
            : "";
    }

    private focusFirstVisibleNavigationItem(): void {
        const row = Array.from(this.containerEl.querySelectorAll<HTMLElement>('[data-fcn-row="navigation"]'))
            .find(item => !item.hasClass("is-filtered-out"));
        if (row) {
            row.focus();
        } else {
            this.containerEl.focus();
        }
    }

    private focusFirstFilteredColumnItem(columnIndex: number): void {
        const column = this.columnsEl.querySelector<HTMLElement>(`.fcn-column[data-fcn-column="${columnIndex}"]`);
        const row = Array.from(column?.querySelectorAll<HTMLElement>('[data-fcn-row="column"]') ?? [])
            .find(item => item.dataset.fcnKind !== "special");
        if (row) {
            this.activeColumnIndex = columnIndex;
            this.ensureColumnVisible(columnIndex);
            row.focus();
            this.ensureRowVisibleVertically(row);
        } else {
            this.containerEl.focus();
        }
    }

    private handleFocusIn(event: FocusEvent): void {
        const target = event.targetNode?.instanceOf(HTMLElement) ? event.targetNode : null;
        const navigationRow = target?.closest<HTMLElement>('[data-fcn-row="navigation"]');
        if (navigationRow) {
            this.markKeyboardSelection(navigationRow);
            this.lastFocusedRow = { area: "navigation", path: navigationRow.dataset.fcnPath ?? ROOT_PATH };
            return;
        }
        const columnRow = target?.closest<HTMLElement>('[data-fcn-row="column"]');
        if (columnRow) {
            this.activeColumnIndex = Number(columnRow.dataset.fcnColumn ?? 0);
            this.markKeyboardSelection(columnRow);
            this.lastFocusedRow = {
                area: "column",
                path: columnRow.dataset.fcnPath ?? "",
                columnIndex: this.activeColumnIndex,
                kind: columnRow.dataset.fcnKind
            };
            this.renderHeader();
        }
    }

    private handlePointerDown(event: PointerEvent): void {
        const target = event.targetNode?.instanceOf(HTMLElement) ? event.targetNode : null;
        if (!target) {
            return;
        }
        if (target.closest('[data-fcn-row], button, select, input, textarea, .fcn-resize-divider')) {
            return;
        }
        this.focusCurrentSelection();
    }

    private handleBlankClick(event: MouseEvent): void {
        const target = event.targetNode?.instanceOf(HTMLElement) ? event.targetNode : null;
        if (!target || target.closest('[data-fcn-row], button, select, input, textarea, .fcn-resize-divider')) {
            return;
        }
        this.focusCurrentSelection();
    }

    private markKeyboardSelection(row: HTMLElement): void {
        this.containerEl.querySelectorAll<HTMLElement>(".is-keyboard-selected, .is-root-folder-keyboard-selected").forEach(item => {
            item.removeClass("is-keyboard-selected");
            item.removeClass("is-root-folder-keyboard-selected");
        });
        if (row.hasClass("fcn-root-folder-item")) {
            row.addClass("is-root-folder-keyboard-selected");
            return;
        }
        row.addClass("is-keyboard-selected");
    }

    private focusCurrentSelection(): void {
        const row = this.restoreLastFocusedRow();
        if (!row) {
            return;
        }
        this.markKeyboardSelection(row);
        row.focus();
        if (row.dataset.fcnRow === "column") {
            const columnIndex = Number(row.dataset.fcnColumn ?? this.activeColumnIndex);
            this.activeColumnIndex = columnIndex;
            this.ensureColumnVisible(columnIndex);
            this.ensureRowVisibleVertically(row);
        }
    }

    private restoreLastFocusedRow(): HTMLElement | null {
        const rows = Array.from(this.containerEl.querySelectorAll<HTMLElement>('[data-fcn-row]'));
        if (!this.lastFocusedRow) {
            return this.getDefaultFocusRow();
        }
        const lastFocusedRow = this.lastFocusedRow;
        const row = rows.find(row => {
            if (lastFocusedRow.area === "navigation") {
                return row.dataset.fcnRow === "navigation" && row.dataset.fcnPath === lastFocusedRow.path;
            }
            return row.dataset.fcnRow === "column" &&
                row.dataset.fcnPath === lastFocusedRow.path &&
                Number(row.dataset.fcnColumn ?? 0) === lastFocusedRow.columnIndex &&
                row.dataset.fcnKind === lastFocusedRow.kind;
        });
        return row ?? this.getDefaultFocusRow();
    }

    private getDefaultFocusRow(): HTMLElement | null {
        const activeColumn = this.columnsEl.querySelector<HTMLElement>(
            `.fcn-column[data-fcn-column="${this.activeColumnIndex}"]`
        );
        return Array.from(activeColumn?.querySelectorAll<HTMLElement>('[data-fcn-row="column"]') ?? [])
            .find(row => row.classList.contains("is-selected")) ??
            Array.from(activeColumn?.querySelectorAll<HTMLElement>('[data-fcn-row="column"]') ?? [])
                .find(row => row.dataset.fcnKind !== "special") ??
            Array.from(this.containerEl.querySelectorAll<HTMLElement>('[data-fcn-row="navigation"]'))
                .find(row => row.classList.contains("is-selected")) ??
            Array.from(this.containerEl.querySelectorAll<HTMLElement>('[data-fcn-row="navigation"]'))
                .find(row => row.dataset.fcnPath === this.navigationBasePath) ?? null;
    }

    private handleRowKey(row: HTMLElement, key: string): void {
        if (row.dataset.fcnRow === "navigation") {
            if (this.plugin.settings.showRootFoldersAtTop) {
                if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
                    this.moveTopNavigationFocus(row, key);
                } else if (key === "Enter") {
                    this.selectNavigationPath(row.dataset.fcnPath ?? ROOT_PATH);
                }
                return;
            }

            if (key === "ArrowUp" || key === "ArrowDown") {
                this.moveNavigationFocus(row, key === "ArrowDown" ? 1 : -1);
            } else if (key === "ArrowRight") {
                this.selectNavigationPath(row.dataset.fcnPath ?? ROOT_PATH);
            } else if (key === "Enter") {
                this.selectNavigationPath(row.dataset.fcnPath ?? ROOT_PATH);
            }
            return;
        }

        const columnIndex = Number(row.dataset.fcnColumn ?? 0);
        const kind = row.dataset.fcnKind;
        const path = row.dataset.fcnPath ?? "";
        if (key === "ArrowUp" || key === "ArrowDown") {
            this.moveColumnFocus(columnIndex, row, key === "ArrowDown" ? 1 : -1);
        } else if (key === "ArrowLeft") {
            this.focusPreviousColumnOrNavigation(columnIndex);
        } else if (key === "ArrowRight" && kind === "folder") {
            this.openFolderColumn(path, columnIndex);
        } else if (key === "Enter") {
            if (kind === "folder") {
                this.openFolderColumn(path, columnIndex);
            } else if (kind === "file") {
                const file = this.plugin.app.vault.getAbstractFileByPath(path);
                if (file instanceof TFile) {
                    void this.openFile(file);
                }
            } else if (kind === "special" && columnIndex > 0) {
                this.columnPaths = this.columnPaths.slice(0, columnIndex);
                this.activeColumnIndex = columnIndex - 1;
                this.refresh();
                this.focusFirstColumnItem(columnIndex - 1);
            }
        }
    }

    private getVisibleNavigationRows(includeCollapsedRows = false): HTMLElement[] {
        return Array.from(this.containerEl.querySelectorAll<HTMLElement>('[data-fcn-row="navigation"]'))
            .filter(row => !row.hasClass("is-filtered-out"))
            .filter(row => {
                if (includeCollapsedRows || row.parentElement !== this.rootFolderGrid || this.rootFoldersExpanded || !this.rootFolderGrid) {
                    return true;
                }
                const rowRect = row.getBoundingClientRect();
                const gridRect = this.rootFolderGrid.getBoundingClientRect();
                return rowRect.top >= gridRect.top && rowRect.bottom <= gridRect.bottom;
            });
    }

    private moveNavigationFocus(currentRow: HTMLElement, offset: number): void {
        const rows = this.getVisibleNavigationRows();
        const current = rows.indexOf(currentRow);
        const nextIndex = Math.max(0, Math.min(rows.length - 1, current + offset));
        const nextRow = rows[nextIndex];
        if (!nextRow) {
            return;
        }
        this.previewNavigationPath(nextRow.dataset.fcnPath ?? ROOT_PATH);
    }

    private moveTopNavigationFocus(currentRow: HTMLElement, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): void {
        const currentRect = currentRow.getBoundingClientRect();
        const currentCenterX = currentRect.left + currentRect.width / 2;
        const currentCenterY = currentRect.top + currentRect.height / 2;
        const findCandidate = (rows: HTMLElement[]): HTMLElement | undefined => rows
            .filter(row => row !== currentRow)
            .map(row => {
                const rect = row.getBoundingClientRect();
                return {
                    row,
                    centerX: rect.left + rect.width / 2,
                    centerY: rect.top + rect.height / 2,
                    height: rect.height
                };
            })
            .filter(candidate => {
                if (key === "ArrowLeft") {
                    return candidate.centerX < currentCenterX && Math.abs(candidate.centerY - currentCenterY) < Math.max(candidate.height, currentRect.height);
                }
                if (key === "ArrowRight") {
                    return candidate.centerX > currentCenterX && Math.abs(candidate.centerY - currentCenterY) < Math.max(candidate.height, currentRect.height);
                }
                return key === "ArrowUp"
                    ? candidate.centerY < currentCenterY
                    : candidate.centerY > currentCenterY;
            })
            .sort((a, b) => {
                const aPrimary = key === "ArrowLeft" || key === "ArrowRight"
                    ? Math.abs(a.centerX - currentCenterX)
                    : Math.abs(a.centerY - currentCenterY);
                const bPrimary = key === "ArrowLeft" || key === "ArrowRight"
                    ? Math.abs(b.centerX - currentCenterX)
                    : Math.abs(b.centerY - currentCenterY);
                const aCross = key === "ArrowLeft" || key === "ArrowRight"
                    ? Math.abs(a.centerY - currentCenterY)
                    : Math.abs(a.centerX - currentCenterX);
                const bCross = key === "ArrowLeft" || key === "ArrowRight"
                    ? Math.abs(b.centerY - currentCenterY)
                    : Math.abs(b.centerX - currentCenterX);
                return aPrimary - bPrimary || aCross - bCross;
            })[0]?.row;

        let nextRow = findCandidate(this.getVisibleNavigationRows());
        if (!nextRow && this.canExpandTopFoldersFrom(currentRow, key)) {
            this.rootFoldersExpanded = true;
            this.updateRootFolderOverflow();
            nextRow = findCandidate(this.getVisibleNavigationRows());
        }
        if (!nextRow && key === "ArrowDown") {
            this.focusFirstColumnItem(0);
            return;
        }
        if (!nextRow) {
            return;
        }
        nextRow.focus();
    }

    private canExpandTopFoldersFrom(currentRow: HTMLElement, key: string): boolean {
        if (key !== "ArrowDown" || this.rootFoldersExpanded || !this.rootFolderGrid ||
            currentRow.parentElement !== this.rootFolderGrid || this.rootFolderExpandButton?.hasClass("is-hidden")) {
            return false;
        }
        const visibleFolderRows = this.getVisibleNavigationRows()
            .filter(row => row.parentElement === this.rootFolderGrid);
        const bottom = Math.max(...visibleFolderRows.map(row => row.getBoundingClientRect().bottom));
        return Math.abs(currentRow.getBoundingClientRect().bottom - bottom) < 1;
    }

    private moveColumnFocus(columnIndex: number, currentRow: HTMLElement, offset: number): void {
        const column = this.columnsEl.querySelector<HTMLElement>(`.fcn-column[data-fcn-column="${columnIndex}"]`);
        if (!column) {
            return;
        }
        const rows = Array.from(column.querySelectorAll<HTMLElement>('[data-fcn-row="column"]'));
        const current = rows.indexOf(currentRow);
        if (this.plugin.settings.showRootFoldersAtTop && columnIndex === 0 && offset < 0 && current === 0) {
            this.focusNavigationPath();
            return;
        }
        const nextIndex = Math.max(0, Math.min(rows.length - 1, current + offset));
        this.activeColumnIndex = columnIndex;
        this.ensureColumnVisible(columnIndex);
        const nextRow = rows[nextIndex];
        nextRow?.focus();
        if (!nextRow) {
            return;
        }
        this.ensureRowVisibleVertically(nextRow);
        this.previewFocusedRow(nextRow, columnIndex);
    }

    private previewFocusedRow(row: HTMLElement, columnIndex: number): void {
        const kind = row.dataset.fcnKind;
        const path = row.dataset.fcnPath ?? "";
        if (kind === "folder" && this.columnPaths[columnIndex + 1] !== path) {
            this.openFolderColumn(path, columnIndex, false);
            return;
        }
        if (kind !== "folder" && this.columnPaths.length > columnIndex + 1) {
            this.columnPaths = this.columnPaths.slice(0, columnIndex + 1);
            this.activeColumnIndex = columnIndex;
            this.refresh();
            if (kind === "file") {
                this.focusFilePath(path);
            }
        }
    }

    private focusNavigationPath(): void {
        const row = Array.from(this.containerEl.querySelectorAll<HTMLElement>('[data-fcn-row="navigation"]'))
            .find(item => item.dataset.fcnPath === this.navigationBasePath);
        row?.focus();
    }

    private focusPreviousColumnOrNavigation(columnIndex: number): void {
        if (columnIndex === 0) {
            if (this.plugin.settings.showRootFoldersAtTop) {
                return;
            }
            this.rememberNavigationPosition();
            this.focusNavigationPath();
            return;
        }

        const openedPath = this.columnPaths[columnIndex];
        const parentPath = this.columnPaths[columnIndex - 1];
        if (this.lastFocusedRow?.area === "column" && this.lastFocusedRow.columnIndex === columnIndex) {
            this.childColumnSelections.set(parentPath, {
                childPath: openedPath,
                itemPath: this.lastFocusedRow.path,
                kind: this.lastFocusedRow.kind
            });
        }
        const previousColumn = this.columnsEl.querySelector<HTMLElement>(
            `.fcn-column[data-fcn-column="${columnIndex - 1}"]`
        );
        const previousFolderRow = Array.from(previousColumn?.querySelectorAll<HTMLElement>('[data-fcn-row="column"]') ?? [])
            .find(row => row.dataset.fcnKind === "folder" && row.dataset.fcnPath === openedPath);
        this.activeColumnIndex = columnIndex - 1;
        this.ensureColumnVisible(columnIndex - 1);
        (previousFolderRow ?? previousColumn?.querySelector<HTMLElement>('[data-fcn-row="column"]'))?.focus();
    }

    private focusFirstColumnItem(columnIndex: number): void {
        this.activeColumnIndex = columnIndex;
        this.ensureColumnVisible(columnIndex);
        const column = this.columnsEl.querySelector<HTMLElement>(`.fcn-column[data-fcn-column="${columnIndex}"]`);
        const firstItem = Array.from(column?.querySelectorAll<HTMLElement>('[data-fcn-row="column"]') ?? [])
            .find(row => row.dataset.fcnKind !== "special");
        if (firstItem) {
            firstItem.focus();
        } else {
            this.containerEl.focus();
        }
    }

    private ensureColumnVisible(columnIndex: number): void {
        const column = this.columnsEl.querySelector<HTMLElement>(`.fcn-column[data-fcn-column="${columnIndex}"]`);
        if (!column) {
            return;
        }

        const containerRect = this.columnsEl.getBoundingClientRect();
        const columnRect = column.getBoundingClientRect();
        const viewLeft = this.columnsEl.scrollLeft;
        const viewRight = viewLeft + this.columnsEl.clientWidth;
        const columnLeft = columnRect.left - containerRect.left + this.columnsEl.scrollLeft;
        const columnRight = columnRect.right - containerRect.left + this.columnsEl.scrollLeft;
        const columnWidth = columnRight - columnLeft;
        if (columnWidth >= this.columnsEl.clientWidth) {
            if (columnRight <= viewLeft) {
                this.columnsEl.scrollLeft = Math.max(0, columnRight - this.columnsEl.clientWidth);
            } else if (columnLeft >= viewRight) {
                this.columnsEl.scrollLeft = columnLeft;
            }
            return;
        }
        if (columnLeft < viewLeft) {
            this.columnsEl.scrollLeft = columnLeft;
        } else if (columnRight > viewRight) {
            this.columnsEl.scrollLeft = Math.max(0, columnRight - this.columnsEl.clientWidth);
        }
    }

    private ensureRowVisibleVertically(row: HTMLElement): void {
        const list = row.closest<HTMLElement>(".fcn-column-list");
        if (!list) {
            return;
        }
        const listRect = list.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        if (rowRect.top < listRect.top) {
            list.scrollTop -= listRect.top - rowRect.top;
        } else if (rowRect.bottom > listRect.bottom) {
            list.scrollTop += rowRect.bottom - listRect.bottom;
        }
    }

    private focusFolderPath(path: string, columnIndex: number): void {
        const column = this.columnsEl.querySelector<HTMLElement>(`.fcn-column[data-fcn-column="${columnIndex}"]`);
        const row = Array.from(column?.querySelectorAll<HTMLElement>('[data-fcn-row="column"]') ?? [])
            .find(item => item.dataset.fcnKind === "folder" && item.dataset.fcnPath === path);
        if (row) {
            this.ensureColumnVisible(columnIndex);
            row.focus();
            this.ensureRowVisibleVertically(row);
        }
    }

    private focusRememberedChildItem(
        columnIndex: number,
        selection: { childPath: string; itemPath: string; kind?: string }
    ): void {
        const column = this.columnsEl.querySelector<HTMLElement>(`.fcn-column[data-fcn-column="${columnIndex}"]`);
        const row = Array.from(column?.querySelectorAll<HTMLElement>('[data-fcn-row="column"]') ?? [])
            .find(item => item.dataset.fcnPath === selection.itemPath && item.dataset.fcnKind === selection.kind);
        if (row) {
            this.ensureColumnVisible(columnIndex);
            row.focus();
            this.ensureRowVisibleVertically(row);
            return;
        }
        this.focusFirstColumnItem(columnIndex);
    }

    private showNavigationMenu(event: MouseEvent): void {
        event.preventDefault();
        const menu = new Menu();
        menu.addItem(item => item.setTitle("刷新文件列表").setIcon("refresh-cw").onClick(() => this.refresh()));
        menu.showAtMouseEvent(event);
    }
}

class FolderColumnNavigatorSettingTab extends PluginSettingTab {
    private readonly plugin: FolderColumnNavigatorPlugin;
    private legacyActivePageIndex = 0;

    constructor(app: FolderColumnNavigatorPlugin["app"], plugin: FolderColumnNavigatorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
        Object.defineProperties(this, {
            [LEGACY_SETTINGS_RENDER_METHOD]: {
                configurable: true,
                value: () => this.renderLegacySettings()
            },
            [DECLARATIVE_SETTINGS_METHOD]: {
                configurable: true,
                value: () => this.createSettingDefinitions()
            },
            [DECLARATIVE_GET_CONTROL_METHOD]: {
                configurable: true,
                value: (key: string) => this.readControlValue(key)
            },
            [DECLARATIVE_SET_CONTROL_METHOD]: {
                configurable: true,
                value: (key: string, value: unknown) => this.applyControlValue(key, value)
            }
        });
    }

    private renderLegacySettings(): void {
        this.containerEl.empty();
        this.containerEl.addClass("fcn-settings-fallback");
        new Setting(this.containerEl).setName("目录文件列表").setHeading();

        const pages = this.createSettingDefinitions()
            .filter(item => item.type === "page");
        if (pages.length === 0) {
            return;
        }

        const activePageIndex = Math.max(0, Math.min(this.legacyActivePageIndex, pages.length - 1));
        this.legacyActivePageIndex = activePageIndex;
        const tabs = this.containerEl.createDiv("fcn-settings-tabs");
        pages.forEach((page, index) => {
            const tab = tabs.createEl("button", {
                text: page.name ?? "",
                cls: "fcn-settings-tab",
                attr: {
                    type: "button",
                    "aria-selected": String(index === activePageIndex)
                }
            });
            tab.toggleClass("is-active", index === activePageIndex);
            tab.addEventListener("click", () => {
                this.legacyActivePageIndex = index;
                this.renderLegacySettings();
            });
        });

        const content = this.containerEl.createDiv("fcn-settings-content");
        const page = pages[activePageIndex];
        new Setting(content)
            .setName(page.name ?? "")
            .setDesc(page.desc ?? "")
            .setHeading();
        this.renderLegacySettingItems(content, page.items ?? []);
    }

    private renderLegacySettingItems(containerEl: HTMLElement, items: LegacySettingItem[]): void {
        items.forEach(item => {
            if (!this.isLegacySettingVisible(item.visible)) {
                return;
            }

            if (item.control && item.name) {
                this.renderLegacyControl(containerEl, item);
                return;
            }

            if (item.render && item.name) {
                const setting = new Setting(containerEl).setName(item.name);
                if (item.desc) {
                    setting.setDesc(item.desc);
                }
                item.render(setting);
                return;
            }

            if (item.type === "page" && item.name) {
                new Setting(containerEl).setName(item.name).setDesc(item.desc ?? "").setHeading();
                this.renderLegacySettingItems(containerEl, item.items ?? []);
                return;
            }

            if (item.type === "group" || item.type === "list") {
                if (item.heading) {
                    new Setting(containerEl).setName(item.heading).setHeading();
                }
                this.renderLegacySettingItems(containerEl, item.items ?? []);
            }
        });
    }

    private renderLegacyControl(containerEl: HTMLElement, definition: LegacySettingItem): void {
        if (!definition.control || !definition.name) {
            return;
        }

        const setting = new Setting(containerEl).setName(definition.name);
        if (definition.desc) {
            setting.setDesc(definition.desc);
        }

        const control = definition.control;
        const currentValue = this.readControlValue(control.key);
        const refreshAfterChange = [
            "showRootFoldersAtTop",
            "wrapItemNames",
            "showFolderNotes",
            "folderNoteMatchSpecialName",
            "calendarMatchFrontmatter",
            "calendarMatchFilename"
        ].includes(control.key);
        const onChange = (value: unknown): void => {
            void this.setLegacyControlValue(control.key, value, refreshAfterChange);
        };

        switch (control.type) {
            case "toggle":
                setting.addToggle(toggle => toggle
                    .setValue(Boolean(currentValue))
                    .onChange(value => onChange(value)));
                break;
            case "dropdown":
                setting.addDropdown(dropdown => {
                    Object.entries(control.options).forEach(([value, label]) => dropdown.addOption(value, label));
                    const selectedValue = typeof currentValue === "string"
                        ? currentValue
                        : Object.keys(control.options)[0];
                    dropdown.setValue(selectedValue);
                    dropdown.onChange(value => onChange(value));
                });
                break;
            case "text":
                setting.addText(text => {
                    text.setValue(typeof currentValue === "string" ? currentValue : "");
                    if (control.placeholder) {
                        text.setPlaceholder(control.placeholder);
                    }
                    text.onChange(value => onChange(value));
                });
                break;
            case "textarea":
                setting.addTextArea(textarea => {
                    textarea.setValue(typeof currentValue === "string" ? currentValue : "");
                    textarea.inputEl.rows = control.rows ?? 3;
                    if (control.placeholder) {
                        textarea.setPlaceholder(control.placeholder);
                    }
                    textarea.onChange(value => onChange(value));
                });
                break;
            case "slider":
                setting.addSlider(slider => {
                    const value = typeof currentValue === "number" && Number.isFinite(currentValue)
                        ? currentValue
                        : control.min;
                    slider.setLimits(control.min, control.max, control.step).setValue(value);
                    slider.onChange(value => onChange(value));
                });
                break;
            case "number":
                setting.addText(text => {
                    text.setValue(typeof currentValue === "number" ? String(currentValue) : "");
                    if (control.placeholder) {
                        text.setPlaceholder(control.placeholder);
                    }
                    text.onChange(value => onChange(Number(value)));
                });
                break;
            default:
                break;
        }
    }

    private isLegacySettingVisible(visible?: boolean | (() => boolean)): boolean {
        return typeof visible === "function" ? visible() : visible !== false;
    }

    private async setLegacyControlValue(key: string, value: unknown, refresh: boolean): Promise<void> {
        await this.applyControlValue(key, value);
        if (refresh) {
            this.refreshSettingsTab();
        }
    }

    private refreshSettingsTab(): void {
        const update: unknown = Reflect.get(this, "update");
        if (typeof update === "function") {
            Reflect.apply(update, this, []);
            return;
        }
        this.renderLegacySettings();
    }

    private createSettingDefinitions(): LegacySettingItem[] {
        return [
            {
                type: "page",
                name: "导航",
                desc: "一级目录、置顶展示和自定义目录。",
                items: [
                    {
                        name: "一级目录置顶展示",
                        desc: "将一级目录放到顶部标签区域，下面保留当前目录的多级展开区域。",
                        control: { type: "toggle", key: "showRootFoldersAtTop" }
                    },
                    {
                        name: "顶部默认展示行数",
                        desc: "顶部一级目录超过这个行数后，点击展开按钮查看更多目录。",
                        visible: () => this.plugin.settings.showRootFoldersAtTop,
                        control: {
                            type: "slider",
                            key: "rootFolderVisibleRows",
                            min: 1,
                            max: 8,
                            step: 1,
                            displayFormat: value => `${value} 行`
                        }
                    },
                    {
                        name: "添加自定义目录",
                        desc: "例如：工作/项目，路径必须存在于当前仓库。",
                        render: setting => {
                            let inputValue = "";
                            setting.addText(text => text
                                .setPlaceholder("工作/项目")
                                .onChange(value => {
                                    inputValue = value;
                                }))
                                .addButton(button => button.setButtonText("添加").setCta().onClick(() => {
                                    void this.plugin.addCustomFolder(inputValue).then(added => {
                                        if (added) {
                                            this.refreshSettingsTab();
                                        }
                                    });
                                }));
                        }
                    },
                    {
                        type: "group",
                        heading: "一级目录",
                        items: this.plugin.getRootFolders().map(folder => ({
                            name: folder.name,
                            desc: folder.path,
                            render: setting => {
                                setting
                                    .addButton(button => button
                                        .setButtonText(this.plugin.isPinned(folder.path) ? "取消置顶" : "置顶")
                                        .onClick(() => void this.plugin.togglePinned(folder.path).then(() => this.refreshSettingsTab())))
                                    .addButton(button => button
                                        .setButtonText(this.plugin.settings.hiddenRootPaths.includes(folder.path) ? "显示" : "隐藏")
                                        .onClick(() => void this.plugin.toggleHiddenRoot(folder.path).then(() => this.refreshSettingsTab())));
                            }
                        }))
                    },
                    {
                        type: "group",
                        heading: "自定义目录",
                        items: this.plugin.settings.customFolders.map(path => {
                            const folder = this.plugin.getFolder(path);
                            return {
                                name: folder?.name ?? path,
                                desc: path,
                                render: setting => {
                                    setting
                                        .addText(text => text
                                            .setPlaceholder("显示名称")
                                            .setValue(this.plugin.settings.customFolderNames[path] ?? "")
                                            .onChange(value => void this.plugin.updateCustomFolderDisplayName(path, value)))
                                        .addButton(button => button
                                            .setButtonText(this.plugin.isPinned(path) ? "取消置顶" : "置顶")
                                        .onClick(() => void this.plugin.togglePinned(path).then(() => this.refreshSettingsTab())))
                                        .addExtraButton(button => button
                                            .setIcon("trash")
                                            .setTooltip("移除自定义目录")
                                            .onClick(() => void this.plugin.removeCustomFolder(path).then(() => this.refreshSettingsTab())));
                                }
                            };
                        })
                    }
                ]
            },
            {
                type: "page",
                name: "显示",
                desc: "名称排版、条目详情与图标。",
                items: [
                    {
                        type: "group",
                        heading: "文字与布局",
                        items: [
                            {
                                name: "一级目录名称字号",
                                desc: "调整左侧模式下一级目录的文字大小。顶部目录标签使用“文件树名称字号”。",
                                control: this.itemFontSlider("rootFolderFontSize")
                            },
                            {
                                name: "文件树名称字号",
                                desc: "调整文件树中目录和文件名称；顶部模式下也用于一级目录标签。",
                                control: this.itemFontSlider("fileNameFontSize")
                            },
                            {
                                name: "长名称自动换行",
                                desc: "目录和文件名称超出列宽时换行显示；关闭后以省略号截断。",
                                control: { type: "toggle", key: "wrapItemNames" }
                            },
                            {
                                name: "名称最大行数",
                                desc: "达到最大行数后截断，避免单个条目占用过多高度。默认 2 行。",
                                visible: () => this.plugin.settings.wrapItemNames,
                                control: {
                                    type: "slider",
                                    key: "wrapItemNameMaxLines",
                                    min: MIN_ITEM_NAME_WRAP_LINES,
                                    max: MAX_ITEM_NAME_WRAP_LINES,
                                    step: 1,
                                    displayFormat: value => `${value} 行`
                                }
                            },
                            {
                                name: "文件树名称左对齐",
                                desc: "文件未显示图标而文件夹显示图标时，为文件保留图标位置，使目录和文件名称左对齐。",
                                control: { type: "toggle", key: "alignFileTreeNames" }
                            },
                            {
                                name: "隐藏文件后缀名",
                                desc: "文件列表只显示文件基础名称；右侧类型缩写仍由“显示条目元信息”控制。",
                                control: { type: "toggle", key: "hideFileExtensions" }
                            }
                        ]
                    },
                    {
                        type: "group",
                        heading: "条目详情",
                        items: [
                            {
                                name: "显示条目元信息",
                                desc: "在目录右侧显示子文件和子目录数量，在文件右侧显示文件类型。",
                                control: { type: "toggle", key: "showItemMetadata" }
                            },
                            {
                                name: "文件属性名称",
                                desc: "每行一个 Frontmatter 属性。展示所有有值的属性，作为文件名称下方的次级信息。",
                                control: {
                                    type: "textarea",
                                    key: "fileMetadataKeysText",
                                    placeholder: "status\nproject"
                                }
                            },
                            {
                                name: "展示属性名",
                                desc: "在文件和文件夹笔记的属性值前显示属性名；默认只显示属性值。",
                                control: { type: "toggle", key: "showMetadataNames" }
                            },
                            {
                                name: "文件日期",
                                desc: "作为文件名称下方的次级信息展示。",
                                control: {
                                    type: "dropdown",
                                    key: "fileDateDisplay",
                                    options: { none: "不显示", created: "创建日期", modified: "修改日期" }
                                }
                            }
                        ]
                    },
                    {
                        type: "group",
                        heading: "图标",
                        items: [
                            {
                                name: "文件夹图标",
                                desc: "可保留文件夹图标、显示右箭头（>）或完全隐藏。",
                                control: {
                                    type: "dropdown",
                                    key: "folderIconStyle",
                                    options: { folder: "文件夹", chevron: "右箭头（>）", none: "不显示" }
                                }
                            },
                            {
                                name: "文件图标",
                                desc: "可保留通用文件图标、按常见文件类型显示图标或完全隐藏。",
                                control: {
                                    type: "dropdown",
                                    key: "fileIconStyle",
                                    options: { file: "通用文件", type: "按文件类型", none: "不显示" }
                                }
                            }
                        ]
                    }
                ]
            },
            {
                type: "page",
                name: "文件夹笔记",
                desc: "识别文件夹笔记、优先排序并展示其属性。",
                items: [
                    {
                        name: "启用文件夹笔记",
                        desc: "识别后的文件会使用书签图标并排在当前目录最前面；文件夹可显示该笔记的属性。",
                        control: { type: "toggle", key: "showFolderNotes" }
                    },
                    {
                        name: "直属同名文件",
                        desc: "将文件夹直属、且基础名称与文件夹同名的文件识别为文件夹笔记，优先级最高。",
                        visible: () => this.plugin.settings.showFolderNotes,
                        control: { type: "toggle", key: "folderNoteMatchFolderName" }
                    },
                    {
                        name: "指定名称文件",
                        desc: "仅在不存在直属同名文件时，使用下方指定名称匹配文件夹笔记。",
                        visible: () => this.plugin.settings.showFolderNotes,
                        control: { type: "toggle", key: "folderNoteMatchSpecialName" }
                    },
                    {
                        name: "指定文件名",
                        desc: "每行一个不含后缀名的文件名；默认包含 首页、Readme、Home，不区分英文大小写。",
                        visible: () => this.plugin.settings.showFolderNotes && this.plugin.settings.folderNoteMatchSpecialName,
                        control: {
                            type: "textarea",
                            key: "folderNoteSpecialNamesText",
                            placeholder: "首页\nReadme\nHome"
                        }
                    },
                    {
                        name: "文件夹笔记属性名称",
                        desc: "每行一个 Frontmatter 属性。目录项会展示所有有值的属性，作为目录名称下方的次级信息。",
                        visible: () => this.plugin.settings.showFolderNotes,
                        control: {
                            type: "textarea",
                            key: "folderNoteMetadataKeysText",
                            placeholder: "status\nsummary"
                        }
                    }
                ]
            },
            {
                type: "page",
                name: "高级",
                desc: "隐藏规则、列宽与右键菜单。",
                items: [
                    {
                        name: "隐藏规则",
                        desc: "每行一条相对仓库根目录的 Glob 规则，支持 *、?、**。例如：附件/**、**/*.tmp、草稿/*.md；命中目录会同时隐藏其子项。",
                        control: {
                            type: "textarea",
                            key: "hiddenPatternsText",
                            placeholder: "附件/**\n**/*.tmp"
                        }
                    },
                    {
                        name: "文件列最小宽度",
                        desc: "拖动文件列时允许缩小到的最小宽度，默认 120px。",
                        control: this.columnWidthSlider("columnMinWidth")
                    },
                    {
                        name: "文件列最大宽度",
                        desc: "拖动文件列时允许放大到的最大宽度，默认 400px。",
                        control: this.columnWidthSlider("columnMaxWidth")
                    },
                    {
                        name: "显示扩展菜单项",
                        desc: "关闭后仅显示本插件自带的右键操作，不再触发 file-menu 扩展事件添加的菜单项。",
                        control: { type: "toggle", key: "showExtensionMenuItems" }
                    }
                ]
            },
            {
                type: "page",
                name: "日历",
                desc: "设置日历位置、范围、视图和日期匹配规则。多条规则命中同一文件只会显示一次。",
                items: [
                    {
                        type: "group",
                        heading: "展示",
                        items: [
                            {
                                name: "在文件列表底部展示日历",
                                desc: "关闭后不在目录文件列表底部显示日历；独立日历视图始终可通过命令面板中的“打开独立日历视图”打开。",
                                control: { type: "toggle", key: "showCalendarAtBottom" }
                            },
                            {
                                name: "命中文件显示图标",
                                desc: "控制独立日历下方命中文件列表左侧是否显示文件图标。",
                                control: { type: "toggle", key: "calendarShowFileIcons" }
                            },
                            {
                                name: "单个匹配时直接打开文件",
                                desc: "日期只匹配一个文件时直接打开；在独立日历视图中，命中文件列表仍会保留展示。",
                                control: { type: "toggle", key: "calendarOpenSingleMatch" }
                            },
                            {
                                name: "限定查找目录",
                                desc: "每行一个相对仓库根目录的目录。留空则查找整个仓库；只会匹配这些目录及其子目录中的文件。",
                                control: {
                                    type: "textarea",
                                    key: "calendarSearchPathsText",
                                    placeholder: "项目/周报\n归档"
                                }
                            }
                        ]
                    },
                    {
                        type: "group",
                        heading: "匹配规则",
                        items: [
                    {
                        name: "按创建日期匹配",
                        desc: "匹配文件的创建日期（ctime）。",
                        control: { type: "toggle", key: "calendarMatchCreatedDate" }
                    },
                    {
                        name: "按修改日期匹配",
                        desc: "匹配文件的修改日期（mtime）。",
                        control: { type: "toggle", key: "calendarMatchModifiedDate" }
                    },
                    {
                        name: "按文件属性匹配",
                        desc: "读取指定属性的值。支持 YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 和 YYYY年M月D日；属性值中包含日期也能匹配。",
                        control: { type: "toggle", key: "calendarMatchFrontmatter" }
                    },
                    {
                        name: "日期属性名称",
                        desc: "每行一个文件属性名称。默认包含 updated、created、创建日期、修改日期和 date。",
                        visible: () => this.plugin.settings.calendarMatchFrontmatter,
                        control: {
                            type: "textarea",
                            key: "calendarFrontmatterKeysText",
                            placeholder: "updated\ncreated\n创建日期"
                        }
                    },
                    {
                        name: "按文件名匹配",
                        desc: "匹配不含扩展名的文件名。日期格式可使用 YYYY、MM、DD；* 表示任意字符。",
                        control: { type: "toggle", key: "calendarMatchFilename" }
                    },
                    {
                        name: "文件名日期格式",
                        desc: "每行一条，例如 YYYYMMDD、YYYY年MM月DD日、YYYY-MM-DD*。无 * 时要求文件名完全相同。",
                        visible: () => this.plugin.settings.calendarMatchFilename,
                        control: {
                            type: "textarea",
                            key: "calendarFilenamePatternsText",
                            placeholder: "YYYYMMDD\nYYYY年MM月DD日\nYYYY-MM-DD*"
                        }
                    },
                    {
                        name: "命中文件类型",
                        desc: "每行一个文件后缀名（不含点号），例如 md、pdf、canvas。留空则匹配所有文件类型。",
                        control: {
                            type: "textarea",
                            key: "calendarFileExtensionsText",
                            placeholder: "md\ncanvas\nbase"
                        }
                    }
                        ]
                    }
                ]
            }
        ];
    }

    private readControlValue(key: string): unknown {
        if (key === "hiddenPatternsText") {
            return this.plugin.settings.hiddenPatterns.join("\n");
        }
        if (key === "calendarFrontmatterKeysText") {
            return this.plugin.settings.calendarFrontmatterKeys.join("\n");
        }
        if (key === "calendarSearchPathsText") {
            return this.plugin.settings.calendarSearchPaths.join("\n");
        }
        if (key === "calendarFilenamePatternsText") {
            return this.plugin.settings.calendarFilenamePatterns.join("\n");
        }
        if (key === "calendarFileExtensionsText") {
            return this.plugin.settings.calendarFileExtensions.join("\n");
        }
        if (key === "folderNoteSpecialNamesText") {
            return this.plugin.settings.folderNoteSpecialNames.join("\n");
        }
        if (key === "folderNoteMetadataKeysText") {
            return this.plugin.settings.folderNoteMetadataKeys.join("\n");
        }
        if (key === "fileMetadataKeysText") {
            return this.plugin.settings.fileMetadataKeys.join("\n");
        }
        return this.plugin.settings[key as keyof FolderColumnNavigatorSettings];
    }

    private async applyControlValue(key: string, value: unknown): Promise<void> {
        switch (key) {
            case "showRootFoldersAtTop":
            case "wrapItemNames":
            case "showMetadataNames":
            case "alignFileTreeNames":
            case "showFolderNotes":
            case "folderNoteMatchFolderName":
            case "folderNoteMatchSpecialName":
            case "hideFileExtensions":
            case "showItemMetadata":
            case "showExtensionMenuItems":
            case "calendarMatchCreatedDate":
            case "calendarMatchModifiedDate":
            case "calendarMatchFrontmatter":
            case "calendarMatchFilename":
            case "showCalendarAtBottom":
            case "calendarShowFileIcons":
            case "calendarOpenSingleMatch":
                this.plugin.settings[key] = Boolean(value);
                break;
            case "rootFolderVisibleRows":
                this.plugin.settings.rootFolderVisibleRows = Math.max(1, Math.min(8, Math.round(Number(value))));
                break;
            case "wrapItemNameMaxLines":
                this.plugin.settings.wrapItemNameMaxLines = clampItemNameWrapLines(value);
                break;
            case "rootFolderFontSize":
                this.plugin.settings.rootFolderFontSize = clampItemFontSize(value, DEFAULT_ROOT_FOLDER_FONT_SIZE);
                break;
            case "fileNameFontSize":
                this.plugin.settings.fileNameFontSize = clampItemFontSize(value, DEFAULT_FILE_NAME_FONT_SIZE);
                break;
            case "folderIconStyle":
                if (isFolderIconStyle(value)) {
                    this.plugin.settings.folderIconStyle = value;
                }
                break;
            case "fileIconStyle":
                if (isFileIconStyle(value)) {
                    this.plugin.settings.fileIconStyle = value;
                }
                break;
            case "fileDateDisplay":
                if (isFileDateDisplay(value)) {
                    this.plugin.settings.fileDateDisplay = value;
                }
                break;
            case "hiddenPatternsText":
                this.plugin.settings.hiddenPatterns = cleanGlobPatternList(String(value).split(/\r?\n/));
                break;
            case "calendarFrontmatterKeysText":
                this.plugin.settings.calendarFrontmatterKeys = cleanCalendarRuleList(String(value).split(/\r?\n/));
                break;
            case "calendarSearchPathsText":
                this.plugin.settings.calendarSearchPaths = [...new Set(
                    String(value)
                        .split(/\r?\n/)
                        .map(normalizeFolderPath)
                        .filter(path => path !== ROOT_PATH)
                )];
                break;
            case "calendarFilenamePatternsText":
                this.plugin.settings.calendarFilenamePatterns = cleanCalendarRuleList(String(value).split(/\r?\n/));
                break;
            case "calendarFileExtensionsText":
                this.plugin.settings.calendarFileExtensions = cleanFileExtensionList(String(value).split(/\r?\n/));
                break;
            case "folderNoteSpecialNamesText":
                this.plugin.settings.folderNoteSpecialNames = cleanTextList(String(value).split(/\r?\n/));
                break;
            case "folderNoteMetadataKeysText":
                this.plugin.settings.folderNoteMetadataKeys = cleanTextList(String(value).split(/\r?\n/));
                break;
            case "fileMetadataKeysText":
                this.plugin.settings.fileMetadataKeys = cleanTextList(String(value).split(/\r?\n/));
                break;
            case "columnMinWidth": {
                const minimum = clampConfigurableColumnWidth(value, DEFAULT_COLUMN_MIN_WIDTH);
                this.plugin.settings.columnMinWidth = minimum;
                this.plugin.settings.columnMaxWidth = Math.max(minimum, this.plugin.settings.columnMaxWidth);
                break;
            }
            case "columnMaxWidth":
                this.plugin.settings.columnMaxWidth = Math.max(
                    this.plugin.settings.columnMinWidth,
                    clampConfigurableColumnWidth(value, DEFAULT_COLUMN_MAX_WIDTH)
                );
                break;
            default:
                return;
        }
        await this.plugin.saveSettings();
        const refreshDomState: unknown = Reflect.get(this, "refreshDomState");
        if (typeof refreshDomState === "function") {
            Reflect.apply(refreshDomState, this, []);
        }
    }

    private itemFontSlider(key: "rootFolderFontSize" | "fileNameFontSize") {
        return {
            type: "slider" as const,
            key,
            min: MIN_ITEM_FONT_SIZE,
            max: MAX_ITEM_FONT_SIZE,
            step: 1,
            displayFormat: (value: number) => `${value}px`
        };
    }

    private columnWidthSlider(key: "columnMinWidth" | "columnMaxWidth") {
        return {
            type: "slider" as const,
            key,
            min: MIN_CONFIGURABLE_COLUMN_WIDTH,
            max: MAX_CONFIGURABLE_COLUMN_WIDTH,
            step: 10,
            displayFormat: (value: number) => `${value}px`
        };
    }
}
