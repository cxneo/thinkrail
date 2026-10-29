import { describe, expect, test } from "bun:test";
import { cronMatches, nextCronRunMs, parseDevkitCron } from "./cron";
import { buildPlanForCandidate, computeDevkitPlanHash, type RecommendJson } from "./jenkins";

const minute = (iso: string) => new Date(iso).getTime();

describe("cron parsing", () => {
	test("rejects invalid expressions", () => {
		expect(parseDevkitCron("off")).toBeNull();
		expect(parseDevkitCron("* * * *")).toBeNull();
		expect(parseDevkitCron("* * * * * *")).toBeNull();
		expect(parseDevkitCron("60 * * * *")).toBeNull();
		expect(parseDevkitCron("* 24 * * *")).toBeNull();
		expect(parseDevkitCron("* * 0 * *")).toBeNull();
		expect(parseDevkitCron("* * * 13 *")).toBeNull();
		expect(parseDevkitCron("*/0 * * * *")).toBeNull();
		expect(parseDevkitCron("a * * * *")).toBeNull();
		expect(parseDevkitCron("1-2-3 * * * *")).toBeNull();
	});

	test("accepts valid expressions", () => {
		expect(parseDevkitCron("*/10 * * * *")).not.toBeNull();
		expect(parseDevkitCron("0 9 * * 1-5")).not.toBeNull();
		expect(parseDevkitCron("30 8,12 * * *")).not.toBeNull();
		expect(parseDevkitCron("15 2 1 * *")).not.toBeNull();
		expect(parseDevkitCron("* * * * 7")).not.toBeNull();
	});

	test("matches every-N-minutes schedules", () => {
		const at = minute("2026-10-30T10:00:00Z");
		expect(cronMatches("*/10 * * * *", at)).toBeTrue();
		expect(cronMatches("*/10 * * * *", at + 5 * 60_000)).toBeFalse();
		expect(cronMatches("*/10 * * * *", at + 10 * 60_000)).toBeTrue();
		expect(cronMatches("*/15 * * * *", at + 45 * 60_000)).toBeTrue();
	});

	test("matches workday-morning schedules", () => {
		// 2026-10-30 is a Friday
		expect(cronMatches("0 9 * * 1-5", minute("2026-10-30T09:00:00Z"))).toBeTrue();
		expect(cronMatches("0 9 * * 1-5", minute("2026-10-30T09:01:00Z"))).toBeFalse();
		expect(cronMatches("0 9 * * 1-5", minute("2026-10-31T09:00:00Z"))).toBeFalse(); // Saturday
		expect(cronMatches("0 9 * * 1-5", minute("2026-11-01T09:00:00Z"))).toBeFalse(); // Sunday
	});

	test("treats dow 7 as Sunday", () => {
		expect(cronMatches("0 9 * * 7", minute("2026-11-01T09:00:00Z"))).toBeTrue(); // Sunday
		expect(cronMatches("0 9 * * 0", minute("2026-11-01T09:00:00Z"))).toBeTrue();
		expect(cronMatches("0 9 * * 7", minute("2026-11-02T09:00:00Z"))).toBeFalse(); // Monday
	});

	test("DOM/DOW use OR when both restricted", () => {
		// 2026-10-30: Friday, day 30
		expect(cronMatches("0 0 30 * 5", minute("2026-10-30T00:00:00Z"))).toBeTrue(); // either matches
		expect(cronMatches("0 0 29 * 5", minute("2026-10-30T00:00:00Z"))).toBeTrue(); // dow matches alone
		expect(cronMatches("0 0 29 * 6", minute("2026-10-30T00:00:00Z"))).toBeFalse(); // neither
	});

	test("next run lands after the current minute", () => {
		const at = minute("2026-10-30T10:07:00Z");
		const next = nextCronRunMs("*/10 * * * *", at);
		expect(next).toBe(minute("2026-10-30T10:10:00Z"));
		const exactly = nextCronRunMs("*/10 * * * *", minute("2026-10-30T10:10:00Z"));
		expect(exactly).toBe(minute("2026-10-30T10:20:00Z"));
	});

	test("next run skips to the next workday morning", () => {
		const friday9 = minute("2026-10-30T09:00:00Z");
		const next = nextCronRunMs("0 9 * * 1-5", friday9);
		expect(next).toBe(minute("2026-11-02T09:00:00Z")); // Monday
	});
});

describe("jenkins plan construction", () => {
	const recommendation: RecommendJson = {
		status: "recommended",
		branch: "feature/devkit",
		head_sha: "abcdef1234",
		candidates: [
			{
				job: "LS9-Develop-Day",
				job_path: "job/LandStar/job/LandStar-Test/job/LS9-Develop-Day",
				score: 95,
				params: [
					{ name: "BRANCH", value: "feature/devkit", source: "git_context", confidence: "high" },
					{ name: "FLAVOR", value: "daily", source: "job_default", confidence: "high" },
				],
				evidence: ["same branch built here yesterday"],
			},
			{
				job: "LS9-Develop-Night",
				job_path: "job/LandStar/job/LandStar-Test/job/LS9-Develop-Night",
				score: 40,
				params: [],
			},
		],
		git_context: {
			branch: "feature/devkit",
			head_sha: "abcdef1234",
			repo_path: "/repo",
			upstream: "origin/feature/devkit",
			tracking_sha: "abcdef1234",
			unpushed_count: 0,
			dirty: false,
		},
	};

	test("selects the requested candidate and carries its identity", () => {
		const plan = buildPlanForCandidate(recommendation, 1);
		expect(plan.job.full_name).toBe("LS9-Develop-Night");
		expect(plan.params).toEqual([]);
		const top = buildPlanForCandidate(recommendation, 0);
		expect(top.job.full_name).toBe("LS9-Develop-Day");
		expect(top.params.map((param) => param.name)).toEqual(["BRANCH", "FLAVOR"]);
		expect(top.git.branch).toBe("feature/devkit");
		expect(top.schema).toBe("devkit/jenkins-build-plan/1");
	});

	test("plan hash binds job, branch, head, and params", () => {
		const plan = buildPlanForCandidate(recommendation, 0);
		expect(plan.plan_hash).toMatch(/^[0-9a-f]{64}$/);
		const tampered = structuredClone(plan);
		const firstParam = tampered.params[0];
		if (!firstParam) throw new Error("missing param fixture");
		firstParam.value = "other-branch";
		expect(computeDevkitPlanHash(tampered)).not.toBe(plan.plan_hash);
		const renamed = structuredClone(plan);
		renamed.job.full_name = "other-job";
		expect(computeDevkitPlanHash(renamed)).not.toBe(plan.plan_hash);
		const plan2 = buildPlanForCandidate(recommendation, 0);
		expect(plan2.plan_hash).toBe(plan.plan_hash);
	});

	test("throws for an unknown candidate index", () => {
		expect(() => buildPlanForCandidate(recommendation, 5)).toThrow();
	});
});
