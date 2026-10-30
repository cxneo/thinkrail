import { createHash, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	DevkitBuildResult,
	DevkitJenkinsCandidate,
	DevkitJenkinsParam,
	DevkitJenkinsRecommendation,
} from "@thinkrail/contracts";
import { getWorkspace } from "../workspaces";
import { isDevkitAuthError, parseDevkitJson, runDevkit } from "./cli";
import { devkitPlansDir, ensureDevkitDirs } from "./settings";
import { devkitAutoLogin } from "./tasks";

type RecommendJson = {
	status?: string;
	repo?: string;
	branch?: string;
	head_sha?: string;
	candidates?: Array<{
		job?: string;
		job_path?: string;
		score?: number;
		score_breakdown?: Record<string, number>;
		params?: Array<{
			name?: string;
			value?: string | number | boolean | null;
			source?: string;
			confidence?: string;
		}>;
		evidence?: string[];
	}>;
	warnings?: string[];
	git_context?: {
		branch?: string;
		head_sha?: string;
		repo_path?: string;
		upstream?: string | null;
		tracking_sha?: string | null;
		unpushed_count?: number;
		dirty?: boolean;
	};
};

export type { RecommendJson };

function mapRecommendation(json: RecommendJson): DevkitJenkinsRecommendation {
	const candidates: DevkitJenkinsCandidate[] = (json.candidates ?? [])
		.filter(
			(candidate) => typeof candidate.job === "string" && typeof candidate.job_path === "string",
		)
		.map((candidate, index) => ({
			jobName: candidate.job ?? "",
			jobPath: candidate.job_path ?? "",
			score: typeof candidate.score === "number" ? candidate.score : 0,
			recommended: index === 0,
			params: (candidate.params ?? []).map(
				(param): DevkitJenkinsParam => ({
					name: param.name ?? "",
					...(param.value !== undefined ? { value: param.value } : {}),
					...(param.source ? { source: param.source } : {}),
					...(param.confidence ? { confidence: param.confidence } : {}),
				}),
			),
			...(Array.isArray(candidate.evidence) && candidate.evidence.length > 0
				? { evidence: candidate.evidence }
				: {}),
		}));
	return {
		branch: json.branch ?? null,
		status: json.status ?? "unknown",
		candidates,
		...(Array.isArray(json.warnings) ? { warnings: json.warnings } : {}),
	};
}

type JenkinsRun = { ok: boolean; out: string; err: string; authFailed: boolean };

/** recommend + the shared silent relogin on a credentials error: a missing or
 * expired keyring credential retriggers `jenkins auth login` with the stored
 * settings credentials, then one retry — the task fetcher's pattern. */
async function recommendRun(worktreePath: string): Promise<JenkinsRun> {
	const args = ["jenkins", "build", "recommend", "--repo", worktreePath, "--json"];
	const run = await runDevkit(args, { cwd: worktreePath, timeoutMs: 180_000 });
	if (run.ok) return { ok: true, out: run.out, err: run.err, authFailed: false };
	if (isDevkitAuthError(run.err) || isDevkitAuthError(run.out)) {
		const relogged = await devkitAutoLogin("jenkins");
		if (relogged) {
			const retry = await runDevkit(args, { cwd: worktreePath, timeoutMs: 180_000 });
			return { ok: retry.ok, out: retry.out, err: retry.err, authFailed: !retry.ok };
		}
		return { ok: false, out: run.out, err: run.err, authFailed: true };
	}
	return { ok: false, out: run.out, err: run.err, authFailed: false };
}

/** Read the workspace worktree's pipeline recommendation (read-only CLI call). */
export async function devkitJenkinsRecommend(
	workspaceId: string,
): Promise<DevkitJenkinsRecommendation> {
	const workspace = getWorkspace(workspaceId);
	const run = await recommendRun(workspace.worktreePath);
	if (!run.ok) {
		const line = (run.err || run.out).split("\n").find((candidate) => candidate.trim().length > 0);
		return {
			branch: null,
			status: "error",
			candidates: [],
			error: (line ?? "devkit jenkins recommend failed").trim(),
			...(run.authFailed ? { needsLogin: true } : {}),
		};
	}
	const json = parseDevkitJson<RecommendJson>({
		...run,
		exitCode: 0,
		launchFailed: false,
		timedOut: false,
	});
	if (!json)
		return { branch: null, status: "error", candidates: [], error: "unparseable recommendation" };
	return mapRecommendation(json);
}

export type PlanFile = {
	schema: string;
	created_at: string;
	expires_at: string;
	job: { full_name: string; job_path: string };
	git: {
		repo: string;
		branch: string;
		head_sha: string;
		upstream: string | null;
		tracking_sha: string | null;
		unpushed_count: number;
		dirty: boolean;
	};
	params: Array<{ name: string; value: string | number | boolean | null }>;
	score: number | null;
	score_breakdown: Record<string, number> | null;
	evidence: string[];
	warnings: string[];
	approval: { approved: boolean; approved_at: string | null; approved_by: string | null };
	plan_hash: string;
};

const PLAN_SCHEMA = "devkit/jenkins-build-plan/1";
const PLAN_TTL_MINUTES = 60;

/**
 * Mirror of devkit's `build_plan` for one chosen candidate. devkit re-verifies
 * the hash, expiry, branch and HEAD before triggering, so a drift here fails
 * closed — the trigger is refused, never misfired. Exported for tests.
 */
export function buildPlanForCandidate(
	recommendation: RecommendJson,
	candidateIndex: number,
): PlanFile {
	const candidate = recommendation.candidates?.[candidateIndex];
	if (!candidate || typeof candidate.job !== "string" || typeof candidate.job_path !== "string") {
		throw new Error("Unknown pipeline candidate");
	}
	const git = recommendation.git_context ?? {};
	const now = new Date();
	const expires = new Date(now.getTime() + PLAN_TTL_MINUTES * 60_000);
	const plan: PlanFile = {
		schema: PLAN_SCHEMA,
		created_at: now.toISOString().slice(0, 19),
		expires_at: expires.toISOString().slice(0, 19),
		job: { full_name: candidate.job, job_path: candidate.job_path },
		git: {
			repo: git.repo_path ?? "",
			branch: git.branch ?? "",
			head_sha: git.head_sha ?? "",
			upstream: git.upstream ?? null,
			tracking_sha: git.tracking_sha ?? null,
			unpushed_count: typeof git.unpushed_count === "number" ? git.unpushed_count : 0,
			dirty: git.dirty === true,
		},
		params: (candidate.params ?? []).map((param) => ({
			name: param.name ?? "",
			value: param.value ?? null,
		})),
		score: typeof candidate.score === "number" ? candidate.score : null,
		score_breakdown: candidate.score_breakdown ?? null,
		evidence: candidate.evidence ?? [],
		warnings: recommendation.warnings ?? [],
		approval: { approved: false, approved_at: null, approved_by: null },
		plan_hash: "",
	};
	plan.plan_hash = planHash(plan);
	return plan;
}

function planHash(plan: PlanFile): string {
	const payload = {
		git: {
			branch: plan.git.branch,
			head_sha: plan.git.head_sha,
			tracking_sha: plan.git.tracking_sha,
		},
		job: plan.job,
		params: Object.fromEntries(plan.params.map((param) => [param.name, param.value])),
	};
	const blob = JSON.stringify(payload);
	return createHash("sha256").update(blob).digest("hex");
}

/** The plan fingerprint devkit recomputes before triggering. Exported so
 * tests can assert the binding without reconstructing the payload. */
export const computeDevkitPlanHash = planHash;

/** Trigger a build for the chosen candidate. The confirmation dialog in the
 * panel is the "out-of-terminal human approval"; the full job name is the
 * approve token devkit requires in non-interactive runs. */
export async function devkitJenkinsTrigger(
	workspaceId: string,
	jobPath: string,
): Promise<DevkitBuildResult> {
	const workspace = getWorkspace(workspaceId);
	const recommendRun = await runDevkit(
		["jenkins", "build", "recommend", "--repo", workspace.worktreePath, "--json"],
		{ cwd: workspace.worktreePath, timeoutMs: 180_000 },
	);
	if (!recommendRun.ok) throw new Error("Recommendation failed — refresh the list and retry");
	const recommendation = parseDevkitJson<RecommendJson>(recommendRun);
	if (!recommendation) throw new Error("Unparseable recommendation");
	const candidateIndex = recommendation.candidates?.findIndex(
		(candidate) => candidate.job_path === jobPath,
	);
	if (candidateIndex === undefined || candidateIndex < 0)
		throw new Error("Unknown pipeline candidate");
	const plan = buildPlanForCandidate(recommendation, candidateIndex);
	ensureDevkitDirs();
	const planPath = join(devkitPlansDir(), `${randomUUID()}.json`);
	try {
		writeFileSync(planPath, `${JSON.stringify(plan, null, "\t")}\n`, { mode: 0o600 });
		const run = await runDevkit(
			[
				"jenkins",
				"build",
				"trigger",
				"--plan",
				planPath,
				"--repo",
				workspace.worktreePath,
				"--approve-token",
				plan.job.full_name,
			],
			{ cwd: workspace.worktreePath, timeoutMs: 120_000 },
		);
		const text = `${run.out}\n${run.err}`.trim();
		const queueMatch = text.match(/队列[：:]\s*(https?:\/\/\S+)/);
		if (!run.ok) {
			return {
				jobName: plan.job.full_name,
				queued: false,
				message: firstMeaningfulLine(text) ?? "trigger failed",
			};
		}
		return {
			jobName: plan.job.full_name,
			queued: true,
			message: firstMeaningfulLine(run.out) ?? "triggered",
			...(queueMatch?.[1] ? { queueUrl: queueMatch[1] } : {}),
		};
	} finally {
		rmSync(planPath, { force: true });
	}
}

function firstMeaningfulLine(text: string): string | undefined {
	return text
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.length > 0);
}
