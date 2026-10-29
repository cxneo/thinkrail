import type { DevkitPlatform } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useState, useSyncExternalStore } from "react";
import { devkitStore, saveDevkitSettings } from "./devkitClient";

type PlatformDraft = {
	username: string;
	password: string;
	defaultProject: string;
	cron: string;
};

const PLATFORM_LABEL_KEYS: Record<DevkitPlatform, MessageKey> = {
	eagle: "panels.devkit.platform.eagle",
	pingcode: "panels.devkit.platform.pingcode",
	jenkins: "panels.devkit.platform.jenkins",
};

const HAS_CRON: Record<DevkitPlatform, boolean> = {
	eagle: true,
	pingcode: true,
	jenkins: false,
};

const HAS_PROJECT: Record<DevkitPlatform, boolean> = {
	eagle: false,
	pingcode: true,
	jenkins: false,
};

export function DevkitSettingsPane() {
	const t = useT();
	const state = useSyncExternalStore(
		devkitStore.subscribe,
		devkitStore.snapshot,
		devkitStore.snapshot,
	);
	const view = state.settings;
	const [drafts, setDrafts] = useState<Partial<Record<DevkitPlatform, PlatformDraft>>>({});
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState<string | null>(null);

	const draftFor = (platform: DevkitPlatform): PlatformDraft => {
		const existing = drafts[platform];
		if (existing) return existing;
		const settings = view?.[platform];
		return {
			username: settings?.username ?? "",
			password: "",
			defaultProject: settings?.defaultProject ?? "",
			cron: settings?.cron ?? "*/10 * * * *",
		};
	};

	const updateDraft = (platform: DevkitPlatform, patch: Partial<PlatformDraft>) => {
		setDrafts((current) => ({ ...current, [platform]: { ...draftFor(platform), ...patch } }));
		setSaved(null);
	};

	const save = (platform: DevkitPlatform) => {
		const draft = drafts[platform];
		if (!draft) return;
		setSaving(true);
		void saveDevkitSettings({ [platform]: draft }).then((next) => {
			setSaving(false);
			if (next) {
				setSaved(platform);
				setDrafts((current) => {
					const rest = { ...current };
					delete rest[platform];
					return rest;
				});
			}
		});
	};

	const platforms: DevkitPlatform[] = ["eagle", "pingcode", "jenkins"];

	return (
		<div className="h-full overflow-auto p-12" data-testid="devkit-settings">
			<p className="mb-12 tr-text-metadata text-text-subtle">{t("panels.devkit.settings.intro")}</p>
			{!view ? (
				<p className="tr-text-ui text-text-subtle">{t("panels.devkit.loading")}</p>
			) : (
				<div className="flex flex-col gap-12">
					{platforms.map((platform) => {
						const draft = draftFor(platform);
						const settings = view[platform];
						return (
							<section
								key={platform}
								data-testid={`devkit-settings-${platform}`}
								className="flex flex-col gap-8 rounded-sm border border-border-default p-12"
							>
								<h3 className="tr-text-ui text-text-default">{t(PLATFORM_LABEL_KEYS[platform])}</h3>
								<label className="flex flex-col gap-4">
									<span className="tr-text-metadata text-text-subtle">
										{t("panels.devkit.settings.username")}
									</span>
									<input
										type="text"
										value={draft.username}
										data-testid={`devkit-username-${platform}`}
										onChange={(event) => updateDraft(platform, { username: event.target.value })}
										className="h-32 rounded-sm border border-border-default bg-container-workspace-bg px-8 tr-code-text text-text-default"
									/>
								</label>
								<label className="flex flex-col gap-4">
									<span className="tr-text-metadata text-text-subtle">
										{settings?.hasPassword
											? t("panels.devkit.settings.passwordStored")
											: t("panels.devkit.settings.password")}
									</span>
									<input
										type="password"
										value={draft.password}
										data-testid={`devkit-password-${platform}`}
										placeholder={settings?.hasPassword ? "••••••••" : undefined}
										onChange={(event) => updateDraft(platform, { password: event.target.value })}
										className="h-32 rounded-sm border border-border-default bg-container-workspace-bg px-8 tr-code-text text-text-default"
									/>
								</label>
								{HAS_PROJECT[platform] ? (
									<label className="flex flex-col gap-4">
										<span className="tr-text-metadata text-text-subtle">
											{t("panels.devkit.settings.defaultProject")}
										</span>
										<input
											type="text"
											value={draft.defaultProject}
											data-testid={`devkit-project-${platform}`}
											placeholder={
												platform === "pingcode"
													? t("panels.devkit.settings.projectPlaceholder")
													: undefined
											}
											onChange={(event) =>
												updateDraft(platform, { defaultProject: event.target.value })
											}
											className="h-32 rounded-sm border border-border-default bg-container-workspace-bg px-8 tr-code-text text-text-default"
										/>
									</label>
								) : null}
								{HAS_CRON[platform] ? (
									<label className="flex flex-col gap-4">
										<span className="tr-text-metadata text-text-subtle">
											{t("panels.devkit.settings.cron")}
										</span>
										<input
											type="text"
											value={draft.cron}
											data-testid={`devkit-cron-${platform}`}
											placeholder="*/10 * * * *"
											onChange={(event) => updateDraft(platform, { cron: event.target.value })}
											className="h-32 rounded-sm border border-border-default bg-container-workspace-bg px-8 tr-code-text text-text-default"
										/>
										<span className="tr-text-metadata text-text-muted">
											{t("panels.devkit.settings.cronHint")}
										</span>
									</label>
								) : null}
								<div className="flex items-center gap-8">
									<Button
										variant="outline"
										size="s"
										disabled={saving}
										data-testid={`devkit-save-${platform}`}
										onClick={() => save(platform)}
									>
										{t("panels.devkit.settings.save")}
									</Button>
									{saved === platform ? (
										<span className="tr-text-metadata text-feedback-success">
											{t("panels.devkit.settings.saved")}
										</span>
									) : null}
								</div>
							</section>
						);
					})}
				</div>
			)}
		</div>
	);
}
