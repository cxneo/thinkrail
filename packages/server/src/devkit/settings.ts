import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DevkitPlatform, DevkitSettingsInput, DevkitSettingsView } from "@thinkrail/contracts";
import { DEVKIT_PLATFORMS, isValidDevkitCron } from "@thinkrail/contracts";
import { dataDir } from "../persistence";

/**
 * Fork-owned, deliberately plain: the user declared these credentials
 * non-sensitive and asked for persistence that survives reinstalls. The file
 * lives under the host data dir with 0600 permissions. Do not extend this
 * store with secrets that were not explicitly accepted the same way.
 */
export interface DevkitPlatformSettings {
	username?: string | undefined;
	password?: string | undefined;
	defaultProject?: string | undefined;
	cron: string;
}

type StoredDevkitSettings = {
	version: 1;
	platforms: Record<string, DevkitPlatformSettings>;
};

const DEFAULT_CRON = "*/10 * * * *";

const DEFAULT_PLATFORM_SETTINGS: Record<DevkitPlatform, DevkitPlatformSettings> = {
	eagle: { cron: DEFAULT_CRON },
	pingcode: { cron: DEFAULT_CRON },
	jenkins: { cron: "off" },
};

function devkitDir(): string {
	return join(dataDir(), "devkit");
}

function settingsPath(): string {
	return join(devkitDir(), "settings.json");
}

function readStored(): StoredDevkitSettings {
	try {
		const raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as StoredDevkitSettings;
		if (raw && typeof raw === "object" && raw.version === 1 && typeof raw.platforms === "object") {
			return raw;
		}
	} catch {
		// missing or unreadable — fall through to defaults
	}
	return { version: 1, platforms: {} };
}

function writeStored(stored: StoredDevkitSettings): void {
	mkdirSync(devkitDir(), { recursive: true });
	const target = settingsPath();
	const temporary = `${target}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(stored, null, "\t")}\n`, { mode: 0o600 });
		renameSync(temporary, target);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function normalizePlatform(platform: DevkitPlatform, raw: unknown): DevkitPlatformSettings {
	const defaults = DEFAULT_PLATFORM_SETTINGS[platform];
	if (!raw || typeof raw !== "object") return { ...defaults };
	const value = raw as Partial<DevkitPlatformSettings>;
	const settings: DevkitPlatformSettings = {
		...(typeof value.username === "string" && value.username.length > 0
			? { username: value.username }
			: {}),
		...(typeof value.password === "string" && value.password.length > 0
			? { password: value.password }
			: {}),
		...(typeof value.defaultProject === "string" && value.defaultProject.length > 0
			? { defaultProject: value.defaultProject }
			: {}),
		cron:
			typeof value.cron === "string" && isValidDevkitCron(value.cron) ? value.cron : defaults.cron,
	};
	return settings;
}

export function loadDevkitPlatformSettings(platform: DevkitPlatform): DevkitPlatformSettings {
	const stored = readStored();
	return normalizePlatform(platform, stored.platforms[platform]);
}

export function devkitSettingsView(): DevkitSettingsView {
	const stored = readStored();
	const view = {} as DevkitSettingsView;
	for (const platform of DEVKIT_PLATFORMS) {
		const settings = normalizePlatform(platform, stored.platforms[platform]);
		view[platform] = {
			...(settings.username ? { username: settings.username } : {}),
			hasPassword: typeof settings.password === "string" && settings.password.length > 0,
			...(settings.defaultProject ? { defaultProject: settings.defaultProject } : {}),
			cron: settings.cron,
		};
	}
	return view;
}

export function updateDevkitSettings(input: DevkitSettingsInput): DevkitSettingsView {
	const stored = readStored();
	for (const platform of DEVKIT_PLATFORMS) {
		const patch = input[platform];
		if (!patch || typeof patch !== "object") continue;
		const current = normalizePlatform(platform, stored.platforms[platform]);
		const next: DevkitPlatformSettings = { ...current };
		if (typeof patch.username === "string") {
			const trimmed = patch.username.trim();
			next.username = trimmed.length > 0 ? trimmed : undefined;
		}
		if (typeof patch.password === "string") {
			next.password = patch.password.length > 0 ? patch.password : undefined;
		}
		if (typeof patch.defaultProject === "string") {
			const trimmed = patch.defaultProject.trim();
			next.defaultProject = trimmed.length > 0 ? trimmed : undefined;
		}
		if (typeof patch.cron === "string") {
			if (!isValidDevkitCron(patch.cron))
				throw new Error(`Invalid cron expression for ${platform}: ${patch.cron}`);
			next.cron = patch.cron;
		}
		stored.platforms[platform] = next;
	}
	writeStored(stored);
	return devkitSettingsView();
}

export function devkitCachePath(platform: string): string {
	return join(devkitDir(), "cache", `${platform}.json`);
}

export function devkitPlansDir(): string {
	return join(devkitDir(), "plans");
}

export function ensureDevkitDirs(): void {
	mkdirSync(join(devkitDir(), "cache"), { recursive: true });
	mkdirSync(devkitPlansDir(), { recursive: true });
}

export function devkitSettingsExist(): boolean {
	return existsSync(settingsPath());
}
