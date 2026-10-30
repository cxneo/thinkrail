import { RiRefreshLine as Refresh } from "@remixicon/react";
import type { DevkitBuildResult, DevkitJenkinsRecommendation } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { getTransport } from "../transport";
import { ConfirmDialog } from "./ConfirmDialog";

export function DevkitJenkinsPane({
	workspaceId,
	onOpenSettings,
}: {
	workspaceId: string;
	onOpenSettings: () => void;
}) {
	const t = useT();
	const [recommendation, setRecommendation] = useState<DevkitJenkinsRecommendation | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [result, setResult] = useState<DevkitBuildResult | null>(null);
	const [triggering, setTriggering] = useState(false);
	const [elapsed, setElapsed] = useState(0);

	const load = () => {
		setLoading(true);
		setError(null);
		setResult(null);
		setElapsed(0);
		void getTransport()
			.request("devkit.jenkins.recommend", { workspaceId }, { timeoutMs: 660_000 })
			.then(
				(rec) => {
					setRecommendation(rec);
					setError(rec.error ?? null);
				},
				(reason) => {
					setError(reason instanceof Error ? reason.message : String(reason));
				},
			)
			.finally(() => setLoading(false));
	};

	// The full walk takes minutes — show a live elapsed counter while it runs.
	useEffect(() => {
		if (!loading) return;
		const startedAt = Date.now();
		const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
		return () => clearInterval(timer);
	}, [loading]);

	// Entering the tab starts the (cached / deduped) recommendation automatically.
	useEffect(() => {
		load();
	}, [workspaceId]);

	const trigger = (jobPath: string) => {
		setTriggering(true);
		void getTransport()
			.request("devkit.jenkins.trigger", { workspaceId, jobPath }, { timeoutMs: 660_000 })
			.then(setResult, (reason) => {
				setResult({
					jobName: jobPath,
					queued: false,
					message: reason instanceof Error ? reason.message : String(reason),
				});
			})
			.finally(() => {
				setTriggering(false);
				setConfirming(null);
			});
	};

	const candidates = recommendation?.candidates ?? [];
	const needsLoginHint = recommendation?.needsLogin === true;
	const confirmingCandidate =
		confirming !== null ? candidates.find((c) => c.jobPath === confirming) : undefined;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex items-center gap-4 px-8 py-4">
				<span className="tr-text-ui text-text-default">
					{recommendation?.branch
						? t("panels.devkit.jenkins.branch", { branch: recommendation.branch })
						: t("panels.devkit.jenkins.title")}
				</span>
				<span className="min-w-8 flex-1" />
				<IconButton
					variant="ghost"
					size="s"
					icon={Refresh}
					label={t("panels.devkit.jenkins.reload")}
					spinIcon={loading}
					disabled={loading}
					data-testid="devkit-jenkins-reload"
					onClick={load}
				/>
			</div>
			{error ? (
				<div data-testid="devkit-jenkins-error" className="flex items-center gap-8 px-8 py-4">
					<p className="tr-text-ui text-feedback-error">
						{needsLoginHint ? t("panels.devkit.jenkins.needsLogin") : error}
					</p>
					{needsLoginHint ? (
						<Button
							variant="outline"
							size="s"
							data-testid="devkit-jenkins-open-settings"
							onClick={onOpenSettings}
						>
							{t("panels.devkit.jenkins.openSettings")}
						</Button>
					) : null}
				</div>
			) : null}
			{result ? (
				<p
					data-testid="devkit-jenkins-result"
					className={
						result.queued
							? "px-8 py-4 tr-text-ui text-feedback-success"
							: "px-8 py-4 tr-text-ui text-feedback-error"
					}
				>
					{result.queued
						? t("panels.devkit.jenkins.queued", { job: result.jobName })
						: result.message}
					{result.queueUrl ? (
						<>
							{" · "}
							<a href={result.queueUrl} target="_blank" rel="noreferrer" className="underline">
								{t("panels.devkit.jenkins.queueUrl")}
							</a>
						</>
					) : null}
				</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto p-8" data-testid="devkit-jenkins-body">
				{loading ? (
					<div
						data-testid="devkit-jenkins-loading"
						className="flex flex-col items-center gap-8 py-24"
					>
						<p className="tr-text-ui text-text-default">
							{t("panels.devkit.jenkins.loading", { seconds: elapsed })}
						</p>
						<p className="tr-text-metadata text-text-subtle">
							{t("panels.devkit.jenkins.loadingHint")}
						</p>
					</div>
				) : null}
				{!recommendation && !loading ? (
					<div className="flex h-full flex-col items-center justify-center gap-8">
						<Button variant="outline" size="m" onClick={load} data-testid="devkit-jenkins-load">
							{t("panels.devkit.jenkins.load")}
						</Button>
					</div>
				) : null}
				{candidates.length > 0 ? (
					<ul data-testid="devkit-jenkins-candidates" className="flex flex-col gap-8">
						{candidates.map((candidate) => (
							<li
								key={candidate.jobPath}
								data-testid="devkit-jenkins-candidate"
								data-recommended={candidate.recommended ? "true" : undefined}
								className={
									candidate.recommended
										? "flex flex-col gap-4 rounded-sm border border-primary bg-primary-subtle p-12"
										: "flex flex-col gap-4 rounded-sm border border-border-default p-12"
								}
							>
								<div className="flex items-center gap-8">
									<span className="min-w-0 flex-1 truncate tr-code-text text-text-default">
										{candidate.jobName}
									</span>
									{candidate.recommended ? (
										<span className="shrink-0 rounded-full bg-primary px-8 tr-text-label-pill text-text-on-primary">
											{t("panels.devkit.jenkins.recommended")}
										</span>
									) : (
										<span className="shrink-0 tr-text-metadata text-text-subtle">
											{t("panels.devkit.jenkins.score", { score: candidate.score })}
										</span>
									)}
								</div>
								{candidate.params.length > 0 ? (
									<dl className="flex flex-col gap-2">
										{candidate.params.slice(0, 6).map((param) => (
											<div key={param.name} className="flex items-baseline gap-8">
												<dt className="shrink-0 tr-text-metadata text-text-subtle">{param.name}</dt>
												<dd className="min-w-0 flex-1 truncate tr-code-text text-text-default">
													{String(param.value ?? "")}
												</dd>
											</div>
										))}
									</dl>
								) : null}
								<div className="flex items-center">
									<span className="min-w-8 flex-1" />
									<Button
										variant={candidate.recommended ? "primary" : "outline"}
										size="s"
										disabled={triggering}
										data-testid="devkit-jenkins-trigger"
										onClick={() => setConfirming(candidate.jobPath)}
									>
										{t("panels.devkit.jenkins.trigger")}
									</Button>
								</div>
							</li>
						))}
					</ul>
				) : null}
				{recommendation && !loading && candidates.length === 0 && !error ? (
					<div className="flex h-full items-center justify-center">
						<p className="tr-text-ui text-text-subtle">{t("panels.devkit.jenkins.noCandidates")}</p>
					</div>
				) : null}
			</div>
			{confirmingCandidate ? (
				<ConfirmDialog
					open
					onOpenChange={(open) => {
						if (!open) setConfirming(null);
					}}
					title={t("panels.devkit.jenkins.confirmTitle")}
					description={t("panels.devkit.jenkins.confirmDescription", {
						job: confirmingCandidate.jobName,
						branch: recommendation?.branch ?? "",
					})}
					confirmLabel={t("panels.devkit.jenkins.confirmTrigger")}
					onConfirm={() => trigger(confirmingCandidate.jobPath)}
				/>
			) : null}
		</div>
	);
}
