import { RiRefreshLine as Refresh } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useCallback, useState, useSyncExternalStore } from "react";
import { useAppStore } from "../store";
import { supportsDevkit } from "../transport";
import { DevkitJenkinsPane } from "./DevkitJenkinsPane";
import { DevkitMorePane } from "./DevkitMorePane";
import { DevkitSettingsPane } from "./DevkitSettingsPane";
import { DevkitTasksPane } from "./DevkitTasksPane";
import { devkitStore, ensureDevkitLoaded, refreshDevkit } from "./devkitClient";

export type DevkitTab = "pingcode" | "eagle" | "jenkins" | "more" | "settings";

const TAB_STORAGE_KEY = "thinkrail:devkit-tab";

function loadTab(): DevkitTab {
	const stored = localStorage.getItem(TAB_STORAGE_KEY);
	if (
		stored === "pingcode" ||
		stored === "eagle" ||
		stored === "jenkins" ||
		stored === "more" ||
		stored === "settings"
	) {
		return stored;
	}
	return "eagle";
}

function saveTab(tab: DevkitTab): void {
	localStorage.setItem(TAB_STORAGE_KEY, tab);
}

export function DevkitPanel({ workspaceId }: { workspaceId: string }) {
	useSyncExternalStore(devkitStore.subscribe, devkitStore.snapshot, devkitStore.snapshot);
	ensureDevkitLoaded();
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const supported = supportsDevkit(protocolVersion);
	const [tab, setTab] = useState<DevkitTab>(loadTab);
	const select = useCallback((next: DevkitTab) => {
		setTab(next);
		saveTab(next);
	}, []);
	const active: DevkitTab = supported ? tab : "settings";
	const taskTab = active === "eagle" || active === "pingcode" ? active : null;

	return (
		<div data-testid="devkit-panel" className="flex h-full min-h-0 flex-col">
			<div className="flex items-center gap-4 border-b border-border-default px-8 py-4">
				<DevkitTabBar active={active} onSelect={select} />
				<span className="min-w-8 flex-1" />
				{taskTab ? <DevkitRefreshButton platform={taskTab} /> : null}
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">
				{!supported ? <DevkitUnsupported /> : null}
				{supported && taskTab ? <DevkitTasksPane platform={taskTab} /> : null}
				{supported && active === "jenkins" ? (
					<DevkitJenkinsPane workspaceId={workspaceId} onOpenSettings={() => select("settings")} />
				) : null}
				{supported && active === "more" ? <DevkitMorePane /> : null}
				{active === "settings" ? <DevkitSettingsPane /> : null}
			</div>
		</div>
	);
}

function DevkitTabBar({
	active,
	onSelect,
}: {
	active: DevkitTab;
	onSelect: (tab: DevkitTab) => void;
}) {
	const t = useT();
	const tabs: Array<{ id: DevkitTab; label: string }> = [
		{ id: "eagle", label: t("panels.devkit.tab.eagle") },
		{ id: "pingcode", label: t("panels.devkit.tab.pingcode") },
		{ id: "jenkins", label: t("panels.devkit.tab.jenkins") },
		{ id: "more", label: t("panels.devkit.tab.more") },
		{ id: "settings", label: t("panels.devkit.tab.settings") },
	];
	return (
		<div role="tablist" aria-label={t("panels.devkit.tabList")} className="flex items-center gap-2">
			{tabs.map((tab) => {
				const selected = tab.id === active;
				return (
					<button
						key={tab.id}
						type="button"
						role="tab"
						aria-selected={selected}
						data-testid={`devkit-tab-${tab.id}`}
						onClick={() => onSelect(tab.id)}
						className={
							selected
								? "border-b-2 border-primary px-4 py-4 tr-text-ui text-text-default"
								: "border-b-2 border-transparent px-4 py-4 tr-text-ui text-text-subtle hover:text-text-default"
						}
					>
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}

function DevkitRefreshButton({ platform }: { platform: "eagle" | "pingcode" }) {
	const t = useT();
	const state = useSyncExternalStore(
		devkitStore.subscribe,
		devkitStore.snapshot,
		devkitStore.snapshot,
	);
	const fetching = state.tasksByPlatform[platform]?.fetching === true;
	return (
		<IconButton
			variant="ghost"
			size="s"
			icon={Refresh}
			label={t("panels.devkit.refresh")}
			spinIcon={fetching}
			disabled={fetching}
			data-testid={`devkit-refresh-${platform}`}
			onClick={() => void refreshDevkit(platform)}
		/>
	);
}

function DevkitUnsupported() {
	const t = useT();
	return (
		<div className="flex h-full items-center justify-center p-16">
			<p className="tr-text-ui text-text-muted">{t("panels.devkit.unsupported")}</p>
		</div>
	);
}
