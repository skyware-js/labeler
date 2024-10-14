import { encode as cborEncode } from "@atcute/cbor";
import type { At } from "@atcute/client/lexicons";
import { toString as ui8ToString } from "uint8arrays";
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
		? { $bytes: ui8ToString(new Uint8Array(label.sig), "base64") }
		: label.sig instanceof Uint8Array
		? { $bytes: ui8ToString(label.sig, "base64") }
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
