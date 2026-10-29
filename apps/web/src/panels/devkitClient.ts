import type {
	DevkitAuthState,
	DevkitPlatform,
	DevkitPush,
	DevkitSettingsView,
	DevkitTasksSnapshot,
} from "@thinkrail/contracts";
import { getTransport } from "../transport";

type Listener = () => void;

type DevkitState = {
	tasksByPlatform: Record<string, DevkitTasksSnapshot>;
	authStates: DevkitAuthState[] | null;
	settings: DevkitSettingsView | null;
	loaded: boolean;
};

const state: DevkitState = {
	tasksByPlatform: {},
	authStates: null,
	settings: null,
	loaded: false,
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

export const devkitStore = { subscribe, snapshot };
