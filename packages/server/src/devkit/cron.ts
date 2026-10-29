import { isValidDevkitCron } from "@thinkrail/contracts";

/** 5-field cron: [minute, hour, day-of-month, month, day-of-week (0/7=Sunday)]. */
type ParsedCron = {
	values: Array<ReadonlySet<number>>;
	steps: number[];
	baseLows: number[];
	domRestricted: boolean;
	dowRestricted: boolean;
};

const FIELD_MAX = [59, 23, 31, 12, 7] as const;
const FIELD_MIN = [0, 0, 1, 1, 0] as const;

function parseField(raw: string, fieldIndex: number): { values: Set<number>; step: number } | null {
	const min = FIELD_MIN[fieldIndex] ?? 0;
	const max = FIELD_MAX[fieldIndex] ?? 59;
	const slash = raw.indexOf("/");
	let step = 1;
	if (slash >= 0) {
		const stepText = raw.slice(slash + 1);
		if (!/^\d+$/.test(stepText)) return null;
		step = Number(stepText);
		if (step < 1) return null;
	}
	const base = slash >= 0 ? raw.slice(0, slash) : raw;
	const values = new Set<number>();
	if (base === "*") {
		for (let v = min; v <= max; v += 1) values.add(v);
	} else {
		for (const part of base.split(",")) {
			const range = part.split("-");
			if (range.length > 2) return null;
			if (!/^\d+$/.test(range[0] ?? "")) return null;
			const low = Number(range[0]);
			const high = range.length === 2 ? Number(range[1]) : low;
			if (range.length === 2 && !/^\d+$/.test(range[1] ?? "")) return null;
			if (low < min || high > max || low > high) return null;
			for (let v = low; v <= high; v += 1) values.add(v);
		}
	}
	if (values.size === 0) return null;
	return { values, step };
}

/** Parse a 5-field cron expression, or null when invalid ("off" included). */
export function parseDevkitCron(value: string): ParsedCron | null {
	if (value === "off" || !isValidDevkitCron(value)) return null;
	const fields = value.trim().split(/\s+/);
	const parsed: ParsedCron = {
		values: [],
		steps: [],
		baseLows: [],
		domRestricted: false,
		dowRestricted: false,
	};
	for (let index = 0; index < 5; index += 1) {
		let raw = fields[index] ?? "";
		if (index === 4) raw = raw.replace(/^7$/, "0");
		const field = parseField(raw, index);
		if (!field) return null;
		const sorted = [...field.values];
		parsed.values.push(field.values);
		parsed.steps.push(field.step);
		parsed.baseLows.push(sorted[0] ?? 0);
	}
	const domRaw = fields[2] ?? "";
	const dowRaw = fields[4] ?? "";
	parsed.domRestricted = domRaw !== "*";
	parsed.dowRestricted = dowRaw !== "*" && dowRaw !== "7";
	return parsed;
}

function fieldMatches(parsed: ParsedCron, fieldIndex: number, value: number): boolean {
	const values = parsed.values[fieldIndex];
	if (!values) return false;
	if (!values.has(value)) return false;
	return (value - (parsed.baseLows[fieldIndex] ?? 0)) % (parsed.steps[fieldIndex] ?? 1) === 0;
}

function minuteMatches(parsed: ParsedCron, minuteIndex: number): boolean {
	const date = new Date(minuteIndex * 60_000);
	if (!fieldMatches(parsed, 0, date.getMinutes())) return false;
	if (!fieldMatches(parsed, 1, date.getHours())) return false;
	if (!fieldMatches(parsed, 3, date.getMonth() + 1)) return false;
	const domMatch = fieldMatches(parsed, 2, date.getDate());
	const dowMatch = fieldMatches(parsed, 4, date.getDay());
	if (parsed.domRestricted && parsed.dowRestricted) return domMatch || dowMatch;
	return domMatch && dowMatch;
}

/** Does the expression fire during the minute containing `at` (ms epoch)? */
export function cronMatches(cron: string, at: number): boolean {
	const parsed = parseDevkitCron(cron);
	if (!parsed) return false;
	return minuteMatches(parsed, Math.floor(at / 60_000));
}

/** The next firing minute (ms epoch, strictly after `from`), or null. */
export function nextCronRunMs(cron: string, from: number): number | null {
	const parsed = parseDevkitCron(cron);
	if (!parsed) return null;
	let minuteIndex = Math.floor(from / 60_000) + 1;
	// Every expressible cron fires within 400 years of minutes; bail far earlier.
	for (let i = 0; i < 500_000; i += 1) {
		if (minuteMatches(parsed, minuteIndex)) return minuteIndex * 60_000;
		minuteIndex += 1;
	}
	return null;
}
