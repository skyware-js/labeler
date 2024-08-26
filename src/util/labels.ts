import { encode as cborEncode } from "@atcute/cbor";
import type { ComAtprotoLabelDefs } from "@atproto/api";
import type { Keypair } from "@atproto/crypto";
import type { SignedLabel, StrictPartial } from "./types.js";

const LABEL_VERSION = 1;

export function formatLabel(
	label: ComAtprotoLabelDefs.Label,
): StrictPartial<ComAtprotoLabelDefs.Label> {
	const { src, uri, cid, val, neg, cts, exp } = label;
	return {
		ver: LABEL_VERSION,
		src,
		uri,
		...(cid ? { cid } : {}),
		val,
		neg,
		cts,
		...(exp ? { exp } : {}),
	} as never;
}

export async function signLabel(
	label: ComAtprotoLabelDefs.Label,
	signingKey: Keypair,
): Promise<SignedLabel> {
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
