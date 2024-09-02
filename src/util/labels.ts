import { encode as cborEncode } from "@atcute/cbor";
import type { ComAtprotoLabelDefs } from "@atproto/api";
import type { Keypair } from "@atproto/crypto";
import type { SignedLabel } from "./types.js";
import { excludeUndefined } from "./util.js";

const LABEL_VERSION = 1;

export function formatLabel(label: ComAtprotoLabelDefs.Label): ComAtprotoLabelDefs.Label {
	return excludeUndefined({ ...label, ver: LABEL_VERSION, neg: !!label.neg });
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
