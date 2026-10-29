import { RiLayoutGridLine, RiListSettingsLine } from "@remixicon/react";
import type { DevkitPlatform, DevkitTask } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useState, useSyncExternalStore } from "react";
import { devkitStore } from "./devkitClient";

type ViewMode = "list" | "cards";

export function DevkitTasksPane({
	platform,
}: {
	platform: Extract<DevkitPlatform, "eagle" | "pingcode">;
}) {
	const t = useT();
	const state = useSyncExternalStore(
		devkitStore.subscribe,
		devkitStore.snapshot,
		devkitStore.snapshot,
	);
	const snapshot = state.tasksByPlatform[platform] ?? null;
	const [mode, setMode] = useViewMode();

	if (!snapshot) {
		return (
			<div className="h-full overflow-auto p-12">
				<p className="tr-text-ui text-text-subtle">{t("panels.devkit.loading")}</p>
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<DevkitSnapshotHeader platform={platform} />
			<div className="flex items-center gap-4 px-8 py-4">
				<IconButton
					variant="ghost"
					size="s"
					icon={RiListSettingsLine}
					label={t("panels.devkit.viewList")}
					selected={mode === "list"}
					data-testid={`devkit-view-list-${platform}`}
					onClick={() => setMode("list")}
				/>
				<IconButton
					variant="ghost"
					size="s"
					icon={RiLayoutGridLine}
					label={t("panels.devkit.viewCards")}
					selected={mode === "cards"}
					data-testid={`devkit-view-cards-${platform}`}
					onClick={() => setMode("cards")}
				/>
				<span className="min-w-8 flex-1" />
				{snapshot.error ? (
					<span data-testid={`devkit-error-${platform}`} className="tr-text-ui text-feedback-error">
						{snapshot.needsLogin
							? t("panels.devkit.loginRequired")
							: snapshot.cliMissing
								? t("panels.devkit.cliMissing")
								: snapshot.error}
					</span>
				) : null}
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-8">
				{snapshot.tasks.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<p className="tr-text-ui text-text-subtle">{t("panels.devkit.empty")}</p>
					</div>
				) : mode === "cards" ? (
					<ul data-testid={`devkit-cards-${platform}`} className="grid grid-cols-2 gap-8">
						{snapshot.tasks.map((task) => (
							<DevkitTaskCard key={task.id} task={task} />
						))}
					</ul>
				) : (
					<ul data-testid={`devkit-list-${platform}`} className="flex flex-col gap-2">
						{snapshot.tasks.map((task) => (
							<DevkitTaskRow key={task.id} task={task} />
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function DevkitSnapshotHeader({ platform }: { platform: "eagle" | "pingcode" }) {
	const t = useT();
	const state = useSyncExternalStore(
		devkitStore.subscribe,
		devkitStore.snapshot,
		devkitStore.snapshot,
	);
	const snapshot = state.tasksByPlatform[platform] ?? null;
	const count = snapshot?.tasks.length ?? 0;
	const fetchedAt = snapshot?.fetchedAt ?? null;
	return (
		<div className="flex items-center gap-8 px-8 py-4 text-text-subtle">
			<span className="tr-text-metadata" data-testid={`devkit-count-${platform}`}>
				{t("panels.devkit.taskCount", { count })}
			</span>
			<span className="min-w-8 flex-1" />
			<span className="tr-text-metadata">
				{fetchedAt === null
					? t("panels.devkit.neverFetched")
					: t("panels.devkit.fetchedAt", { time: formatTime(fetchedAt) })}
			</span>
		</div>
	);
}

function formatTime(at: number): string {
	const date = new Date(at);
	const sameDay = new Date().toDateString() === date.toDateString();
	return sameDay
		? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
		: date.toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
}

function DevkitTaskRow({ task }: { task: DevkitTask }) {
	return (
		<li
			data-testid="devkit-task"
			data-code={task.code}
			className="flex items-center gap-8 rounded-sm px-8 py-6 hover:bg-control-bg-hovered"
		>
			<span className="shrink-0 tr-code-text text-text-default">{task.code}</span>
			<span className="shrink-0 tr-text-metadata text-text-subtle">{task.itemType}</span>
			<DevkitStatusBadge status={task.status} />
			<span className="min-w-0 flex-1 truncate tr-text-ui text-text-default" title={task.title}>
				{task.title}
			</span>
			{task.priority ? (
				<span className="shrink-0 tr-text-metadata text-text-muted">{task.priority}</span>
			) : null}
		</li>
	);
}

function DevkitTaskCard({ task }: { task: DevkitTask }) {
	return (
		<li
			data-testid="devkit-task"
			data-code={task.code}
			className="flex flex-col gap-4 rounded-sm border border-border-default p-12"
		>
			<div className="flex items-center gap-8">
				<span className="shrink-0 tr-code-text text-text-default">{task.code}</span>
				<span className="min-w-0 flex-1" />
				<DevkitStatusBadge status={task.status} />
			</div>
			<p className="line-clamp-2 tr-text-ui text-text-default" title={task.title}>
				{task.title}
			</p>
			<div className="flex items-center gap-8">
				<span className="tr-text-metadata text-text-subtle">{task.itemType}</span>
				<span className="min-w-0 flex-1" />
				{task.priority ? (
					<span className="tr-text-metadata text-text-muted">{task.priority}</span>
				) : null}
			</div>
		</li>
	);
}

function DevkitStatusBadge({ status }: { status: string }) {
	const kind =
		status.includes("进行") || status.includes("处理")
			? "progress"
			: status.includes("已解决") || status.includes("完成") || status.includes("done")
				? "done"
				: status.includes("待")
					? "pending"
					: "neutral";
	return (
		<span
			data-status={kind}
			className={
				kind === "progress"
					? "shrink-0 rounded-full bg-primary-subtle px-8 tr-text-label-pill text-text-default"
					: kind === "done"
						? "shrink-0 rounded-full bg-feedback-success-subtle px-8 tr-text-label-pill text-feedback-success"
						: kind === "pending"
							? "shrink-0 rounded-full bg-feedback-warning-subtle px-8 tr-text-label-pill text-text-default"
							: "shrink-0 rounded-full bg-control-bg px-8 tr-text-label-pill text-text-subtle"
			}
		>
			{status}
		</span>
	);
}

const VIEW_MODE_KEY = "thinkrail:devkit-view";

function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
	const [mode, setMode] = useState<ViewMode>(() =>
		localStorage.getItem(VIEW_MODE_KEY) === "cards" ? "cards" : "list",
	);
	const select = (next: ViewMode) => {
		setMode(next);
		localStorage.setItem(VIEW_MODE_KEY, next);
	};
	return [mode, select];
}
