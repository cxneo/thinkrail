import type { DevkitPush } from "@thinkrail/contracts";

type DevkitPublisher = (push: DevkitPush) => void;

let publish: DevkitPublisher | null = null;

/** The publisher-injection seam: `host` installs the WS broadcast at
 * createServer; feature code never imports `host`. */
export function setDevkitPublisher(fn: DevkitPublisher | null): void {
	publish = fn;
}

export function publishDevkitPush(push: DevkitPush): void {
	publish?.(push);
}
