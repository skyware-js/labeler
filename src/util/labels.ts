import type { ComAtprotoLabelDefs } from "@atproto/api";
import type { SignedLabel, StrictPartial } from "./types.js";
import { encode as cborEncode } from "@atcute/cbor";
import type { Keypair } from "@atproto/crypto";

const LABEL_VERSION = 1;

export function formatLabel<T extends ComAtprotoLabelDefs.Label>(label: T): StrictPartial<T> {
	const { src, uri, cid, val, neg, cts, exp } = label;
	return {
		ver: LABEL_VERSION,
		src,
		uri,
		...(cid ? { cid } : {}),
		val,
		...(!!neg ? { neg } : {}),
		cts,
		...(exp ? { exp } : {}),
	} as never;
}

export async function signLabel(label: ComAtprotoLabelDefs.Label, signingKey: Keypair): Promise<SignedLabel> {
	const toSign = formatLabel(label);
	const bytes = cborEncode(toSign);
	const sig = await signingKey.sign(bytes);
	return { ...toSign, sig };
}

export function labelIsSigned<T extends ComAtprotoLabelDefs.Label>(
	label: T,
): label is T & { sig: Uint8Array } {
	return label.sig !== undefined;
}

export function assertLabelIsSigned<T extends ComAtprotoLabelDefs.Label>(
	label: T,
): asserts label is T & { sig: Uint8Array } {
	if (!label.sig) throw new Error("Label is not signed");
}
