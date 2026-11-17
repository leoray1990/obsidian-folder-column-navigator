/** Only visible rows plus a small overscan window exist in the DOM. A measured
 * fixed row height is appropriate here: calendar names/paths are single-line. */
export class CalendarVirtualList<T> {
    private root: HTMLElement;
    private top: HTMLElement;
    private window: HTMLElement;
    private bottom: HTMLElement;
    private rowHeight = 48;
    private frame: number | null = null;
    private observer: ResizeObserver;
    private start = -1;
    private end = -1;
    private measured = false;
    private disposed = false;
    constructor(private host: HTMLElement, private files: readonly T[], private renderRow: (file: T, parent: HTMLElement) => HTMLElement) {
        this.root = host.createDiv("fcn-calendar-virtual-list");
        this.top = this.root.createDiv("fcn-calendar-virtual-spacer");
        this.window = this.root.createDiv("fcn-calendar-virtual-window");
        this.bottom = this.root.createDiv("fcn-calendar-virtual-spacer");
        host.addEventListener("scroll", this.schedule, { passive: true });
        host.addEventListener("keydown", this.keydown);
        this.observer = new ResizeObserver(this.schedule); this.observer.observe(host);
        this.render();
    }
    private schedule = (): void => {
        if (this.disposed || this.frame !== null) return;
        this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); });
    };
    private render(force = false): void {
        if (this.disposed) return;
        const origin = this.root.getBoundingClientRect().top - this.host.getBoundingClientRect().top + this.host.scrollTop;
        const start = Math.max(0, Math.min(this.files.length, Math.floor((this.host.scrollTop - origin) / this.rowHeight) - 8));
        const count = Math.min(120, Math.max(24, Math.ceil(this.host.clientHeight / this.rowHeight) + 16));
        const end = Math.min(this.files.length, start + count);
        if (!force && this.measured && start === this.start && end === this.end) return;
        this.start = start; this.end = end; this.window.empty();
        for (let index = start; index < end; index++) {
            const row = this.renderRow(this.files[index], this.window);
            row.addClass("fcn-calendar-virtual-row"); row.dataset.fcnVirtualIndex = String(index);
            row.setAttribute("aria-posinset", String(index + 1)); row.setAttribute("aria-setsize", String(this.files.length));
        }
        if (!this.measured && this.window.firstElementChild) {
            const height = this.window.firstElementChild.getBoundingClientRect().height;
            if (height > 0) {
                this.rowHeight = Math.ceil(height); this.measured = true;
                this.root.setCssProps({ "--fcn-calendar-virtual-row-height": `${this.rowHeight}px` });
            }
        }
        this.top.setCssProps({ "--fcn-calendar-virtual-space": `${start * this.rowHeight}px` });
        this.bottom.setCssProps({ "--fcn-calendar-virtual-space": `${(this.files.length - end) * this.rowHeight}px` });
    }
    private keydown = (event: KeyboardEvent): void => {
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-fcn-virtual-index]");
        if (!row || !this.root.contains(row)) return;
        const index = Number(row.dataset.fcnVirtualIndex);
        const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 :
            event.key === "Home" ? 0 : event.key === "End" ? this.files.length - 1 : null;
        if (next === null || next < 0 || next >= this.files.length) return;
        event.preventDefault(); event.stopPropagation();
        const origin = this.root.getBoundingClientRect().top - this.host.getBoundingClientRect().top + this.host.scrollTop;
        const top = origin + next * this.rowHeight;
        if (top < this.host.scrollTop) this.host.scrollTop = top;
        else if (top + this.rowHeight > this.host.scrollTop + this.host.clientHeight) this.host.scrollTop = top + this.rowHeight - this.host.clientHeight;
        this.render(true);
        this.window.querySelector<HTMLElement>(`[data-fcn-virtual-index="${next}"]`)?.focus({ preventScroll: true });
    };
    refresh(): void { this.render(true); }
    dispose(): void {
        this.disposed = true; this.observer.disconnect();
        this.host.removeEventListener("scroll", this.schedule); this.host.removeEventListener("keydown", this.keydown);
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.root.remove();
    }
}
