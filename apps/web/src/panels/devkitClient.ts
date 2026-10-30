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

/**
 * `state` is the mutable internal store; `view` is the immutable snapshot
 * `useSyncExternalStore` reads. getSnapshot must return a cached value whose
 * reference changes when the data changes — mutating `state` in place and
 * returning it would make Object.is treat every push as "unchanged" and skip
 * the re-render (the edit/save/cancel staleness bug). `commit` rebuilds the
 * snapshot once per mutation, then notifies.
 */
let view: DevkitState = freeze(state);

function emit(): void {
	for (const listener of listeners) listener();
}

function freeze(current: DevkitState): DevkitState {
	return {
		...current,
		tasksByPlatform: { ...current.tasksByPlatform },
		authStates: current.authStates,
		settings: current.settings,
		drafts: { ...current.drafts },
		editing: { ...current.editing },
		saveFeedback: { ...current.saveFeedback },
	};
}

function commit(): void {
	view = freeze(state);
	emit();
}

function subscribe(listener: Listener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function snapshot(): DevkitState {
	return view;
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
			commit();
		} else if (payload.kind === "settings") {
			state.settings = payload.view;
			commit();
		} else if (payload.kind === "auth") {
			state.authStates = payload.states;
			commit();
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
				commit();
			})
			.catch(() => {});
	}
	void transport
		.request("devkit.settings.get", {})
		.then((settingsView) => {
			state.settings = settingsView;
			commit();
		})
		.catch(() => {});
}

export function devkitTasksOf(platform: DevkitPlatform): DevkitTasksSnapshot | null {
	return view.tasksByPlatform[platform] ?? null;
}

export function devkitSettings(): DevkitSettingsView | null {
	return view.settings;
}

export function devkitAuthStates(): DevkitAuthState[] | null {
	return view.authStates;
}

/** Manual refresh — resolves with the fresh snapshot (or the error snapshot). */
export function refreshDevkit(platform: DevkitPlatform): Promise<DevkitTasksSnapshot | null> {
	bindChannel();
	return getTransport()
		.request("devkit.refresh", { platform })
		.then((snapshot) => {
			state.tasksByPlatform[platform] = snapshot;
			commit();
			return snapshot;
		})
		.catch(() => null);
}

export function saveDevkitSettings(
	input: Partial<Record<DevkitPlatform, Record<string, string>>>,
): Promise<DevkitSettingsView | null> {
	return getTransport()
		.request("devkit.settings.update", input)
		.then((settingsView) => {
			state.settings = settingsView;
			commit();
			return settingsView;
		})
		.catch(() => null);
}

export function loadDevkitAuth(): Promise<void> {
	return getTransport()
		.request("devkit.authStatus", {})
		.then((states) => {
			state.authStates = states;
			commit();
		})
		.catch(() => {});
}

// --- settings edit-lock state (module-level; survives tab switches) ---

export function setDevkitEditing(platform: DevkitPlatform, editing: boolean): void {
	if ((state.editing[platform] ?? false) === editing) return;
	state.editing[platform] = editing;
	commit();
}

export function isDevkitEditing(platform: DevkitPlatform): boolean {
	return view.editing[platform] === true;
}

export function updateDevkitDraft(
	platform: DevkitPlatform,
	patch: Partial<DevkitPlatformDraft>,
): void {
	const current = state.drafts[platform] ?? draftFromView(platform);
	state.drafts[platform] = { ...current, ...patch };
	commit();
}

export function devkitDraft(platform: DevkitPlatform): DevkitPlatformDraft | null {
	return view.drafts[platform] ?? null;
}

export function discardDevkitDraft(platform: DevkitPlatform): void {
	if (!state.drafts[platform]) return;
	delete state.drafts[platform];
	commit();
}

/** The draft a platform starts from: the saved view (password included — the
 * fork shows credentials in plaintext), so re-saving never wipes a password. */
export function draftFromView(platform: DevkitPlatform): DevkitPlatformDraft {
	const settings = view.settings?.[platform];
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
	commit();
}

export function devkitSaveFeedback(platform: DevkitPlatform): DevkitSaveFeedback | null {
	return view.saveFeedback[platform] ?? null;
}

export const devkitStore = { subscribe, snapshot };
