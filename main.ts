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

const VIEW_TYPE = "folder-column-navigator";
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

type SortField = "name" | "modified" | "created";
type SortDirection = "asc" | "desc";
type FolderIconStyle = "folder" | "chevron" | "none";
type FileIconStyle = "file" | "type" | "none";

interface FolderColumnNavigatorSettings {
    pinnedPaths: string[];
    hiddenRootPaths: string[];
    customFolders: string[];
    customFolderNames: Record<string, string>;
    rootFolderOrder: string[];
    hiddenPatterns: string[];
    rootFolderFontSize: number;
    fileNameFontSize: number;
    alignFileTreeNames: boolean;
    showFolderNotes: boolean;
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
    alignFileTreeNames: false,
    showFolderNotes: false,
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
    columnMaxWidth: DEFAULT_COLUMN_MAX_WIDTH
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
        return this.app.vault.getAllLoadedFiles()
            .filter((item): item is TFolder => item instanceof TFolder)
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
        expression += /[\\^$+?.()|{}\[\]]/.test(character) ? `\\${character}` : character;
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

        this.registerEvent(this.app.vault.on("create", () => this.refreshViews()));
        this.registerEvent(this.app.vault.on("delete", () => this.refreshViews()));
        this.registerEvent(this.app.vault.on("rename", () => this.refreshViews()));

        this.addRibbonIcon("folder-tree", "打开目录文件列表", () => {
            void this.activateView();
        });
        this.addCommand({
            id: "open-folder-column-navigator",
            name: "打开目录文件列表",
            callback: () => void this.activateView()
        });
        this.addCommand({
            id: "reveal-active-file-in-folder-column-navigator",
            name: "定位当前笔记",
            callback: () => this.views.forEach(view => view.revealActiveFile())
        });
        this.addSettingTab(new FolderColumnNavigatorSettingTab(this.app, this));
    }

    onunload(): void {
        this.views.clear();
    }

    async loadSettings(): Promise<void> {
        const saved = (await this.loadData()) as Partial<FolderColumnNavigatorSettings> | null;
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
            alignFileTreeNames: typeof saved?.alignFileTreeNames === "boolean"
                ? saved.alignFileTreeNames
                : DEFAULT_SETTINGS.alignFileTreeNames,
            showFolderNotes: typeof saved?.showFolderNotes === "boolean"
                ? saved.showFolderNotes
                : DEFAULT_SETTINGS.showFolderNotes,
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
            columnMaxWidth
        };
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
        return path === ROOT_PATH ? this.app.vault.getRoot() : this.app.vault.getFolderByPath(path);
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
}

class FolderColumnNavigatorView extends ItemView {
    private readonly plugin: FolderColumnNavigatorPlugin;
    private navigationBasePath = ROOT_PATH;
    private columnPaths: string[] = [ROOT_PATH];
    private selectedFilePath: string | null = null;
    private activeColumnIndex = 0;
    private topRootFolderPane!: HTMLElement;
    private shellEl!: HTMLElement;
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

    constructor(leaf: WorkspaceLeaf, plugin: FolderColumnNavigatorPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return "目录文件列表";
    }

    getIcon(): string {
        return "folder-tree";
    }

    async onOpen(): Promise<void> {
        this.containerEl.empty();
        this.containerEl.addClass("folder-column-navigator-view");
        this.containerEl.tabIndex = 0;
        this.resizeWidth = this.plugin.settings.navigationWidth;

        const layout = this.containerEl.createDiv("fcn-layout");
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
        this.closeContextMenu(false);
        this.rootFolderResizeObserver?.disconnect();
        this.rootFolderResizeObserver = null;
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
        if (!this.navigationEl || !this.columnsEl) {
            return;
        }
        this.containerEl.style.setProperty("--fcn-root-folder-font-size", `${this.plugin.settings.rootFolderFontSize}px`);
        this.containerEl.style.setProperty("--fcn-file-name-font-size", `${this.plugin.settings.fileNameFontSize}px`);
        this.repairColumnState();
        this.shellEl.toggleClass("fcn-root-top-mode", this.plugin.settings.showRootFoldersAtTop);
        this.topRootFolderPane.toggleClass("is-visible", this.plugin.settings.showRootFoldersAtTop);
        this.renderNavigation();
        this.renderHeader();
        this.renderColumns();
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
        this.rootFolderGrid.style.setProperty("--fcn-visible-root-rows", String(this.plugin.settings.rootFolderVisibleRows));
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
            row.style.paddingLeft = `${7 + depth * 14}px`;
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
        if (entry.kind === "root-folder") {
            this.enableRootFolderDragging(row, entry.path);
        }
        return row;
    }

    private enableRootFolderDragging(row: HTMLElement, path: string): void {
        row.draggable = true;
        row.addClass("fcn-root-folder-draggable");
        row.addEventListener("dragstart", event => {
            this.draggedRootFolderPath = path;
            row.addClass("is-root-folder-dragging");
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", path);
            }
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
            void this.plugin.reorderRootFolders(draggedPath, path, insertAfter);
        });
        row.addEventListener("dragend", () => this.clearRootFolderDragState());
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
        column.style.setProperty("--fcn-column-min-width", `${this.plugin.settings.columnMinWidth}px`);
        column.style.setProperty("--fcn-column-max-width", `${this.plugin.settings.columnMaxWidth}px`);
        column.style.setProperty("--fcn-column-width", `${this.getColumnWidth(path)}px`);
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
        row.createSpan({ text: folder.name, cls: "fcn-item-name" });
        if (this.plugin.settings.showItemMetadata) {
            const visibleChildCount = folder.children.filter(child => !this.plugin.isHiddenByPattern(child.path)).length;
            row.createSpan({ text: `${visibleChildCount}`, cls: "fcn-item-meta" });
        }
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
        row.createSpan({ text: this.getFileDisplayName(file), cls: "fcn-item-name" });
        if (this.plugin.settings.showItemMetadata) {
            row.createSpan({ text: file.extension.toUpperCase(), cls: "fcn-item-meta" });
        }
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
        menu.addSeparator();
        menu.addItem(item => item.setSection("action").setTitle("移动到…").setIcon("folder-input").onClick(() => this.promptMove(folder)));
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
        if (item instanceof TFolder) {
            this.plugin.app.vault.getAllLoadedFiles()
                .filter((candidate): candidate is TFolder => candidate instanceof TFolder)
                .filter(candidate => candidate.path === item.path || candidate.path.startsWith(`${item.path}/`))
                .forEach(candidate => excludedPaths.add(candidate.path));
        }
        new FolderDestinationModal(this.plugin.app, excludedPaths, async targetFolder => {
            if (targetFolder.path === item.parent?.path) {
                return;
            }
            const nextPath = joinVaultPath(targetFolder, item.name);
            if (this.plugin.app.vault.getAbstractFileByPath(nextPath)) {
                new Notice("目标目录已有同名文件或目录。", 3000);
                return;
            }
            await this.plugin.app.fileManager.renameFile(item, nextPath);
        }).open();
    }

    private async deleteItem(item: TAbstractFile): Promise<void> {
        if (await this.plugin.app.fileManager.promptForDeletion(item)) {
            await this.plugin.app.fileManager.trashFile(item);
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
            await this.plugin.app.vault.createFolder(path);
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

    private isFolderNote(file: TAbstractFile, parent: TFolder): boolean {
        return this.plugin.settings.showFolderNotes && file instanceof TFile && file.basename === parent.name;
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
        this.shellEl.style.gridTemplateColumns = `${this.resizeWidth}px 5px minmax(0, 1fr)`;
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
            this.columnWidths.get(path) ?? this.columnPreferredWidths.get(path) ?? this.plugin.settings.columnMinWidth,
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
        column.style.setProperty("--fcn-column-min-width", `${this.plugin.settings.columnMinWidth}px`);
        column.style.setProperty("--fcn-column-max-width", `${this.plugin.settings.columnMaxWidth}px`);
        column.style.setProperty("--fcn-column-width", `${width}px`);
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
        const children = Array.from(row.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
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
        column?.style.setProperty("--fcn-column-width", `${width}px`);
    };

    private readonly handleColumnResizeEnd = (): void => {
        this.stopColumnResize();
    };

    private stopColumnResize(): void {
        this.columnResize = null;
        this.containerEl.removeClass("fcn-is-resizing");
        document.removeEventListener("pointermove", this.handleColumnResizeMove);
        document.removeEventListener("pointerup", this.handleColumnResizeEnd);
        document.removeEventListener("pointercancel", this.handleColumnResizeEnd);
    }

    private handleKeyDown(event: KeyboardEvent): void {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) {
            return;
        }

        if (event.key === "Escape" && this.filterState) {
            event.preventDefault();
            this.clearFilter();
            return;
        }
        if (target instanceof HTMLButtonElement || target instanceof HTMLSelectElement || target instanceof HTMLInputElement) {
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
        const target = event.target instanceof HTMLElement ? event.target : null;
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
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) {
            return;
        }
        if (target.closest('[data-fcn-row], button, select, input, textarea, .fcn-resize-divider')) {
            return;
        }
        this.focusCurrentSelection();
    }

    private handleBlankClick(event: MouseEvent): void {
        const target = event.target instanceof HTMLElement ? event.target : null;
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
    private activeTab: "navigation" | "appearance" | "advanced" = "navigation";

    constructor(app: FolderColumnNavigatorPlugin["app"], plugin: FolderColumnNavigatorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "目录文件列表" });
        containerEl.createEl("p", {
            text: "左侧默认显示仓库根目录和所有一级目录。隐藏只影响快捷列，不会删除仓库内容；自定义目录可以是任意层级。"
        });

        const tabs = containerEl.createDiv("fcn-settings-tabs");
        ([
            ["navigation", "导航"],
            ["appearance", "显示"],
            ["advanced", "高级"]
        ] as const).forEach(([id, label]) => {
            const tab = tabs.createEl("button", { text: label, cls: "fcn-settings-tab", attr: { type: "button" } });
            tab.toggleClass("is-active", this.activeTab === id);
            tab.addEventListener("click", () => {
                this.activeTab = id;
                this.display();
            });
        });
        const contentEl = containerEl.createDiv("fcn-settings-content");
        const showNavigation = this.activeTab === "navigation";
        const showAppearance = this.activeTab === "appearance";
        const showAdvanced = this.activeTab === "advanced";

        if (showNavigation) {
        new Setting(contentEl)
            .setName("一级目录置顶展示")
            .setDesc("将一级目录放到顶部网格区域，下面保留当前目录的多级展开区域。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showRootFoldersAtTop)
                .onChange(value => {
                    this.plugin.settings.showRootFoldersAtTop = value;
                    void this.plugin.saveSettings().then(() => this.display());
                }));

        new Setting(contentEl)
            .setName("顶部默认展示行数")
            .setDesc("顶部一级目录超过这个行数后，点击展开按钮查看更多目录。")
            .addSlider(slider => slider
                .setLimits(1, 8, 1)
                .setValue(this.plugin.settings.rootFolderVisibleRows)
                .setDynamicTooltip()
                .onChange(value => {
                    this.plugin.settings.rootFolderVisibleRows = value;
                    void this.plugin.saveSettings();
                }));
        }

        if (showAppearance) {
        new Setting(contentEl)
            .setName("显示条目元信息")
            .setDesc("在目录右侧显示子文件和子目录数量，在文件右侧显示文件类型。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showItemMetadata)
                .onChange(value => {
                    this.plugin.settings.showItemMetadata = value;
                    void this.plugin.saveSettings();
                }));

        new Setting(contentEl)
            .setName("一级目录名称字号")
            .setDesc("调整左侧模式下一级目录的文字大小。顶部目录标签使用“文件树文件名字号”。")
            .addSlider(slider => slider
                .setLimits(MIN_ITEM_FONT_SIZE, MAX_ITEM_FONT_SIZE, 1)
                .setValue(this.plugin.settings.rootFolderFontSize)
                .setDynamicTooltip()
                .onChange(value => {
                    this.plugin.settings.rootFolderFontSize = value;
                    void this.plugin.saveSettings();
                }));

        new Setting(contentEl)
            .setName("文件树文件名字号")
            .setDesc("调整右侧文件树中的目录和文件名称；顶部模式下也用于一级目录标签。")
            .addSlider(slider => slider
                .setLimits(MIN_ITEM_FONT_SIZE, MAX_ITEM_FONT_SIZE, 1)
                .setValue(this.plugin.settings.fileNameFontSize)
                .setDynamicTooltip()
                .onChange(value => {
                    this.plugin.settings.fileNameFontSize = value;
                    void this.plugin.saveSettings();
                }));

        new Setting(contentEl)
            .setName("文件树名称左对齐")
            .setDesc("文件未显示图标而文件夹显示图标时，为文件保留图标位置，使目录和文件名称左对齐。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.alignFileTreeNames)
                .onChange(value => {
                    this.plugin.settings.alignFileTreeNames = value;
                    void this.plugin.saveSettings();
                }));

        new Setting(contentEl)
            .setName("文件夹笔记优先显示")
            .setDesc("当前目录下与目录同名的文件会被视为文件夹笔记，并始终排在最前面。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showFolderNotes)
                .onChange(value => {
                    this.plugin.settings.showFolderNotes = value;
                    void this.plugin.saveSettings();
                }));

        new Setting(contentEl)
            .setName("隐藏文件后缀名")
            .setDesc("文件列表只显示文件基础名称；右侧类型缩写仍由“显示条目元信息”控制。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideFileExtensions)
                .onChange(value => {
                    this.plugin.settings.hideFileExtensions = value;
                    void this.plugin.saveSettings();
                }));
        }

        if (showAdvanced) {
        new Setting(contentEl)
            .setName("隐藏规则")
            .setDesc("每行一条相对仓库根目录的 Glob 规则，支持 *、?、**。例如：附件/**、**/*.tmp、草稿/*.md；命中目录会同时隐藏其子项。")
            .addTextArea(textArea => {
                textArea.setPlaceholder("附件/**\n**/*.tmp");
                textArea.setValue(this.plugin.settings.hiddenPatterns.join("\n"));
                textArea.inputEl.rows = 5;
                textArea.onChange(value => {
                    this.plugin.settings.hiddenPatterns = cleanGlobPatternList(value.split(/\r?\n/));
                    void this.plugin.saveSettings();
                });
            });

        new Setting(contentEl)
            .setName("文件列最小宽度")
            .setDesc("拖动文件列时允许缩小到的最小宽度，默认 120px。")
            .addSlider(slider => slider
                .setLimits(MIN_CONFIGURABLE_COLUMN_WIDTH, MAX_CONFIGURABLE_COLUMN_WIDTH, 10)
                .setValue(this.plugin.settings.columnMinWidth)
                .setDynamicTooltip()
                .onChange(value => {
                    this.plugin.settings.columnMinWidth = value;
                    this.plugin.settings.columnMaxWidth = Math.max(value, this.plugin.settings.columnMaxWidth);
                    void this.plugin.saveSettings();
                }));

        new Setting(contentEl)
            .setName("文件列最大宽度")
            .setDesc("拖动文件列时允许放大到的最大宽度，默认 400px。")
            .addSlider(slider => slider
                .setLimits(MIN_CONFIGURABLE_COLUMN_WIDTH, MAX_CONFIGURABLE_COLUMN_WIDTH, 10)
                .setValue(this.plugin.settings.columnMaxWidth)
                .setDynamicTooltip()
                .onChange(value => {
                    this.plugin.settings.columnMaxWidth = Math.max(value, this.plugin.settings.columnMinWidth);
                    void this.plugin.saveSettings();
                }));
        new Setting(contentEl)
            .setName("显示扩展菜单项")
            .setDesc("关闭后仅显示本插件自带的右键操作，不再触发 file-menu 扩展事件添加的菜单项。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showExtensionMenuItems)
                .onChange(value => {
                    this.plugin.settings.showExtensionMenuItems = value;
                    void this.plugin.saveSettings();
                }));
        }

        if (showAppearance) {
        new Setting(contentEl)
            .setName("文件夹图标")
            .setDesc("可保留文件夹图标、显示右箭头（>）或完全隐藏。")
            .addDropdown(dropdown => dropdown
                .addOptions({ folder: "文件夹", chevron: "右箭头（>）", none: "不显示" })
                .setValue(this.plugin.settings.folderIconStyle)
                .onChange(value => {
                    if (isFolderIconStyle(value)) {
                        this.plugin.settings.folderIconStyle = value;
                        void this.plugin.saveSettings();
                    }
                }));

        new Setting(contentEl)
            .setName("文件图标")
            .setDesc("可保留通用文件图标、按常见文件类型显示图标或完全隐藏。")
            .addDropdown(dropdown => dropdown
                .addOptions({ file: "通用文件", type: "按文件类型", none: "不显示" })
                .setValue(this.plugin.settings.fileIconStyle)
                .onChange(value => {
                    if (isFileIconStyle(value)) {
                        this.plugin.settings.fileIconStyle = value;
                        void this.plugin.saveSettings();
                    }
                }));
        }

        if (showNavigation) {
        let inputValue = "";
        new Setting(contentEl)
            .setName("添加自定义目录")
            .setDesc("例如：工作/项目，路径必须存在于当前仓库。")
            .addText(text => {
                text.setPlaceholder("工作/项目");
                text.onChange(value => {
                    inputValue = value;
                });
            })
            .addButton(button => button.setButtonText("添加").setCta().onClick(() => {
                void this.plugin.addCustomFolder(inputValue).then(added => {
                    if (added) {
                        inputValue = "";
                        this.display();
                    }
                });
            }));

        contentEl.createEl("h3", { text: "一级目录" });
        this.plugin.getRootFolders().forEach(folder => {
            new Setting(contentEl)
                .setName(folder.name)
                .setDesc(folder.path)
                .addButton(button => button
                    .setButtonText(this.plugin.isPinned(folder.path) ? "取消置顶" : "置顶")
                    .onClick(() => void this.plugin.togglePinned(folder.path).then(() => this.display())))
                .addButton(button => button
                    .setButtonText(this.plugin.settings.hiddenRootPaths.includes(folder.path) ? "显示" : "隐藏")
                    .onClick(() => void this.plugin.toggleHiddenRoot(folder.path).then(() => this.display())));
        });

        contentEl.createEl("h3", { text: "自定义目录" });
        if (this.plugin.settings.customFolders.length === 0) {
            contentEl.createEl("p", { text: "还没有自定义目录。" });
        }
        this.plugin.settings.customFolders.forEach(path => {
            const folder = this.plugin.getFolder(path);
            new Setting(contentEl)
                .setName(folder?.name ?? path)
                .setDesc(path)
                .addText(text => {
                    text.setPlaceholder("显示名称");
                    text.setValue(this.plugin.settings.customFolderNames[path] ?? "");
                    text.onChange(value => void this.plugin.updateCustomFolderDisplayName(path, value));
                })
                .addButton(button => button
                    .setButtonText(this.plugin.isPinned(path) ? "取消置顶" : "置顶")
                    .onClick(() => void this.plugin.togglePinned(path).then(() => this.display())))
                .addExtraButton(button => button
                    .setIcon("trash")
                    .setTooltip("移除自定义目录")
                    .onClick(() => void this.plugin.removeCustomFolder(path).then(() => this.display())));
        });
        }
    }
}
