import type { DevkitPlatform, DevkitTask } from "@thinkrail/contracts";

export type DevkitColumnId = "code" | "itemType" | "status" | "title" | "priority";

export type DevkitTableSort = {
	column: DevkitColumnId;
	dir: "asc" | "desc";
};

export interface DevkitTablePrefs {
	/** Column order for this platform (its own column set only). */
	columns: DevkitColumnId[];
	/** Wrap long cell text instead of truncating. */
	wrap: boolean;
	/** Selected statuses; empty = all. */
	statusFilter: string[];
	/** Case-insensitive substring match over code and title. */
	search: string;
	sort: DevkitTableSort | null;
}

type TaskPlatform = Extract<DevkitPlatform, "eagle" | "pingcode">;

const COLUMNS: Record<TaskPlatform, DevkitColumnId[]> = {
	eagle: ["code", "itemType", "status", "title", "priority"],
	pingcode: ["code", "itemType", "status", "title"],
};

export function platformColumns(platform: TaskPlatform): DevkitColumnId[] {
	return [...COLUMNS[platform]];
}

const ALL_COLUMNS: readonly DevkitColumnId[] = ["code", "itemType", "status", "title", "priority"];

export function isDevkitColumnId(value: unknown): value is DevkitColumnId {
	return typeof value === "string" && ALL_COLUMNS.includes(value as DevkitColumnId);
}

const PREFS_KEY = (platform: string) => `thinkrail:devkit-table:${platform}`;

export function defaultDevkitTablePrefs(platform: TaskPlatform): DevkitTablePrefs {
	return {
		columns: platformColumns(platform),
		wrap: false,
		statusFilter: [],
		search: "",
		sort: null,
	};
}

/** Load and sanitize persisted prefs: unknown columns dropped, missing columns
 * appended, sort validated against the platform's column set. */
export function loadDevkitTablePrefs(platform: TaskPlatform): DevkitTablePrefs {
	const fallback = defaultDevkitTablePrefs(platform);
	try {
		const raw = JSON.parse(
			localStorage.getItem(PREFS_KEY(platform)) ?? "null",
		) as Partial<DevkitTablePrefs> | null;
		if (!raw || typeof raw !== "object") return fallback;
		const allowed = new Set(COLUMNS[platform]);
		const stored = Array.isArray(raw.columns)
			? raw.columns.filter(isDevkitColumnId).filter((column) => allowed.has(column))
			: [];
		const columns = [...stored, ...COLUMNS[platform].filter((column) => !stored.includes(column))];
		const sort =
			raw.sort &&
			isDevkitColumnId(raw.sort.column) &&
			allowed.has(raw.sort.column) &&
			(raw.sort.dir === "asc" || raw.sort.dir === "desc")
				? { column: raw.sort.column, dir: raw.sort.dir }
				: null;
		return {
			columns,
			wrap: raw.wrap === true,
			statusFilter: Array.isArray(raw.statusFilter)
				? raw.statusFilter.filter((value): value is string => typeof value === "string")
				: [],
			search: typeof raw.search === "string" ? raw.search : "",
			sort,
		};
	} catch {
		return fallback;
	}
}

export function saveDevkitTablePrefs(platform: TaskPlatform, prefs: DevkitTablePrefs): void {
	try {
		localStorage.setItem(PREFS_KEY(platform), JSON.stringify(prefs));
	} catch {
		// storage unavailable — view state only, degrade silently
	}
}

export function columnCompare(column: DevkitColumnId, left: DevkitTask, right: DevkitTask): number {
	const value = (task: DevkitTask): string => {
		switch (column) {
			case "code":
				return task.code;
			case "itemType":
				return task.itemType;
			case "status":
				return task.status;
			case "title":
				return task.title;
			case "priority":
				return task.priority ?? "";
		}
	};
	if (column === "priority") {
		const rank = (task: DevkitTask): number => {
			const match = /^P(\d+)/i.exec(task.priority ?? "");
			return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
		};
		const byRank = rank(left) - rank(right);
		if (byRank !== 0) return byRank;
	}
	return value(left).localeCompare(value(right));
}

/** Filter + sort the cached tasks into the view order. Pure. */
export function applyDevkitTaskView(
	tasks: readonly DevkitTask[],
	prefs: DevkitTablePrefs,
): DevkitTask[] {
	const search = prefs.search.trim().toLowerCase();
	const filtered = tasks.filter((task) => {
		if (prefs.statusFilter.length > 0 && !prefs.statusFilter.includes(task.status)) return false;
		if (search.length === 0) return true;
		return task.code.toLowerCase().includes(search) || task.title.toLowerCase().includes(search);
	});
	if (!prefs.sort) return filtered;
	const { column, dir } = prefs.sort;
	return [...filtered].sort((left, right) => {
		const compared = columnCompare(column, left, right);
		return dir === "asc" ? compared : -compared;
	});
}

export function hasActiveDevkitFilter(prefs: DevkitTablePrefs): boolean {
	return prefs.statusFilter.length > 0 || prefs.search.trim().length > 0;
}

/** Unique status values in the data, display-sorted. */
export function devkitStatusOptions(tasks: readonly DevkitTask[]): string[] {
	return [...new Set(tasks.map((task) => task.status).filter((status) => status.length > 0))].sort(
		(a, b) => a.localeCompare(b),
	);
}

/** Click-cycle: none → asc → desc → none for the clicked column. */
export function nextDevkitSort(
	current: DevkitTableSort | null,
	column: DevkitColumnId,
): DevkitTableSort | null {
	if (!current || current.column !== column) return { column, dir: "asc" };
	if (current.dir === "asc") return { column, dir: "desc" };
	return null;
}

/** Move `from` to `to` within the platform's column order. */
export function reorderDevkitColumns(
	columns: DevkitColumnId[],
	from: number,
	to: number,
): DevkitColumnId[] {
	if (from === to || from < 0 || to < 0 || from >= columns.length || to >= columns.length)
		return columns;
	const next = [...columns];
	const [moved] = next.splice(from, 1);
	if (moved === undefined) return columns;
	next.splice(to, 0, moved);
	return next;
}
