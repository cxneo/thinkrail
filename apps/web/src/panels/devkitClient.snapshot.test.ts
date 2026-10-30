import { describe, expect, test } from "bun:test";
// 快照语义回归：模拟 useSyncExternalStore 的 Object.is 判定
import {
	devkitDraft,
	devkitSaveFeedback,
	devkitStore,
	discardDevkitDraft,
	isDevkitEditing,
	markDevkitSave,
	setDevkitEditing,
	updateDevkitDraft,
} from "./devkitClient";

describe("devkit store snapshot semantics (the staleness bug regression)", () => {
	test("mutating edit state produces a new snapshot reference (Object.is differs)", () => {
		const before = devkitStore.snapshot();
		setDevkitEditing("eagle", true);
		const after = devkitStore.snapshot();
		expect(Object.is(before, after)).toBe(false);
		expect(isDevkitEditing("eagle")).toBe(true);
	});
	test("listener fires on commit and sees fresh values", () => {
		let notified = 0;
		let seenEditing = false;
		const unsubscribe = devkitStore.subscribe(() => {
			notified += 1;
			seenEditing = isDevkitEditing("pingcode");
		});
		setDevkitEditing("pingcode", true);
		expect(notified).toBe(1);
		expect(seenEditing).toBe(true);
		unsubscribe();
		setDevkitEditing("pingcode", false);
	});
	test("draft update, save feedback, and discard all change the snapshot", () => {
		const s0 = devkitStore.snapshot();
		updateDevkitDraft("jenkins", { username: "u1" });
		const s1 = devkitStore.snapshot();
		expect(Object.is(s0, s1)).toBe(false);
		expect(devkitDraft("jenkins")?.username).toBe("u1");
		markDevkitSave("jenkins", { saving: true, saved: false });
		const s2 = devkitStore.snapshot();
		expect(Object.is(s1, s2)).toBe(false);
		expect(devkitSaveFeedback("jenkins")?.saving).toBe(true);
		discardDevkitDraft("jenkins");
		const s3 = devkitStore.snapshot();
		expect(Object.is(s2, s3)).toBe(false);
		expect(devkitDraft("jenkins")).toBeNull();
	});
	test("no-op edits keep the same snapshot reference", () => {
		setDevkitEditing("eagle", false);
		const before = devkitStore.snapshot();
		setDevkitEditing("eagle", false);
		expect(Object.is(before, devkitStore.snapshot())).toBe(true);
	});
});
