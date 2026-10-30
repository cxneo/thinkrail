import type {
	DevkitAuthState,
	DevkitPlatform,
	DevkitPush,
	DevkitSettingsView,
	DevkitTasksSnapshot,
} from "@thinkrail/contracts";
import { getTransport } from "../transport";

type Listener = () => void;

export type DevkitPlatformDraft = {
	username: string;
	password: string;
	defaultProject: string;
	cron: string;
};

type DevkitState = {
	tasksByPlatform: Record<string, DevkitTasksSnapshot>;
	authStates: DevkitAuthState[] | null;
	settings: DevkitSettingsView | null;
	loaded: boolean;
	/** In-progress settings drafts, keyed by platform — module-level so a tab
	 * switch (which unmounts the pane) never loses an unsaved edit. */
	drafts: Partial<Record<DevkitPlatform, DevkitPlatformDraft>>;
	/** Platforms whose settings inputs are unlocked for editing. Locked after
	 * save; unlocked by the edit action. */
	editing: Partial<Record<DevkitPlatform, boolean>>;
	/** Last save outcome per platform (module-level; a tab switch mid-save
	 * keeps the result visible). */
	saveFeedback: Partial<Record<DevkitPlatform, DevkitSaveFeedback>>;
};

const state: DevkitState = {
	tasksByPlatform: {},
	authStates: null,
	settings: null,
	loaded: false,
	drafts: {},
	editing: {},
	saveFeedback: {},
};

const listeners = new Set<Listener>();

function emit(): void {
	for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function snapshot(): DevkitState {
	return state;
}

let channelBound = false;

function bindChannel(): void {
	if (channelBound) return;
	channelBound = true;
	getTransport().subscribe("devkit.changed", (push) => {
		const payload = push as DevkitPush;
		if (!payload || typeof payload !== "object") return;
		if (payload.kind === "tasks") {
			state.tasksByPlatform[payload.snapshot.platform] = payload.snapshot;
			emit();
		} else if (payload.kind === "settings") {
			state.settings = payload.view;
			emit();
		} else if (payload.kind === "auth") {
			state.authStates = payload.states;
			emit();
		}
	});
}

/** Hydrate all panel state once; safe to call repeatedly. */
export function ensureDevkitLoaded(): void {
	bindChannel();
	if (state.loaded) return;
	state.loaded = true;
	const transport = getTransport();
	for (const platform of ["eagle", "pingcode"] as const) {
		void transport
			.request("devkit.tasks", { platform })
			.then((snapshot) => {
				state.tasksByPlatform[platform] = snapshot;
				emit();
			})
			.catch(() => {});
	}
	void transport
		.request("devkit.settings.get", {})
		.then((view) => {
			state.settings = view;
			emit();
		})
		.catch(() => {});
}

export function devkitTasksOf(platform: DevkitPlatform): DevkitTasksSnapshot | null {
	return state.tasksByPlatform[platform] ?? null;
}

export function devkitSettings(): DevkitSettingsView | null {
	return state.settings;
}

export function devkitAuthStates(): DevkitAuthState[] | null {
	return state.authStates;
}

/** Manual refresh — resolves with the fresh snapshot (or the error snapshot). */
export function refreshDevkit(platform: DevkitPlatform): Promise<DevkitTasksSnapshot | null> {
	bindChannel();
	return getTransport()
		.request("devkit.refresh", { platform })
		.then((snapshot) => {
			state.tasksByPlatform[platform] = snapshot;
			emit();
			return snapshot;
		})
		.catch(() => null);
}

export function saveDevkitSettings(
	input: Partial<Record<DevkitPlatform, Record<string, string>>>,
): Promise<DevkitSettingsView | null> {
	return getTransport()
		.request("devkit.settings.update", input)
		.then((view) => {
			state.settings = view;
			emit();
			return view;
		})
		.catch(() => null);
}

export function loadDevkitAuth(): Promise<void> {
	return getTransport()
		.request("devkit.authStatus", {})
		.then((states) => {
			state.authStates = states;
			emit();
		})
		.catch(() => {});
}

// --- settings edit-lock state (module-level; survives tab switches) ---

export function setDevkitEditing(platform: DevkitPlatform, editing: boolean): void {
	if ((state.editing[platform] ?? false) === editing) return;
	state.editing[platform] = editing;
	emit();
}

export function isDevkitEditing(platform: DevkitPlatform): boolean {
	return state.editing[platform] === true;
}

export function updateDevkitDraft(
	platform: DevkitPlatform,
	patch: Partial<DevkitPlatformDraft>,
): void {
	const current = state.drafts[platform] ?? draftFromView(platform);
	state.drafts[platform] = { ...current, ...patch };
	emit();
}

export function devkitDraft(platform: DevkitPlatform): DevkitPlatformDraft | null {
	return state.drafts[platform] ?? null;
}

export function discardDevkitDraft(platform: DevkitPlatform): void {
	if (!state.drafts[platform]) return;
	delete state.drafts[platform];
	emit();
}

/** The draft a platform starts from: the saved view (password included — the
 * fork shows credentials in plaintext), so re-saving never wipes a password. */
export function draftFromView(platform: DevkitPlatform): DevkitPlatformDraft {
	const settings = state.settings?.[platform];
	return {
		username: settings?.username ?? "",
		password: settings?.password ?? "",
		defaultProject: settings?.defaultProject ?? "",
		cron: settings?.cron ?? "*/10 * * * *",
	};
}

export type DevkitSaveFeedback = { saving: boolean; saved: boolean };

export function markDevkitSave(platform: DevkitPlatform, feedback: DevkitSaveFeedback): void {
	state.saveFeedback[platform] = feedback;
	emit();
}

export function devkitSaveFeedback(platform: DevkitPlatform): DevkitSaveFeedback | null {
	return state.saveFeedback[platform] ?? null;
}

export const devkitStore = { subscribe, snapshot };
