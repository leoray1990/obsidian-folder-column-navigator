/** Shared, lazy, in-memory date index. No vault or note content is persisted.
 * Work is budgeted across tasks, including sorting very large date buckets. */
export class CalendarFileIndex<T extends { path: string }> {
    private dates = new Map<string, { files: Map<string, T>; stamp: number; sorted?: T[]; sorting?: Promise<T[]> }>();
    private fileDates = new Map<string, Set<string>>();
    private changes = new Map<string, T | null>();
    private removals = new Set<string>();
    private initialized = false;
    private epoch = 0;
    private disposed = false;
    private job: Promise<void> | null = null;
    private rangeCache = new Map<string, Map<string, T[]>>();
    version = 0;
    constructor(private enumerate: () => Iterable<T>, private match: (file: T) => Iterable<string>,
        private compare: (a: T, b: T) => number,
        private pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0))) {}

    reset(match: (file: T) => Iterable<string>): void {
        this.epoch++; this.version++; this.match = match; this.initialized = false; this.job = null;
        this.dates.clear(); this.fileDates.clear(); this.changes.clear(); this.removals.clear(); this.rangeCache.clear();
    }
    update(file: T, oldPath?: string): void {
        if (this.disposed) return;
        if (oldPath && oldPath !== file.path) this.changes.set(oldPath, null);
        this.changes.set(file.path, file); this.version++; this.rangeCache.clear();
    }
    remove(path: string, recursive = false): void {
        if (this.disposed) return;
        if (recursive) {
            this.removals.add(path);
            for (const key of this.changes.keys()) if (key.startsWith(`${path}/`)) this.changes.delete(key);
        }
        this.changes.set(path, null); this.version++; this.rangeCache.clear();
    }
    dispose(): void {
        this.disposed = true; this.epoch++; this.job = null;
        this.dates.clear(); this.fileDates.clear(); this.changes.clear(); this.removals.clear(); this.rangeCache.clear();
    }
    private drop(path: string): void {
        for (const key of this.fileDates.get(path) ?? []) {
            const bucket = this.dates.get(key);
            if (bucket) {
                bucket.files.delete(path); bucket.stamp++; bucket.sorted = undefined; bucket.sorting = undefined;
                if (!bucket.files.size) this.dates.delete(key);
            }
        }
        this.fileDates.delete(path);
    }
    private put(file: T): void {
        this.drop(file.path);
        const keys = new Set(this.match(file));
        if (!keys.size) return;
        this.fileDates.set(file.path, keys);
        for (const key of keys) {
            let bucket = this.dates.get(key);
            if (!bucket) { bucket = { files: new Map(), stamp: 0 }; this.dates.set(key, bucket); }
            bucket.files.set(file.path, file); bucket.stamp++; bucket.sorted = undefined; bucket.sorting = undefined;
        }
    }
    private async build(epoch: number): Promise<void> {
        let deadline = Date.now() + 6, count = 0;
        const yieldWork = async (): Promise<void> => {
            if (++count % 128 === 0 && Date.now() >= deadline) { await this.pause(); deadline = Date.now() + 6; }
            if (this.disposed || epoch !== this.epoch) throw new Error("Calendar index cancelled");
        };
        // Yield even for small vaults so the loading state can paint first.
        await this.pause();
        if (this.disposed || epoch !== this.epoch) throw new Error("Calendar index cancelled");
        if (!this.initialized) {
            for (const file of this.enumerate()) { this.put(file); await yieldWork(); }
            this.initialized = true;
        }
        while (this.removals.size || this.changes.size) {
            const prefixes = [...this.removals]; this.removals.clear();
            if (prefixes.length) for (const path of this.fileDates.keys()) {
                if (prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) this.drop(path);
                await yieldWork();
            }
            const changes = this.changes; this.changes = new Map();
            for (const [path, file] of changes) {
                // Renames mutate TFile.path in place. Never resurrect an obsolete
                // queued path after its object has moved again.
                if (file && file.path === path) this.put(file); else this.drop(path);
                await yieldWork();
            }
        }
    }
    private async ensure(): Promise<void> {
        if (this.disposed) throw new Error("Calendar index disposed");
        if (this.initialized && !this.changes.size && !this.removals.size && !this.job) return;
        if (!this.job) {
            const epoch = this.epoch;
            const job = this.build(epoch);
            this.job = job;
            void job.finally(() => { if (this.job === job) this.job = null; }).catch(() => {});
        }
        await this.job;
        if (this.changes.size || this.removals.size) await this.ensure();
    }
    private async sort(files: Iterable<T>, epoch: number): Promise<T[]> {
        let deadline = Date.now() + 6, operations = 0;
        const check = async (): Promise<void> => {
            if (++operations % 256 === 0 && Date.now() >= deadline) { await this.pause(); deadline = Date.now() + 6; }
            if (this.disposed || epoch !== this.epoch) throw new Error("Calendar index cancelled");
        };
        // Small native sorts plus cooperative merges avoid a single enormous
        // Array.sort call monopolizing the renderer for a busy import date.
        let chunks: T[][] = [], chunk: T[] = [];
        for (const file of files) {
            chunk.push(file);
            if (chunk.length === 256) { chunks.push(chunk.sort(this.compare)); chunk = []; }
            await check();
        }
        if (chunk.length) chunks.push(chunk.sort(this.compare));
        while (chunks.length > 1) {
            const next: T[][] = [];
            for (let i = 0; i < chunks.length; i += 2) {
                const a = chunks[i], b = chunks[i + 1];
                if (!b) { next.push(a); continue; }
                const merged: T[] = []; let x = 0, y = 0;
                while (x < a.length || y < b.length) {
                    merged.push(y === b.length || (x < a.length && this.compare(a[x], b[y]) <= 0) ? a[x++] : b[y++]);
                    await check();
                }
                next.push(merged);
            }
            chunks = next;
        }
        return chunks[0] ?? [];
    }
    async query(start: string, end: string): Promise<Map<string, T[]>> {
        retry: for (;;) {
            const epoch = this.epoch, version = this.version;
            try {
                await this.ensure();
                const key = `${start}/${end}`;
                const cached = this.rangeCache.get(key);
                if (cached) return cached;
                const result = new Map<string, T[]>();
                for (const [date, bucket] of this.dates) if (date >= start && date < end) {
                    const stamp = bucket.stamp;
                    if (!bucket.sorted) {
                        if (!bucket.sorting) {
                            const sorting = this.sort(bucket.files.values(), epoch);
                            bucket.sorting = sorting;
                            void sorting.finally(() => { if (bucket.sorting === sorting) bucket.sorting = undefined; }).catch(() => {});
                        }
                        const sorted = await bucket.sorting;
                        // Another view may have flushed file changes while this
                        // cooperative sort yielded. Never cache its old result.
                        if (stamp !== bucket.stamp) continue retry;
                        bucket.sorted = sorted;
                    }
                    result.set(date, bucket.sorted);
                }
                if (version !== this.version || epoch !== this.epoch) continue;
                // Bound range snapshots; sorted date buckets are shared between
                // month/week/year queries and between multiple calendar views.
                if (this.rangeCache.size >= 16) this.rangeCache.delete(this.rangeCache.keys().next().value!);
                this.rangeCache.set(key, result); return result;
            } catch (error) { if (this.disposed || epoch === this.epoch) throw error; }
        }
    }
}
