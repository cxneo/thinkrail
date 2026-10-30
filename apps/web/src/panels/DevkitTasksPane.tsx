import {
	RiArrowDownSLine as ArrowDown,
	RiArrowUpSLine as ArrowUp,
	RiCheckLine as Check,
	RiCloseCircleLine as ClearFilter,
	RiLayoutGridLine,
	RiListSettingsLine,
	RiTextWrap,
	RiSearchLine as Search,
} from "@remixicon/react";
import type { DevkitPlatform, DevkitTask } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import { useRef, useState, useSyncExternalStore } from "react";
import { devkitStore } from "./devkitClient";
import {
	applyDevkitTaskView,
	type DevkitColumnId,
	type DevkitTablePrefs,
	devkitStatusOptions,
	hasActiveDevkitFilter,
	loadDevkitTablePrefs,
	nextDevkitSort,
	reorderDevkitColumns,
	saveDevkitTablePrefs,
} from "./devkitTableState";

type TaskPlatform = Extract<DevkitPlatform, "eagle" | "pingcode">;
type ViewMode = "list" | "cards";

const COLUMN_LABEL_KEYS: Record<DevkitColumnId, MessageKey> = {
	code: "panels.devkit.col.code",
	itemType: "panels.devkit.col.itemType",
	status: "panels.devkit.col.status",
	title: "panels.devkit.col.title",
	priority: "panels.devkit.col.priority",
};

const COLUMN_WIDTHS: Record<DevkitColumnId, string> = {
	code: "w-[30%]",
	itemType: "w-[10%]",
	status: "w-[15%]",
	title: "w-auto",
	priority: "w-[10%]",
};

export function DevkitTasksPane({ platform }: { platform: TaskPlatform }) {
	const t = useT();
	const state = useSyncExternalStore(
		devkitStore.subscribe,
		devkitStore.snapshot,
		devkitStore.snapshot,
	);
	const snapshot = state.tasksByPlatform[platform] ?? null;
	const [prefs, setPrefs] = useState<DevkitTablePrefs>(() => loadDevkitTablePrefs(platform));
	const [mode, setMode] = useState<ViewMode>(() =>
		localStorage.getItem("thinkrail:devkit-view") === "cards" ? "cards" : "list",
	);

	const update = (patch: Partial<DevkitTablePrefs>) => {
		const next = { ...prefs, ...patch };
		setPrefs(next);
		saveDevkitTablePrefs(platform, next);
	};

	const tasks = snapshot?.tasks ?? [];
	const visible = snapshot ? applyDevkitTaskView(tasks, prefs) : [];
	const filtering = hasActiveDevkitFilter(prefs);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<DevkitSnapshotHeader
				platform={platform}
				visible={visible.length}
				total={tasks.length}
				filtering={filtering}
			/>
			<div className="flex items-center gap-4 px-8 py-4">
				<DevkitStatusFilter
					platform={platform}
					prefs={prefs}
					options={devkitStatusOptions(tasks)}
					onChange={(statusFilter) => update({ statusFilter })}
				/>
				<DevkitSearchInput
					platform={platform}
					value={prefs.search}
					onChange={(search) => update({ search })}
				/>
				{filtering ? (
					<IconButton
						variant="ghost"
						size="s"
						icon={ClearFilter}
						label={t("panels.devkit.filter.clear")}
						data-testid={`devkit-clear-filter-${platform}`}
						onClick={() => update({ statusFilter: [], search: "" })}
					/>
				) : null}
				<span className="min-w-8 flex-1" />
				<IconButton
					variant="ghost"
					size="s"
					icon={RiTextWrap}
					label={t("panels.devkit.wrap")}
					selected={prefs.wrap}
					data-testid={`devkit-wrap-${platform}`}
					onClick={() => update({ wrap: !prefs.wrap })}
				/>
				<IconButton
					variant="ghost"
					size="s"
					icon={RiListSettingsLine}
					label={t("panels.devkit.viewList")}
					selected={mode === "list"}
					data-testid={`devkit-view-list-${platform}`}
					onClick={() => {
						setMode("list");
						localStorage.setItem("thinkrail:devkit-view", "list");
					}}
				/>
				<IconButton
					variant="ghost"
					size="s"
					icon={RiLayoutGridLine}
					label={t("panels.devkit.viewCards")}
					selected={mode === "cards"}
					data-testid={`devkit-view-cards-${platform}`}
					onClick={() => {
						setMode("cards");
						localStorage.setItem("thinkrail:devkit-view", "cards");
					}}
				/>
			</div>
			{snapshot?.error ? (
				<p
					data-testid={`devkit-error-${platform}`}
					className="px-8 py-4 tr-text-ui text-feedback-error"
				>
					{snapshot.needsLogin
						? t("panels.devkit.loginRequired")
						: snapshot.cliMissing
							? t("panels.devkit.cliMissing")
							: snapshot.error}
				</p>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto p-8">
				{!snapshot ? (
					<p className="tr-text-ui text-text-subtle">{t("panels.devkit.loading")}</p>
				) : tasks.length === 0 ? (
					<div className="flex h-full items-center justify-center">
						<p className="tr-text-ui text-text-subtle">{t("panels.devkit.empty")}</p>
					</div>
				) : visible.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-8">
						<p className="tr-text-ui text-text-subtle">{t("panels.devkit.noMatches")}</p>
						<Button
							variant="outline"
							size="s"
							data-testid={`devkit-clear-filter-inline-${platform}`}
							onClick={() => update({ statusFilter: [], search: "" })}
						>
							{t("panels.devkit.filter.clear")}
						</Button>
					</div>
				) : mode === "cards" ? (
					<ul data-testid={`devkit-cards-${platform}`} className="grid grid-cols-2 gap-8">
						{visible.map((task) => (
							<DevkitTaskCard key={task.id} task={task} />
						))}
					</ul>
				) : (
					<DevkitTaskTable platform={platform} prefs={prefs} tasks={visible} onUpdate={update} />
				)}
			</div>
		</div>
	);
}

function DevkitSnapshotHeader({
	platform,
	visible,
	total,
	filtering,
}: {
	platform: TaskPlatform;
	visible: number;
	total: number;
	filtering: boolean;
}) {
	const t = useT();
	const state = useSyncExternalStore(
		devkitStore.subscribe,
		devkitStore.snapshot,
		devkitStore.snapshot,
	);
	const snapshot = state.tasksByPlatform[platform] ?? null;
	const fetchedAt = snapshot?.fetchedAt ?? null;
	return (
		<div className="flex items-center gap-8 px-8 py-4 text-text-subtle">
			<span className="tr-text-metadata" data-testid={`devkit-count-${platform}`}>
				{filtering
					? t("panels.devkit.taskCountFiltered", { shown: visible, total })
					: t("panels.devkit.taskCount", { count: visible })}
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

function DevkitStatusFilter({
	platform,
	prefs,
	options,
	onChange,
}: {
	platform: TaskPlatform;
	prefs: DevkitTablePrefs;
	options: readonly string[];
	onChange: (statusFilter: string[]) => void;
}) {
	const t = useT();
	const label =
		prefs.statusFilter.length === 0
			? `${t("panels.devkit.filter.status")}: ${t("panels.devkit.filter.statusAll")}`
			: `${t("panels.devkit.filter.status")}: ${prefs.statusFilter.length}`;
	if (options.length === 0) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="s"
					data-testid={`devkit-status-filter-${platform}`}
					selected={prefs.statusFilter.length > 0}
				>
					{label}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				{options.map((status) => {
					const selected = prefs.statusFilter.includes(status);
					return (
						<DropdownMenuItem
							key={status}
							data-testid={`devkit-status-option-${platform}`}
							data-selected={selected ? "true" : undefined}
							onSelect={() => {
								onChange(
									selected
										? prefs.statusFilter.filter((value) => value !== status)
										: [...prefs.statusFilter, status],
								);
							}}
						>
							{selected ? (
								<Check className="size-12 shrink-0" />
							) : (
								<span className="size-12 shrink-0" />
							)}
							{status}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function DevkitSearchInput({
	platform,
	value,
	onChange,
}: {
	platform: TaskPlatform;
	value: string;
	onChange: (search: string) => void;
}) {
	const t = useT();
	return (
		<label className="relative flex min-w-0 flex-1 items-center">
			<Search className="pointer-events-none absolute left-8 size-12 text-text-subtle" />
			<input
				type="text"
				value={value}
				data-testid={`devkit-search-${platform}`}
				placeholder={t("panels.devkit.filter.searchPlaceholder")}
				onChange={(event) => onChange(event.target.value)}
				className="h-28 w-full rounded-sm border border-border-default bg-container-workspace-bg pl-24 pr-8 tr-text-ui text-text-default"
			/>
		</label>
	);
}

function DevkitTaskTable({
	platform,
	prefs,
	tasks,
	onUpdate,
}: {
	platform: TaskPlatform;
	prefs: DevkitTablePrefs;
	tasks: readonly DevkitTask[];
	onUpdate: (patch: Partial<DevkitTablePrefs>) => void;
}) {
	const t = useT();
	const dragIndex = useRef<number | null>(null);
	const [dropIndex, setDropIndex] = useState<number | null>(null);
	const cellClass = prefs.wrap
		? "px-8 py-4 align-top whitespace-normal break-words"
		: "truncate px-8 py-4";
	return (
		<table data-testid={`devkit-list-${platform}`} className="w-full table-fixed">
			<thead>
				<tr>
					{prefs.columns.map((column, index) => {
						const sorted = prefs.sort?.column === column ? prefs.sort : null;
						const dropHint = dropIndex === index && dragIndex.current !== index;
						return (
							<th
								key={column}
								scope="col"
								draggable
								data-testid={`devkit-col-${column}`}
								data-drop-hint={dropHint || undefined}
								className={cn(
									"sticky top-0 z-10 select-none border-b border-border-default bg-container-workspace-bg text-left tr-text-metadata text-text-subtle",
									COLUMN_WIDTHS[column],
									dropHint && "border-l-2 border-l-primary",
								)}
								onDragStart={(event) => {
									dragIndex.current = index;
									event.dataTransfer.effectAllowed = "move";
								}}
								onDragOver={(event) => {
									event.preventDefault();
									setDropIndex(index);
								}}
								onDrop={(event) => {
									event.preventDefault();
									const from = dragIndex.current;
									if (from !== null) {
										onUpdate({ columns: reorderDevkitColumns(prefs.columns, from, index) });
									}
									dragIndex.current = null;
									setDropIndex(null);
								}}
								onDragEnd={() => {
									dragIndex.current = null;
									setDropIndex(null);
								}}
							>
								<button
									type="button"
									aria-label={t("panels.devkit.table.sortAria", {
										column: t(COLUMN_LABEL_KEYS[column]),
									})}
									onClick={() => onUpdate({ sort: nextDevkitSort(prefs.sort, column) })}
									className="flex w-full items-center gap-2 py-4 text-left hover:text-text-default"
								>
									{t(COLUMN_LABEL_KEYS[column])}
									{sorted ? (
										sorted.dir === "asc" ? (
											<ArrowUp className="size-12 shrink-0" />
										) : (
											<ArrowDown className="size-12 shrink-0" />
										)
									) : null}
								</button>
							</th>
						);
					})}
				</tr>
			</thead>
			<tbody>
				{tasks.map((task) => (
					<tr
						key={task.id}
						data-testid="devkit-task"
						data-code={task.code}
						className="hover:bg-control-bg-hovered"
					>
						{prefs.columns.map((column) => (
							<td key={column} className={cn("border-b border-border-default", cellClass)}>
								{renderCell(task, column)}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

function renderCell(task: DevkitTask, column: DevkitColumnId) {
	switch (column) {
		case "code":
			return <span className="tr-code-text text-text-default">{task.code}</span>;
		case "itemType":
			return <span className="tr-text-metadata text-text-subtle">{task.itemType}</span>;
		case "status":
			return <DevkitStatusBadge status={task.status} />;
		case "title":
			return <span className="tr-text-ui text-text-default">{task.title}</span>;
		case "priority":
			return task.priority ? (
				<span className="tr-text-metadata text-text-muted">{task.priority}</span>
			) : null;
	}
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
					? "inline-block max-w-full truncate rounded-full bg-primary-subtle px-8 tr-text-label-pill text-text-default"
					: kind === "done"
						? "inline-block max-w-full truncate rounded-full bg-feedback-success-subtle px-8 tr-text-label-pill text-feedback-success"
						: kind === "pending"
							? "inline-block max-w-full truncate rounded-full bg-feedback-warning-subtle px-8 tr-text-label-pill text-text-default"
							: "inline-block max-w-full truncate rounded-full bg-control-bg px-8 tr-text-label-pill text-text-subtle"
			}
		>
			{status}
		</span>
	);
}
