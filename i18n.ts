import { getLanguage } from "obsidian";
import { en, enSingular } from "./locales/en";

export type InterfaceLanguage = "zh" | "en";

/** Obsidian owns the language preference. Unsupported UI languages use English;
 * no plugin preference or vault data is rewritten when that preference changes. */
export function resolveLanguage(code: string): InterfaceLanguage {
    return /^zh(?:[-_]|$)/i.test(code) ? "zh" : "en";
}

export function interfaceLanguage(): InterfaceLanguage {
    return resolveLanguage(getLanguage());
}

/** Chinese source keys double as the Chinese catalog. Parameters are substituted
 * once (never recursively), so user names containing braces remain literal. */
export function t(key: string, values: readonly unknown[] = []): string {
    // Unknown holiday names can come from downloaded data. Only own catalog
    // entries count as translations, never inherited object properties.
    const singular = Object.prototype.hasOwnProperty.call(enSingular, key) ? enSingular[key] : undefined;
    const english = Object.prototype.hasOwnProperty.call(en, key) ? en[key] : key;
    const text = interfaceLanguage() === "zh" ? key
        : singular && values[singular.countIndex] === 1 ? singular.text : english;
    return text.replace(/\{(\d+)\}/g, (token: string, index: string) =>
        Number(index) < values.length ? String(values[Number(index)] ?? "") : token);
}

export function calendarLocale(): string {
    return interfaceLanguage() === "zh" ? "zh-CN" : "en-US";
}

export function calendarWeekday(date: Date): string {
    return interfaceLanguage() === "zh"
        ? ["日", "一", "二", "三", "四", "五", "六"][date.getDay()]
        : new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
}

export function calendarMonth(date: Date, includeYear = false): string {
    return new Intl.DateTimeFormat(calendarLocale(), {
        month: includeYear ? "long" : "short", ...(includeYear ? { year: "numeric" } : {})
    }).format(date);
}
