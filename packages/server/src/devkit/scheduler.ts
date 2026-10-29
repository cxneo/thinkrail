import type { DevkitPlatform } from "@thinkrail/contracts";
import { nextCronRunMs } from "./cron";
import { loadDevkitPlatformSettings } from "./settings";
import { refreshDevkitTasks } from "./tasks";

type PlatformSchedule = {
	nextRun: number | null;
	cronForNextRun: string | null;
};

const TICK_MS = 30_000;

const schedules = new Map<string, PlatformSchedule>();
let tick: ReturnType<typeof setInterval> | undefined;
let bootWarmup: ReturnType<typeof setTimeout> | undefined;

function recompute(platform: DevkitPlatform): void {
	const settings = loadDevkitPlatformSettings(platform);
	const schedule = schedules.get(platform) ?? { nextRun: null, cronForNextRun: null };
	if (schedule.cronForNextRun !== settings.cron) {
		schedule.cronForNextRun = settings.cron;
		schedule.nextRun = nextCronRunMs(settings.cron, Date.now());
	}
	schedules.set(platform, schedule);
}

function tickOnce(): void {
	const now = Date.now();
	for (const platform of ["eagle", "pingcode"] as const) {
		recompute(platform);
		const schedule = schedules.get(platform);
		if (!schedule || schedule.nextRun === null) continue;
		if (now < schedule.nextRun) continue;
		void refreshDevkitTasks(platform);
		const settings = loadDevkitPlatformSettings(platform);
		schedule.nextRun = nextCronRunMs(settings.cron, now);
		schedule.cronForNextRun = settings.cron;
	}
}

/** Start the background task refresh loop: a boot warm-up fetch plus a 30s
 * tick that evaluates each platform's cron. Refreshes are silent — results
 * reach clients through the `devkit.changed` push. */
export function startDevkitScheduler(): void {
	if (tick) return;
	tick = setInterval(tickOnce, TICK_MS);
	tick.unref?.();
	bootWarmup = setTimeout(() => {
		void refreshDevkitTasks("eagle");
		void refreshDevkitTasks("pingcode");
	}, 2_000);
	bootWarmup.unref?.();
}

export function stopDevkitScheduler(): void {
	if (tick) clearInterval(tick);
	tick = undefined;
	if (bootWarmup) clearTimeout(bootWarmup);
	bootWarmup = undefined;
	schedules.clear();
}
