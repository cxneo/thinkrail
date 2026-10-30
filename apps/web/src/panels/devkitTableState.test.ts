import { describe, expect, test } from "bun:test";
import type { DevkitTask } from "@thinkrail/contracts";
import {
	applyDevkitTaskView,
	columnCompare,
	defaultDevkitTablePrefs,
	devkitStatusOptions,
	hasActiveDevkitFilter,
	nextDevkitSort,
	reorderDevkitColumns,
} from "./devkitTableState";

const task = (overrides: Partial<DevkitTask> & Pick<DevkitTask, "code" | "title">): DevkitTask => ({
	id: overrides.code,
	platform: "eagle",
	itemType: "缺陷",
	status: "处理中",
	priority: "P2",
	...overrides,
});

const tasks: DevkitTask[] = [
	task({ code: "BUG-1", title: "IMU状态不一致排查", status: "处理中", priority: "P1" }),
	task({ code: "BUG-2", title: "板卡固件升级失败", status: "已解决", priority: "P2" }),
	task({ code: "BUG-3", title: "手簿软件显示异常", status: "待处理", priority: "P3" }),
];

describe("devkit task view", () => {
	test("no filter and no sort keeps the arrival order", () => {
		const prefs = defaultDevkitTablePrefs("eagle");
		expect(applyDevkitTaskView(tasks, prefs).map((t) => t.code)).toEqual([
			"BUG-1",
			"BUG-2",
			"BUG-3",
		]);
	});

	test("status filter selects only the chosen statuses", () => {
		const prefs = { ...defaultDevkitTablePrefs("eagle"), statusFilter: ["处理中"] };
		expect(applyDevkitTaskView(tasks, prefs).map((t) => t.code)).toEqual(["BUG-1"]);
	});

	test("search matches code and title, case-insensitively", () => {
		const byCode = { ...defaultDevkitTablePrefs("eagle"), search: "bug-2" };
		expect(applyDevkitTaskView(tasks, byCode).map((t) => t.code)).toEqual(["BUG-2"]);
		const byTitle = { ...defaultDevkitTablePrefs("eagle"), search: "IMU" };
		expect(applyDevkitTaskView(tasks, byTitle).map((t) => t.code)).toEqual(["BUG-1"]);
		const none = { ...defaultDevkitTablePrefs("eagle"), search: "不存在" };
		expect(applyDevkitTaskView(tasks, none)).toEqual([]);
	});

	test("sort cycles asc → desc → none per column", () => {
		expect(nextDevkitSort(null, "code")).toEqual({ column: "code", dir: "asc" });
		expect(nextDevkitSort({ column: "code", dir: "asc" }, "code")).toEqual({
			column: "code",
			dir: "desc",
		});
		expect(nextDevkitSort({ column: "code", dir: "desc" }, "code")).toBeNull();
		expect(nextDevkitSort({ column: "code", dir: "asc" }, "title")).toEqual({
			column: "title",
			dir: "asc",
		});
	});

	test("priority sort ranks P-numbers numerically", () => {
		const ranked = [...tasks].sort((left, right) => columnCompare("priority", left, right));
		expect(ranked.map((t) => t.priority)).toEqual(["P1", "P2", "P3"]);
		const withTen = [
			task({ code: "BUG-10", title: "x", priority: "P10" }),
			task({ code: "BUG-2", title: "x", priority: "P2" }),
		];
		expect(
			[...withTen]
				.sort((left, right) => columnCompare("priority", left, right))
				.map((t) => t.priority),
		).toEqual(["P2", "P10"]);
	});

	test("desc sort reverses the ascending order", () => {
		const asc = {
			...defaultDevkitTablePrefs("eagle"),
			sort: { column: "code", dir: "asc" as const },
		};
		const desc = {
			...defaultDevkitTablePrefs("eagle"),
			sort: { column: "code", dir: "desc" as const },
		};
		expect(applyDevkitTaskView(tasks, asc).map((t) => t.code)).toEqual(["BUG-1", "BUG-2", "BUG-3"]);
		expect(applyDevkitTaskView(tasks, desc).map((t) => t.code)).toEqual([
			"BUG-3",
			"BUG-2",
			"BUG-1",
		]);
	});

	test("filter and sort combine", () => {
		const prefs = {
			...defaultDevkitTablePrefs("eagle"),
			statusFilter: [],
			search: "BUG",
			sort: { column: "priority", dir: "desc" as const },
		};
		expect(applyDevkitTaskView(tasks, prefs).map((t) => t.priority)).toEqual(["P3", "P2", "P1"]);
	});

	test("active filter detection covers status and search", () => {
		expect(hasActiveDevkitFilter(defaultDevkitTablePrefs("eagle"))).toBeFalse();
		expect(
			hasActiveDevkitFilter({ ...defaultDevkitTablePrefs("eagle"), statusFilter: ["已解决"] }),
		).toBeTrue();
		expect(
			hasActiveDevkitFilter({ ...defaultDevkitTablePrefs("eagle"), search: "  " }),
		).toBeFalse();
		expect(
			hasActiveDevkitFilter({ ...defaultDevkitTablePrefs("eagle"), search: "imU" }),
		).toBeTrue();
	});

	test("status options are unique, non-empty, and sorted", () => {
		expect(devkitStatusOptions(tasks)).toEqual(
			["处理中", "已解决", "待处理"].sort((a, b) => a.localeCompare(b)),
		);
		expect(
			[...devkitStatusOptions(tasks)].every(
				(value, index, all) => index === 0 || all[index - 1] <= value,
			),
		).toBeTrue();
		expect(devkitStatusOptions([...tasks, task({ code: "B4", title: "d" })])).toHaveLength(3);
	});

	test("column reorder moves a column and rejects bad indexes", () => {
		expect(reorderDevkitColumns(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
		expect(reorderDevkitColumns(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
		expect(reorderDevkitColumns(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
		expect(reorderDevkitColumns(["a", "b", "c"], -1, 0)).toEqual(["a", "b", "c"]);
		expect(reorderDevkitColumns(["a", "b", "c"], 0, 3)).toEqual(["a", "b", "c"]);
	});
});
