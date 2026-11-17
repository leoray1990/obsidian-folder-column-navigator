import data2025 from "./data/holidays/2025.json";
import data2026 from "./data/holidays/2026.json";
import data2027 from "./data/holidays/2027.json";

export interface HolidayDay { date: string; name: string; isOffDay: boolean }
export interface CalendarHolidayDay extends HolidayDay { isWeekend?: boolean; unknownSchedule?: boolean }
export interface HolidayYear { year: number; papers: string[]; days: HolidayDay[] }
export interface HolidayCacheEntry { data: HolidayYear; updatedAt: string }
export type HolidayCache = Record<string, HolidayCacheEntry>;
export const HOLIDAY_DATA_URL = "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/";
export const BUILTIN_HOLIDAY_YEARS = [2025, 2026, 2027];

/** Use local civil dates, not UTC: DST and time-zone offsets must not shift a day. */
export function holidayDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function validDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    return holidayDateKey(new Date(year, month - 1, day)) === value;
}

/** Reject partial, malformed and unexpectedly large responses before replacing a cache. */
export function validateHolidayYear(value: unknown, expectedYear: number): HolidayYear {
    const data = value as Partial<HolidayYear> | null;
    if (!data || data.year !== expectedYear || !Number.isInteger(expectedYear) || expectedYear < 2000 || expectedYear > 2200 ||
        !Array.isArray(data.papers) || data.papers.length === 0 || data.papers.length > 30 ||
        !data.papers.every(paper => typeof paper === "string" && /^https:\/\/(?:www\.)?gov\.cn\//.test(paper)) ||
        !Array.isArray(data.days) || data.days.length < 10 || data.days.length > 400) throw new Error("节假日数据格式不完整或年份不符。");
    const dates = new Set<string>();
    for (const day of data.days) {
        if (!day || !validDate(day.date) || Math.abs(Number(day.date.slice(0, 4)) - expectedYear) > 1 ||
            typeof day.name !== "string" || !day.name.trim() || day.name.length > 40 ||
            typeof day.isOffDay !== "boolean" || dates.has(day.date)) throw new Error("节假日数据包含无效或重复日期。");
        dates.add(day.date);
    }
    return { year: expectedYear, papers: [...data.papers], days: data.days.map(day => ({ date: day.date, name: day.name, isOffDay: day.isOffDay })) };
}

export function cleanHolidayCache(value: unknown): HolidayCache {
    const cache: HolidayCache = {};
    if (!value || typeof value !== "object") return cache;
    for (const [year, entry] of Object.entries(value).slice(-30)) {
        try {
            const item = entry as HolidayCacheEntry;
            if (typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) continue;
            cache[year] = { data: validateHolidayYear(item.data, Number(year)), updatedAt: item.updatedAt };
        } catch { /* A corrupt persisted year must not disable other offline years. */ }
    }
    return cache;
}

/** Announcement-year ordering deliberately lets next year's New Year override December. */
export class MainlandHolidayCalendar {
    private readonly years = new Set<number>();
    private readonly days = new Map<string, HolidayDay>();
    constructor(cache: HolidayCache = {}) {
        const source = new Map<number, HolidayYear>([data2025, data2026, data2027].map(data => [data.year, data]));
        for (const entry of Object.values(cleanHolidayCache(cache))) source.set(entry.data.year, entry.data);
        for (const data of [...source.values()].sort((a, b) => a.year - b.year)) {
            this.years.add(data.year);
            data.days.forEach(day => this.days.set(day.date, day));
        }
    }
    get availableYears(): number[] { return [...this.years].sort((a, b) => a - b); }
    get(dateKey: string): HolidayDay | undefined { return this.days.get(dateKey); }
    /** Display fallback only: official rest/work overrides always win over
     * ordinary weekends. Missing-year weekends remain explicitly provisional;
     * workday-based note creation still requires a known annual schedule. */
    getCalendarDay(dateKey: string): CalendarHolidayDay | undefined {
        const official = this.get(dateKey);
        if (official) return official;
        if (!validDate(dateKey)) return undefined;
        const [year, month, day] = dateKey.split("-").map(Number);
        const weekday = new Date(year, month - 1, day).getDay();
        if (weekday !== 0 && weekday !== 6) return undefined;
        return { date: dateKey, name: "周末", isOffDay: true, isWeekend: true, unknownSchedule: !this.years.has(year) };
    }
    isWorkday(date: Date): boolean {
        const day = this.days.get(holidayDateKey(date));
        if (day) return !day.isOffDay;
        if (!this.years.has(date.getFullYear())) throw new Error(`${date.getFullYear()} 年节假日数据尚未收录，请联网更新该年数据后重试。`);
        return date.getDay() !== 0 && date.getDay() !== 6;
    }
    /** Validate the entire Monday–Sunday week before selecting a day; an unknown
     * weekend could be an adjusted working day, so never silently skip it. */
    lastWorkdayOfWeek(date: Date): Date {
        const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
        let last: Date | undefined;
        for (let offset = 0; offset < 7; offset++) {
            const current = new Date(monday); current.setDate(current.getDate() + offset);
            if (this.isWorkday(current)) last = current;
        }
        if (!last) throw new Error("所选日期所在周没有工作日，请改用其他日期积木。");
        return last;
    }
}

/** Optional network transport is injected. No request is made on startup or
 * calendar navigation; only the explicitly enabled update button calls this. */
export async function fetchHolidayYear(year: number, allowed: boolean,
    fetchJson: (url: string) => Promise<unknown>): Promise<HolidayYear> {
    if (!allowed) throw new Error("请先开启允许联网更新。");
    if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error("请输入 2000–2200 之间的年份。");
    return validateHolidayYear(await fetchJson(`${HOLIDAY_DATA_URL}${year}.json`), year);
}
