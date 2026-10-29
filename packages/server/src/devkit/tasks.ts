import { readFileSync, writeFileSync } from "node:fs";
import type { DevkitPlatform, DevkitTask, DevkitTasksSnapshot } from "@thinkrail/contracts";
import { logger } from "../log";
import { devkitCommand, parseDevkitJson, runDevkit, runDevkitWithStdin } from "./cli";
import { devkitCachePath, ensureDevkitDirs, loadDevkitPlatformSettings } from "./settings";

type TaskPlatforms = Extract<DevkitPlatform, "eagle" | "pingcode">;

type CachedTasks = {
	fetchedAt: number;
	tasks: DevkitTask[];
};

const inflight = new Map<string, Promise<DevkitTasksSnapshot>>();

const log = logger("devkit");

/** Error text fragments the devkit CLI prints for an auth problem. */
const AUTH_ERROR_MARKERS = ["尚未登录", "未登录", "登录态已过期", "未配置凭据", "auth login"];

function isAuthError(text: string): boolean {
	return AUTH_ERROR_MARKERS.some((marker) => text.includes(marker));
}

function readCache(platform: TaskPlatforms): CachedTasks | null {
	try {
		const raw = JSON.parse(readFileSync(devkitCachePath(platform), "utf8")) as CachedTasks;
		if (
			raw &&
			typeof raw === "object" &&
			typeof raw.fetchedAt === "number" &&
			Array.isArray(raw.tasks)
		) {
			return raw;
		}
	} catch {
		// no cache yet
	}
	return null;
}

function writeCache(platform: TaskPlatforms, tasks: DevkitTask[]): void {
	ensureDevkitDirs();
	writeFileSync(
		devkitCachePath(platform),
		`${JSON.stringify({ fetchedAt: Date.now(), tasks }, null, "\t")}\n`,
	);
}

type EagleMineJson = {
	items?: Array<{
		id?: string;
		code?: string;
		title?: string;
		item_type?: string;
		status_label?: string;
		priority_label?: string;
		owner_name?: string;
	}>;
};

type PingcodeMineJson = {
	items?: Array<{
		whole_identifier?: string;
		title?: string;
		type?: string;
		state?: string;
		assignee?: string;
	}>;
};

function mapEagleItems(json: EagleMineJson): DevkitTask[] {
	return (json.items ?? []).map((item, index) => ({
		id: item.id ?? item.code ?? `eagle-${index}`,
		platform: "eagle",
		code: item.code ?? "",
		title: item.title ?? "",
		itemType: item.item_type === "defect" ? "缺陷" : (item.item_type ?? ""),
		status: item.status_label ?? "",
		...(item.priority_label ? { priority: item.priority_label } : {}),
		...(item.owner_name ? { assignee: item.owner_name } : {}),
	}));
}

function mapPingcodeItems(json: PingcodeMineJson): DevkitTask[] {
	return (json.items ?? []).map((item, index) => ({
		id: item.whole_identifier ?? `pingcode-${index}`,
		platform: "pingcode",
		code: item.whole_identifier ?? "",
		title: item.title ?? "",
		itemType: item.type ?? "",
		status: item.state ?? "",
		...(item.assignee ? { assignee: item.assignee } : {}),
	}));
}

function loginArgs(platform: DevkitPlatform, username: string): string[] {
	switch (platform) {
		case "eagle":
			return ["eagle", "auth", "login", "--username", username, "--password-stdin"];
		case "pingcode":
			return ["pingcode", "auth", "login", "--username", username, "--password-stdin"];
		case "jenkins":
			return ["jenkins", "auth", "login", "--username", username, "--secret-stdin"];
	}
}

/** Attempt a silent re-login with the stored credentials. Returns true when
 * the devkit CLI accepted them. Never throws. */
export async function devkitAutoLogin(platform: DevkitPlatform): Promise<boolean> {
	const settings = loadDevkitPlatformSettings(platform);
	if (!settings.username || !settings.password) return false;
	const run = await runDevkitWithStdin(loginArgs(platform, settings.username), settings.password);
	if (run.ok) return true;
	log.info(`devkit auto-login failed for ${platform}: ${run.err.trim().slice(0, 200)}`);
	return false;
}

function taskFetchArgs(platform: TaskPlatforms, project: string | undefined): string[] {
	if (platform === "eagle") return ["eagle", "defects", "mine", "--json"];
	const effectiveProject = project ?? "LANDSTARPRO";
	return ["pingcode", "items", "mine", "--project", effectiveProject, "--json"];
}

async function fetchTasks(platform: TaskPlatforms): Promise<DevkitTask[]> {
	const settings = loadDevkitPlatformSettings(platform);
	const run = await runDevkit(taskFetchArgs(platform, settings.defaultProject));
	if (!run.ok) {
		if (isAuthError(run.err) || isAuthError(run.out)) {
			const relogged = await devkitAutoLogin(platform);
			if (relogged) {
				const retry = await runDevkit(taskFetchArgs(platform, settings.defaultProject));
				if (retry.ok) {
					const json = parseDevkitJson<EagleMineJson & PingcodeMineJson>(retry);
					if (!json) throw new Error("devkit returned unparseable output");
					return platform === "eagle" ? mapEagleItems(json) : mapPingcodeItems(json);
				}
				throw new Error(firstErrorLine(retry));
			}
			throw new Error("login-required");
		}
		throw new Error(firstErrorLine(run));
	}
	const json = parseDevkitJson<EagleMineJson & PingcodeMineJson>(run);
	if (!json) throw new Error("devkit returned unparseable output");
	return platform === "eagle" ? mapEagleItems(json) : mapPingcodeItems(json);
}

function firstErrorLine(run: { err: string; out: string }): string {
	const line = (run.err || run.out).split("\n").find((candidate) => candidate.trim().length > 0);
	return (line ?? "devkit command failed").trim();
}

function currentSnapshot(platform: TaskPlatforms): DevkitTasksSnapshot {
	const cache = readCache(platform);
	return {
		platform,
		tasks: cache?.tasks ?? [],
		...(cache ? { fetchedAt: cache.fetchedAt } : { fetchedAt: null }),
		fetching: inflight.has(platform),
	};
}

export type DevkitPublisher = (push: { kind: "tasks"; snapshot: DevkitTasksSnapshot }) => void;

let publish: DevkitPublisher | null = null;

export function setDevkitPublisher(fn: DevkitPublisher | null): void {
	publish = fn;
}

/** Read-side: the current cached snapshot (hydrate-first). */
export function devkitTasks(platform: DevkitPlatform): DevkitTasksSnapshot {
	if (platform === "jenkins") {
		return { platform, tasks: [], fetchedAt: null, fetching: false };
	}
	return currentSnapshot(platform);
}

/** Refresh tasks for one platform (manual or scheduled). One refresh at a
 * time per platform; concurrent callers share the same promise. */
export function refreshDevkitTasks(platform: DevkitPlatform): Promise<DevkitTasksSnapshot> {
	if (platform === "jenkins") {
		return Promise.resolve(devkitTasks(platform));
	}
	const existing = inflight.get(platform);
	if (existing) return existing;
	const request = (async () => {
		publish?.({ kind: "tasks", snapshot: { ...currentSnapshot(platform), fetching: true } });
		try {
			const tasks = await fetchTasks(platform);
			writeCache(platform, tasks);
			const snapshot: DevkitTasksSnapshot = {
				...currentSnapshot(platform),
				tasks,
				fetchedAt: Date.now(),
				fetching: false,
			};
			delete snapshot.error;
			delete snapshot.needsLogin;
			publish?.({ kind: "tasks", snapshot });
			return snapshot;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const snapshot: DevkitTasksSnapshot = {
				...currentSnapshot(platform),
				fetching: false,
				error: message === "login-required" ? "login-required" : message,
				...(message === "login-required" ? { needsLogin: true } : {}),
				...(devkitCommand() ? {} : { cliMissing: true }),
			};
			publish?.({ kind: "tasks", snapshot });
			return snapshot;
		} finally {
			inflight.delete(platform);
		}
	})();
	inflight.set(platform, request);
	return request;
}

/** Read auth state per platform by probing the CLI's status commands.
 * eagle/pingcode print `已登录：名字（…）`; jenkins prints `已配置凭据：用户名`;
 * all exit non-zero when not authenticated. */
export async function devkitAuthStates(): Promise<
	Array<{ platform: DevkitPlatform; loggedIn: boolean | null; user?: string }>
> {
	const platforms: DevkitPlatform[] = ["eagle", "pingcode", "jenkins"];
	return Promise.all(
		platforms.map(async (platform) => {
			const run = await runDevkit([platform, "auth", "status"]);
			if (!run.ok) return { platform, loggedIn: false };
			const text = run.out.trim();
			const match = text.match(/(?:已登录|已配置凭据)[：:]\s*(.+?)\s*(?:[（(\n，]|$)/);
			const loggedIn = text.includes("已登录") || text.includes("已配置凭据");
			return {
				platform,
				loggedIn,
				...(loggedIn && match?.[1] ? { user: match[1] } : {}),
			};
		}),
	);
}
