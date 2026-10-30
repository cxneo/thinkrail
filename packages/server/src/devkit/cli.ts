import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type DevkitRun = {
	ok: boolean;
	out: string;
	err: string;
	exitCode: number | null;
	launchFailed: boolean;
	timedOut: boolean;
};

const DEVKIT_TIMEOUT_MS = 600_000;
const DEVKIT_LOGIN_TIMEOUT_MS = 60_000;

let cachedCommand: string | null | undefined;

/** Resolve the devkit CLI executable: an explicit DEVKIT_BIN override, the
 * conventional ~/.local/bin location, then PATH. Cached for the host process. */
export function devkitCommand(): string | null {
	if (cachedCommand !== undefined) return cachedCommand;
	const override = process.env.DEVKIT_BIN;
	const candidates = override
		? [override]
		: [
				join(homedir(), ".local", "bin", "devkit"),
				"/usr/local/bin/devkit",
				"/opt/homebrew/bin/devkit",
			];
	for (const candidate of candidates) {
		try {
			accessSync(candidate, constants.X_OK);
			cachedCommand = candidate;
			return cachedCommand;
		} catch {
			// try the next candidate
		}
	}
	const fromPath = Bun.which("devkit");
	cachedCommand = fromPath ?? null;
	return cachedCommand;
}

/** Drop the cached resolution (tests and forced re-probing). */
export function resetDevkitCommand(): void {
	cachedCommand = undefined;
}

function spawnOptions(cwd?: string): {
	cwd?: string;
	stdin: "pipe";
	stdout: "pipe";
	stderr: "pipe";
	env: Record<string, string | undefined>;
	windowsHide: true;
} {
	const env: Record<string, string | undefined> = { ...process.env };
	const home = homedir();
	const localBin = join(home, ".local", "bin");
	const path = env.PATH ?? "";
	if (!path.split(":").includes(localBin)) env.PATH = `${localBin}:${path}`;
	return {
		...(cwd ? { cwd } : {}),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env,
		windowsHide: true as const,
	};
}

async function finish(
	proc: Bun.Subprocess<"pipe", "pipe", "pipe">,
	stdinText: string | null,
	timeoutMs: number,
): Promise<DevkitRun> {
	const timer = setTimeout(() => {
		try {
			if (process.platform !== "win32") process.kill(-proc.pid, "SIGKILL");
			else proc.kill("SIGKILL");
		} catch {
			proc.kill("SIGKILL");
		}
	}, timeoutMs);
	timer.unref?.();
	if (stdinText !== null) {
		try {
			proc.stdin.write(stdinText);
		} catch {}
	}
	try {
		proc.stdin.end();
	} catch {}
	const [out, err, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	clearTimeout(timer);
	return {
		ok: exitCode === 0,
		out,
		err,
		exitCode,
		launchFailed: false,
		timedOut: false,
	};
}

/** Run `devkit <args>` with no stdin. */
export function runDevkit(
	args: string[],
	opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<DevkitRun> {
	const command = devkitCommand();
	if (!command) {
		return Promise.resolve({
			ok: false,
			out: "",
			err: "devkit CLI not found",
			exitCode: null,
			launchFailed: true,
			timedOut: false,
		});
	}
	let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = Bun.spawn([command, ...args], spawnOptions(opts.cwd));
	} catch {
		return Promise.resolve({
			ok: false,
			out: "",
			err: "devkit CLI failed to launch",
			exitCode: null,
			launchFailed: true,
			timedOut: false,
		});
	}
	return finish(proc, null, opts.timeoutMs ?? DEVKIT_TIMEOUT_MS);
}

/** Run `devkit <args>` piping `stdinText` to stdin (credential logins). */
export function runDevkitWithStdin(
	args: string[],
	stdinText: string,
	opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<DevkitRun> {
	const command = devkitCommand();
	if (!command) {
		return Promise.resolve({
			ok: false,
			out: "",
			err: "devkit CLI not found",
			exitCode: null,
			launchFailed: true,
			timedOut: false,
		});
	}
	let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = Bun.spawn([command, ...args], spawnOptions(opts.cwd));
	} catch {
		return Promise.resolve({
			ok: false,
			out: "",
			err: "devkit CLI failed to launch",
			exitCode: null,
			launchFailed: true,
			timedOut: false,
		});
	}
	return finish(proc, stdinText, opts.timeoutMs ?? DEVKIT_LOGIN_TIMEOUT_MS);
}

/** Parse the first JSON object printed by a devkit `--json` command. */
export function parseDevkitJson<T>(run: DevkitRun): T | null {
	if (!run.ok) return null;
	const start = run.out.indexOf("{");
	if (start < 0) return null;
	const end = run.out.lastIndexOf("}");
	if (end <= start) return null;
	try {
		return JSON.parse(run.out.slice(start, end + 1)) as T;
	} catch {
		return null;
	}
}

/** Error text fragments the devkit CLI prints for an auth problem. Shared by
 * the task fetcher and the Jenkins flows so both auto-relogin identically. */
const AUTH_ERROR_MARKERS = ["尚未登录", "未登录", "登录态已过期", "未配置凭据", "auth login"];

export function isDevkitAuthError(text: string): boolean {
	return AUTH_ERROR_MARKERS.some((marker) => text.includes(marker));
}
