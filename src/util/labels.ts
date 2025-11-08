import { type Bytes, encode as cborEncode, fromBytes, toBytes } from "@atcute/cbor";
import { isBytes } from "@atcute/lexicons/interfaces";
import { k256Sign } from "./crypto.js";
import type { FormattedLabel, Label, SignedLabel, UnsignedLabel } from "./types.js";
import { excludeNullish } from "./util.js";

const LABEL_VERSION = 1;

function formatLabelCbor(label: UnsignedLabel): UnsignedLabel {
	return excludeNullish({ ...label, ver: LABEL_VERSION, neg: !!label.neg });
}

export type Signature = ArrayBuffer | Uint8Array | Bytes;

function sigToBytes(sig?: Signature): Bytes | null {
	if (isBytes(sig)) {
		return sig;
	}
	if (sig instanceof ArrayBuffer) {
		return toBytes(new Uint8Array(sig));
	}
	if (sig instanceof Uint8Array) {
		return toBytes(sig);
	}
	return null;
}

export function formatLabel(label: UnsignedLabel & { sig?: Signature }): FormattedLabel {
	const sig = sigToBytes(label.sig);
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

export function toSignedLabel(label: UnsignedLabel, signingKey: Uint8Array): SignedLabel {
	if ("sig" in label) {
		let signature: Uint8Array;
		if (label.sig && isBytes(label.sig)) {
			signature = fromBytes(label.sig);
		} else if (label.sig instanceof ArrayBuffer) {
			signature = new Uint8Array(label.sig);
		} else if (label.sig instanceof Uint8Array) {
			signature = label.sig;
		} else {
			throw new Error("Unknown label signature");
		}
		return { ...label, sig: signature };
	} else {
		return signLabel(label, signingKey);
	}
}

export function labelIsSigned<T extends Label>(label: T): label is T & SignedLabel {
	return "sig" in label && label.sig !== undefined;
}
