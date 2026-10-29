import { useT } from "@thinkrail/locales/react";

/** Placeholder for future devkit surfaces (doctor, network diagnostics,
 * defect-resolution drafts). Intentionally minimal. */
export function DevkitMorePane() {
	const t = useT();
	return (
		<div className="flex h-full items-center justify-center p-16" data-testid="devkit-more">
			<p className="tr-text-ui text-text-subtle">{t("panels.devkit.more.placeholder")}</p>
		</div>
	);
}
