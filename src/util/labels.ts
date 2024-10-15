import { encode as cborEncode, toBytes } from "@atcute/cbor";
import type { At } from "@atcute/client/lexicons";
import { k256Sign } from "./crypto.js";
import type { FormattedLabel, SignedLabel, UnsignedLabel } from "./types.js";
import { excludeNullish } from "./util.js";

const LABEL_VERSION = 1;

function formatLabelCbor(label: UnsignedLabel): UnsignedLabel {
	return excludeNullish({ ...label, ver: LABEL_VERSION, neg: !!label.neg });
}

export function formatLabel(
	label: UnsignedLabel & { sig?: ArrayBuffer | Uint8Array | At.Bytes },
): FormattedLabel {
	const sig = label.sig instanceof ArrayBuffer
		? toBytes(new Uint8Array(label.sig))
		: label.sig instanceof Uint8Array
		? toBytes(label.sig)
		: label.sig;
	if (!sig || !("$bytes" in sig)) {
		throw new Error("Expected sig to be an object with base64 $bytes, got " + sig);
	}
	return excludeNullish({ ...label, ver: LABEL_VERSION, neg: !!label.neg, sig });
}

export function signLabel(label: UnsignedLabel, signingKey: Uint8Array): SignedLabel {
	const toSign = formatLabelCbor(label);
	const bytes = cborEncode(toSign);
	const sig = k256Sign(signingKey, bytes);
	return { ...toSign, sig };
}

export function labelIsSigned<T extends UnsignedLabel>(label: T): label is T & SignedLabel {
	return "sig" in label && label.sig !== undefined;
}
