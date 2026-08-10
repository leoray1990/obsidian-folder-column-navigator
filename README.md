# Folder Column Navigator

[中文](#中文说明) · [English](#english)

Use a Finder-style, multi-column file navigator inside Obsidian. Browse folders in context, jump between top-level areas quickly, and open notes without leaving the navigator.

> This plugin works entirely inside your vault. It does not send data over the network and does not collect telemetry.

## Highlights

- Two layouts: a left-hand root-folder list or root folders displayed as top tags.
- Finder-style column browsing: opening a folder adds a column for its direct children.
- Fast keyboard navigation, with the focus staying in the navigator after opening a note.
- Per-column filtering with English, numbers, Chinese characters, pinyin initials, full pinyin, and mixed pinyin queries.
- File-list-like sorting, item metadata, configurable icons, font sizes, widths, and hiding rules.
- Built-in file and folder context menus, plus compatibility with other plugins through Obsidian's `file-menu` event.
- Immediate duplicate-name validation when creating or renaming files and folders.

## Installation

### From the community plugins directory

1. Open **Settings → Community plugins**.
2. Search for **Folder Column Navigator**.
3. Install and enable it.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from a release.
2. Create `<vault>/.obsidian/plugins/folder-column-navigator/`.
3. Copy the three files into that folder.
4. Enable **Folder Column Navigator** in **Settings → Community plugins**.

Open the view from the ribbon folder icon, or run **Open Folder Column Navigator** from the command palette.

---

# 中文说明

## 它解决什么问题

Obsidian 自带文件列表适合查看完整目录树，但在层级较深的仓库里，频繁展开、收起和横向寻找目录会打断阅读节奏。

目录文件列表将常用的一级目录集中到一个导航区域，并在右侧以 Finder 风格逐列展开目录。你可以一边保留上级目录上下文，一边继续深入文件夹；打开笔记后，焦点仍留在插件中，适合连续浏览和整理笔记。

## 主要功能

### 两种一级目录布局

**左侧目录列**是默认布局：仓库根目录和一级目录位于左侧，右侧为当前目录的多列文件树。适合侧边栏较宽、需要长期浏览目录的场景。

**顶部一级目录**可在设置中开启：一级目录以标签形式横跨视图顶部，下面全部空间都用于文件树。标签可自动换行、设置默认展示行数，并支持展开/收起超出的目录。

两种布局都支持：

- 拖拽调整一级目录顺序。
- 在设置中置顶或隐藏一级目录。
- 添加任意层级的自定义目录，并为它设置独立显示名称。
- 使用“定位当前笔记”跳转并展开当前编辑器笔记所在的目录链。

### Finder 风格多列文件树

- 单击文件夹，在右侧新增一列展示它的直属子项。
- 单击文件，直接打开笔记；已打开的笔记会复用现有标签页。
- 每一列保留返回上一级入口，并能独立拖动调整宽度。
- 文件列宽度默认按内容计算；可在设置中设定最小和最大宽度。
- 在一级目录之间切换后，会记住该目录上次展开到的列和焦点位置。

### 排序与显示

文件树右上角可按以下规则排序，并切换正序/倒序：

- 名称
- 修改日期
- 创建日期

还可配置：

- 显示或隐藏目录子项数量、文件类型缩写等元信息。
- 一级目录与文件树的独立字号。
- 文件夹图标：文件夹、右箭头或不显示。
- 文件图标：通用图标、按常见文件类型显示或不显示。
- 隐藏文件扩展名；不会影响右侧可单独关闭的类型缩写。
- 目录与文件名称左对齐。
- 文件夹笔记优先显示：当目录内存在与目录同名的文件时，将其识别为文件夹笔记，置顶并显示书签图标。

### 隐藏规则

在设置的“隐藏规则”中，每行填写一条相对于仓库根目录的 Glob 规则：

```text
附件/**
**/*.tmp
草稿/*.md
```

支持 `*`、`?` 和 `**`。命中目录后，其子项也会一并隐藏；这只影响插件视图，不会删除或移动任何仓库文件。

### 拼音与数字筛选

当前焦点位于一级目录或任一文件列时，直接输入即可筛选该区域：

- 支持英文、数字和汉字。
- 支持全拼、首字母与混合拼音，例如 `nh`、`nih` 可以匹配“你好”。
- 筛选期间，上下方向键只在命中的条目间移动。
- `Backspace` 删除一个筛选字符，`Esc` 清除筛选；筛选提示也可点击清除。

## 操作方式

### 鼠标

| 操作 | 效果 |
| --- | --- |
| 单击一级目录 | 切换当前目录并显示其内容 |
| 单击文件夹 | 在右侧展开子列 |
| 单击文件 | 打开文件 |
| 拖拽一级目录 | 调整一级目录顺序 |
| 拖拽列分割线 | 调整左侧目录列或文件列宽度 |
| 右键文件/文件夹 | 打开上下文菜单 |

### 键盘

| 按键 | 效果 |
| --- | --- |
| `↑` / `↓` | 在当前列或当前一级目录区域中移动焦点 |
| `←` / `→` | 在父列与子列之间移动；在文件夹上向右会展开子列 |
| `Enter` | 进入文件夹或打开文件 |
| `Space` | 打开当前文件或文件夹的上下文菜单；菜单打开后再次按 `Space` 关闭 |
| `Shift` + `↑` | 顶部布局下，从文件树回到顶部一级目录 |
| `Esc` | 清除当前筛选；无筛选时关闭上下文菜单 |
| `Backspace` | 删除一个筛选字符；在上下文菜单中优先删除菜单筛选字符 |

在顶部布局中，`↑`、`↓`、`←`、`→` 会按标签实际所在的行和列移动。焦点位于最下面一排标签时，再按 `↓` 会进入文件树。

### 上下文菜单

文件菜单提供：打开、在新标签页打开、重命名、移动、删除等操作。

文件夹菜单提供：新建笔记、新建子文件夹、新建白板、新建数据库、移动等操作。

插件默认触发 Obsidian 的 `file-menu` 扩展事件，因此其他插件加入的标准文件菜单项也会出现在这里，例如“在访达中显示”。如需精简菜单，可在“高级”设置中关闭“显示扩展菜单项”；关闭后仍保留本插件自带操作。菜单打开后同样支持输入字母/数字筛选、方向键移动和 `Enter` 执行。

新建笔记、子文件夹、白板、数据库和重命名时，会在输入过程中实时检查目标目录是否已有同名文件或文件夹。出现冲突会立即提示并禁用确认按钮。

## 设置说明

设置页按 **导航**、**显示**、**高级** 三个 Tab 分类。

| 设置 | 作用 |
| --- | --- |
| 一级目录置顶展示 | 将一级目录切换为视图顶部的标签区域 |
| 顶部默认展示行数 | 限制顶部标签默认显示的行数，超出后可展开 |
| 显示条目元信息 | 显示文件夹子项数量和文件类型缩写 |
| 一级目录名称字号 | 调整左侧模式下一级目录的字号 |
| 文件树文件名字号 | 同时调整文件树中的目录和文件字号；顶部模式下也控制一级目录标签 |
| 文件树名称左对齐 | 文件不显示图标时保留图标位置，使其与文件夹名对齐 |
| 文件夹笔记优先显示 | 将同名文件夹笔记置顶并使用书签图标 |
| 隐藏文件后缀名 | 只隐藏显示名称的后缀，不影响类型缩写设置 |
| 隐藏规则 | 按 Glob 规则隐藏文件和目录 |
| 文件列最小/最大宽度 | 限制拖拽文件列时的宽度范围 |
| 文件夹图标 / 文件图标 | 分别控制文件夹、文件的图标样式 |
| 添加自定义目录 | 添加非一级目录到导航区域，并可设置显示名称 |
| 显示扩展菜单项 | 控制是否显示由 Obsidian 或其他插件通过 `file-menu` 添加的右键菜单项 |

## 隐私与数据

- 不访问网络。
- 不收集或上传任何笔记、文件名、使用行为或个人数据。
- 只通过 Obsidian API 读取并在需要时执行你主动触发的本地文件操作。
- 隐藏、排序、布局、宽度和导航配置保存在当前仓库的插件数据中。

## 开发

```bash
npm install
npm run build
```

构建后的 `main.js`、`manifest.json` 和 `styles.css` 可直接用于本地安装或作为 GitHub Release 附件。

## 发布前检查

社区市场要求仓库根目录包含用途与使用方式清晰的 `README.md`、`LICENSE` 和有效的 `manifest.json`；发布版本时，GitHub Release 的标签必须与 `manifest.json` 的版本一致，并附带 `main.js`、`manifest.json` 和 `styles.css`。详情见 [Obsidian 官方提交指南](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)。

当前仓库在提交前还需要补齐：

- `manifest.json` 中的 `author`（官方必填）。
- 开源许可证文件 `LICENSE`。
- 面向社区市场的最终英文展示名称与描述确认。

---

# English

## What it does

Folder Column Navigator adds a Finder-style multi-column navigator to Obsidian. Choose a top-level folder from a left-side list or from top tags, then browse each folder level in its own column while preserving context.

## Key features

- Left-side root-folder navigation or top-level folder tags.
- Finder-style multi-column folder browsing with resizable columns.
- Single-click file opening while keeping keyboard focus in the navigator.
- Name, modified-time, and created-time sorting in ascending or descending order.
- Pinyin-aware filtering for English, numbers, Chinese text, pinyin initials, full pinyin, and mixed pinyin.
- Configurable item metadata, icons, font sizes, folder-note priority, extension visibility, and Glob-based hiding.
- Keyboard navigation and filterable context menus for files and folders.
- Immediate duplicate-name validation when creating or renaming files and folders.

## Quick use

Open **Folder Column Navigator** from the ribbon or command palette. Click a folder to open its child column; click a file to open it. Use arrow keys to move, `Enter` to open, `Space` for the context menu, and type to filter the focused area.

## Privacy

The plugin has no network access, telemetry, or data collection. It operates only on files in the current vault through the Obsidian API.

## Third-party software

The release bundle includes [pinyin-pro](https://www.npmjs.com/package/pinyin-pro) for pinyin-aware filtering. It is licensed under MIT. Build-time dependencies are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); they are not bundled with the plugin release.
