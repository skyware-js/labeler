import { encode as cborEncode } from "@atcute/cbor";
import { k256Sign } from "./crypto.js";
import type { Label, SignedLabel } from "./types.js";
import { excludeNullish } from "./util.js";

const LABEL_VERSION = 1;

export function formatLabel(label: Label): Label {
	return excludeNullish({ ...label, ver: LABEL_VERSION, neg: !!label.neg });
}

export function signLabel(label: Label, signingKey: Uint8Array): SignedLabel {
	const toSign = formatLabel(label);
	const bytes = cborEncode(toSign);
	const sig = k256Sign(signingKey, bytes);
	return { ...toSign, sig };
}

export function labelIsSigned<T extends Label>(label: T): label is T & { sig: Uint8Array } {
	return "sig" in label && label.sig !== undefined;
}
