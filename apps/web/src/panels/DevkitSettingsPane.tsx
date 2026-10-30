import { RiPencilLine as Pencil } from "@remixicon/react";
import type { DevkitPlatform } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { useSyncExternalStore } from "react";
import {
	devkitDraft,
	devkitSaveFeedback,
	devkitStore,
	discardDevkitDraft,
	draftFromView,
	isDevkitEditing,
	markDevkitSave,
	saveDevkitSettings,
	setDevkitEditing,
	updateDevkitDraft,
} from "./devkitClient";

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

const INPUT_CLASS =
	"h-32 w-full rounded-sm border border-border-default bg-container-workspace-bg px-8 tr-code-text text-text-default disabled:border-transparent disabled:bg-transparent disabled:px-0 disabled:text-text-muted";

export function DevkitSettingsPane() {
	const t = useT();
	const state = useSyncExternalStore(
		devkitStore.subscribe,
		devkitStore.snapshot,
		devkitStore.snapshot,
	);
	const view = state.settings;
	const platforms: DevkitPlatform[] = ["eagle", "pingcode", "jenkins"];

	return (
		<div className="h-full overflow-auto p-12" data-testid="devkit-settings">
			<p className="mb-12 tr-text-metadata text-text-subtle">{t("panels.devkit.settings.intro")}</p>
			{!view ? (
				<p className="tr-text-ui text-text-subtle">{t("panels.devkit.loading")}</p>
			) : (
				<div className="flex flex-col gap-12">
					{platforms.map((platform) => (
						<DevkitPlatformCard key={platform} platform={platform} />
					))}
				</div>
			)}
		</div>
	);
}

function DevkitPlatformCard({ platform }: { platform: DevkitPlatform }) {
	const t = useT();
	const editing = isDevkitEditing(platform);
	const draft = devkitDraft(platform) ?? draftFromView(platform);
	const feedback = devkitSaveFeedback(platform);
	const saving = feedback?.saving === true;
	const saved = feedback?.saved === true;

	const update = (patch: Partial<typeof draft>) => updateDevkitDraft(platform, patch);

	const save = () => {
		markDevkitSave(platform, { saving: true, saved: false });
		void saveDevkitSettings({ [platform]: draft }).then((next) => {
			markDevkitSave(platform, { saving: false, saved: next !== null });
			if (next) {
				setDevkitEditing(platform, false);
				discardDevkitDraft(platform);
			}
		});
	};

	const cancel = () => {
		discardDevkitDraft(platform);
		setDevkitEditing(platform, false);
	};

	return (
		<section
			data-testid={`devkit-settings-${platform}`}
			className="flex flex-col gap-8 rounded-sm border border-border-default p-12"
		>
			<div className="flex items-center gap-8">
				<h3 className="tr-text-ui text-text-default">{t(PLATFORM_LABEL_KEYS[platform])}</h3>
				<span className="min-w-8 flex-1" />
				{saved ? (
					<span className="tr-text-metadata text-feedback-success">
						{t("panels.devkit.settings.saved")}
					</span>
				) : null}
				{!editing ? (
					<IconButton
						variant="ghost"
						size="s"
						icon={Pencil}
						label={t("panels.devkit.settings.edit")}
						data-testid={`devkit-edit-${platform}`}
						onClick={() => setDevkitEditing(platform, true)}
					/>
				) : null}
			</div>
			<label className="flex flex-col gap-4">
				<span className="tr-text-metadata text-text-subtle">
					{t("panels.devkit.settings.username")}
				</span>
				<input
					type="text"
					value={draft.username}
					disabled={!editing}
					data-testid={`devkit-username-${platform}`}
					onChange={(event) => update({ username: event.target.value })}
					className={INPUT_CLASS}
				/>
			</label>
			<label className="flex flex-col gap-4">
				<span className="tr-text-metadata text-text-subtle">
					{t("panels.devkit.settings.password")}
				</span>
				{/* Deliberately type="text": the fork owner declared these credentials
				non-sensitive and asked for plaintext display (see the devkit spec). */}
				<input
					type="text"
					value={draft.password}
					disabled={!editing}
					data-testid={`devkit-password-${platform}`}
					onChange={(event) => update({ password: event.target.value })}
					className={INPUT_CLASS}
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
						disabled={!editing}
						data-testid={`devkit-project-${platform}`}
						placeholder={
							platform === "pingcode" ? t("panels.devkit.settings.projectPlaceholder") : undefined
						}
						onChange={(event) => update({ defaultProject: event.target.value })}
						className={INPUT_CLASS}
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
						disabled={!editing}
						data-testid={`devkit-cron-${platform}`}
						placeholder="*/10 * * * *"
						onChange={(event) => update({ cron: event.target.value })}
						className={INPUT_CLASS}
					/>
					{editing ? (
						<span className="tr-text-metadata text-text-muted">
							{t("panels.devkit.settings.cronHint")}
						</span>
					) : null}
				</label>
			) : null}
			{editing ? (
				<div className="flex items-center gap-8">
					<Button
						variant="outline"
						size="s"
						disabled={saving}
						data-testid={`devkit-save-${platform}`}
						onClick={save}
					>
						{t("panels.devkit.settings.save")}
					</Button>
					<Button
						variant="ghost"
						size="s"
						disabled={saving}
						data-testid={`devkit-cancel-${platform}`}
						onClick={cancel}
					>
						{t("panels.devkit.settings.cancel")}
					</Button>
				</div>
			) : (
				<p className="tr-text-metadata text-text-muted">{t("panels.devkit.settings.lockedHint")}</p>
			)}
		</section>
	);
}
