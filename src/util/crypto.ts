import { XRPCError } from "@atcute/client";
import type { DidDocument } from "@atcute/client/utils/did";
import { p256 } from "@noble/curves/p256";
import { secp256k1 as k256 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import * as ui8 from "uint8arrays";

const P256_DID_PREFIX = new Uint8Array([0x80, 0x24]);
const SECP256K1_DID_PREFIX = new Uint8Array([0xe7, 0x01]);
const BASE58_MULTIBASE_PREFIX = "z";
const DID_KEY_PREFIX = "did:key:";

export const P256_JWT_ALG = "ES256";
export const SECP256K1_JWT_ALG = "ES256K";

const didToSigningKeyCache = new Map<string, { key: string; expires: number }>();

/**
 * Resolves the atproto signing key for a DID.
 * @param did The DID to resolve.
 * @param forceRefresh Whether to skip the cache and always resolve the DID.
 * @returns The resolved signing key.
 */
export async function resolveDidToSigningKey(did: string, forceRefresh?: boolean): Promise<string> {
	if (!forceRefresh) {
		const cached = didToSigningKeyCache.get(did);
		if (cached) {
			const now = Date.now();
			if (now < cached.expires) {
				return cached.key;
			}
			didToSigningKeyCache.delete(did);
		}
	}

	const [, didMethod, ...didValueParts] = did.split(":");

	let didKey: string | undefined = undefined;
	if (didMethod === "plc") {
		const res = await fetch(`https:/plc.directory/${encodeURIComponent(did)}`, {
			headers: { accept: "application/json" },
		});
		if (!res.ok) throw new Error(`Could not resolve DID: ${did}`);

		didKey = parseKeyFromDidDocument(await res.json() as never, did);
	} else if (didMethod === "web") {
		if (!didValueParts.length) throw new Error(`Poorly formatted DID: ${did}`);
		if (didValueParts.length > 1) throw new Error(`Unsupported did:web paths: ${did}`);
		const didValue = didValueParts[0];

		const res = await fetch(`https://${didValue}/.well-known/did.json`, {
			headers: { accept: "application/json" },
		});
		if (!res.ok) throw new Error(`Could not resolve DID: ${did}`);

		didKey = parseKeyFromDidDocument(await res.json() as never, did);
	}

	if (!didKey) throw new Error(`Could not resolve DID: ${did}`);
	didToSigningKeyCache.set(did, { key: didKey, expires: Date.now() + 60 * 60 * 1000 });
	return didKey;
}

/**
 * Verifies a JWT.
 * @param jwtStr The JWT to verify.
 * @param ownDid The DID of the service that is receiving the request.
 * @param lxm The lexicon method that is being called.
 * @returns The payload of the JWT.
 */
export async function verifyJwt(
	jwtStr: string,
	ownDid: string | null,
	lxm: string | null,
): Promise<{ iss: string; aud: string; exp: number; lxm?: string; jti?: string }> {
	const parts = jwtStr.split(".");
	if (parts.length !== 3) {
		throw new XRPCError(401, { kind: "BadJwt", description: "Poorly formatted JWT" });
	}
	const payload = parsePayload(parts[1]);
	const sig = parts[2];

	if (Date.now() / 1000 > payload.exp) {
		throw new XRPCError(401, { kind: "JwtExpired", description: "JWT expired" });
	}
	if (ownDid !== null && payload.aud !== ownDid) {
		throw new XRPCError(401, {
			kind: "BadJwtAudience",
			description: "JWT audience does not match service DID",
		});
	}
	if (lxm !== null && payload.lxm !== lxm) {
		throw new XRPCError(401, {
			kind: "BadJwtLexiconMethod",
			description: payload.lxm !== undefined
				? `Bad JWT lexicon method ("lxm"). Must match: ${lxm}`
				: `Missing JWT lexicon method ("lxm"). Must match: ${lxm}`,
		});
	}

	const msgBytes = ui8.fromString(parts.slice(0, 2).join("."), "utf8");
	const sigBytes = ui8.fromString(sig, "base64url");

	const signingKey = await resolveDidToSigningKey(payload.iss, false);

	let validSig: boolean;
	try {
		validSig = verifySignatureWithKey(signingKey, msgBytes, sigBytes);
	} catch (err) {
		throw new XRPCError(401, {
			kind: "BadJwtSignature",
			description: "Could not verify JWT signature",
		});
	}

	if (!validSig) {
		// get fresh signing key in case it failed due to a recent rotation
		const freshSigningKey = await resolveDidToSigningKey(payload.iss, true);
		try {
			validSig = freshSigningKey !== signingKey
				? verifySignatureWithKey(freshSigningKey, msgBytes, sigBytes)
				: false;
		} catch (err) {
			throw new XRPCError(401, {
				kind: "BadJwtSignature",
				description: "Could not verify JWT signature",
			});
		}
	}

	if (!validSig) {
		throw new XRPCError(401, {
			kind: "BadJwtSignature",
			description: "JWT signature does not match JWT issuer",
		});
	}

	return payload;
}

export function k256Sign(privateKey: Uint8Array, msg: Uint8Array): Uint8Array {
	const msgHash = sha256(msg);
	const sig = k256.sign(msgHash, privateKey, { lowS: true });
	return sig.toCompactRawBytes();
}

/**
 * Verifies a signature using a signing key in did:key format.
 * @param didKey The signing key to verify the signature with in did:key format.
 * @param msgBytes The message contents to verify.
 * @param sigBytes The signature to verify.
 */
function verifySignatureWithKey(didKey: string, msgBytes: Uint8Array, sigBytes: Uint8Array) {
	if (!didKey.startsWith("did:key:")) throw new Error("Incorrect prefix for did:key: " + didKey);
	const multikey = didKey.slice("did:key:".length);
	const { jwtAlg } = parseMultikey(multikey);
	const curve = jwtAlg === P256_JWT_ALG ? "p256" : "k256";
	return verifyDidSig(curve, didKey, msgBytes, sigBytes);
}

/**
 * Parses a DID document and extracts the atproto signing key.
 * @param doc The DID document to parse.
 * @param did The DID the document is for.
 * @returns The atproto signing key.
 */
const parseKeyFromDidDocument = (doc: DidDocument, did: string): string => {
	if (!Array.isArray(doc?.verificationMethod)) {
		throw new Error(`Could not parse signingKey from doc: ${JSON.stringify(doc)}`);
	}
	const key = doc.verificationMethod.find((method) =>
		method?.id === `${did}#atproto` || method?.id === `#atproto`
	);
	if (
		!key || typeof key !== "object" || !("type" in key) || typeof key.type !== "string"
		|| !("publicKeyMultibase" in key) || typeof key.publicKeyMultibase !== "string"
	) {
		throw new Error(`Could not resolve DID: ${did}`);
	}

	const keyBytes = multibaseToBytes(key.publicKeyMultibase);
	let didKey: string | undefined = undefined;
	if (key.type === "EcdsaSecp256r1VerificationKey2019") {
		didKey = formatDidKey(P256_JWT_ALG, keyBytes);
	} else if (key.type === "EcdsaSecp256k1VerificationKey2019") {
		didKey = formatDidKey(SECP256K1_JWT_ALG, keyBytes);
	} else if (key.type === "Multikey") {
		const parsed = parseMultikey(key.publicKeyMultibase);
		didKey = formatDidKey(parsed.jwtAlg, parsed.keyBytes);
	}
	if (!didKey) throw new Error(`Could not parse signingKey from doc: ${JSON.stringify(doc)}`);
	return didKey;
};

/**
 * Formats a pubkey in did:key format.
 * @param jwtAlg The JWT algorithm used by the signing key.
 * @param keyBytes The bytes of the pubkey.
 */
export const formatDidKey = (
	jwtAlg: typeof P256_JWT_ALG | typeof SECP256K1_JWT_ALG,
	keyBytes: Uint8Array,
): string => DID_KEY_PREFIX + formatMultikey(jwtAlg, keyBytes);

/**
 * Checks if a bytestring starts with a prefix.
 * @param bytes The bytestring to check.
 * @param prefix The prefix to check for.
 */
const hasPrefix = (bytes: Uint8Array, prefix: Uint8Array): boolean => {
	return ui8.equals(prefix, bytes.subarray(0, prefix.byteLength));
};

/**
 * Compresses a pubkey to be used in a did:key.
 * @param curve p256 (secp256r1) or k256 (secp256k1)
 * @param keyBytes The pubkey to compress.
 * @see https://medium.com/asecuritysite-when-bob-met-alice/02-03-or-04-so-what-are-compressed-and-uncompressed-public-keys-6abcb57efeb6
 */
const compressPubkey = (curve: "p256" | "k256", keyBytes: Uint8Array): Uint8Array => {
	const ProjectivePoint = curve === "p256" ? p256.ProjectivePoint : k256.ProjectivePoint;
	return ProjectivePoint.fromHex(keyBytes).toRawBytes(true);
};

/**
 * Decompresses a pubkey.
 * @param curve p256 (secp256r1) or k256 (secp256k1)
 * @param compressed The compressed pubkey to decompress.
 */
const decompressPubkey = (curve: "p256" | "k256", compressed: Uint8Array): Uint8Array => {
	if (compressed.length !== 33) {
		throw new Error("Incorrect compressed pubkey length: " + compressed.length);
	}
	const ProjectivePoint = curve === "p256" ? p256.ProjectivePoint : k256.ProjectivePoint;
	return ProjectivePoint.fromHex(compressed).toRawBytes(false);
};

/**
 * Verifies a signature using a signing key in did:key format.
 * @param curve p256 (secp256r1) or k256 (secp256k1)
 * @param did The signing key in did:key format.
 * @param data The data to verify.
 * @param sig The signature to verify.
 */
const verifyDidSig = (
	curve: "p256" | "k256",
	did: string,
	data: Uint8Array,
	sig: Uint8Array,
): boolean => {
	const prefixedBytes = extractPrefixedBytes(extractMultikey(did));
	const prefix = curve === "p256" ? P256_DID_PREFIX : SECP256K1_DID_PREFIX;
	if (!hasPrefix(prefixedBytes, prefix)) {
		throw new Error("Invalid curve for DID: " + did);
	}

	const keyBytes = prefixedBytes.slice(prefix.length);
	const msgHash = sha256(data);

	return (curve === "p256" ? p256 : k256).verify(sig, msgHash, keyBytes, { lowS: false });
};

/**
 * Formats a signing key as [base58 multibase](https://github.com/multiformats/multibase).
 * @param jwtAlg The JWT algorithm used by the signing key.
 * @param keyBytes The bytes of the signing key.
 */
const formatMultikey = (
	jwtAlg: typeof P256_JWT_ALG | typeof SECP256K1_JWT_ALG,
	keyBytes: Uint8Array,
): string => {
	const curve = jwtAlg === P256_JWT_ALG ? "p256" : "k256";
	let prefixedBytes: Uint8Array;
	if (jwtAlg === P256_JWT_ALG) {
		prefixedBytes = ui8.concat([P256_DID_PREFIX, compressPubkey(curve, keyBytes)]);
	} else if (jwtAlg === SECP256K1_JWT_ALG) {
		prefixedBytes = ui8.concat([SECP256K1_DID_PREFIX, compressPubkey(curve, keyBytes)]);
	} else {
		throw new Error("Invalid JWT algorithm: " + jwtAlg);
	}
	return (BASE58_MULTIBASE_PREFIX + ui8.toString(prefixedBytes, "base58btc"));
};

/**
 * Parses and decompresses the public key and JWT algorithm from multibase.
 * @param key The multikey to parse.
 */
const parseMultikey = (
	key: string,
): { jwtAlg: typeof P256_JWT_ALG | typeof SECP256K1_JWT_ALG; keyBytes: Uint8Array } => {
	const multikey = extractMultikey(key);
	const prefixedBytes = extractPrefixedBytes(multikey);

	const keyCurve = hasPrefix(prefixedBytes, P256_DID_PREFIX)
		? "p256"
		: hasPrefix(prefixedBytes, P256_DID_PREFIX)
		? "k256"
		: null;
	if (!keyCurve) throw new Error("Invalid curve for multikey: " + multikey);
	const keyBytes = decompressPubkey(keyCurve, prefixedBytes.subarray(keyCurve.length));

	return { jwtAlg: keyCurve === "p256" ? P256_JWT_ALG : SECP256K1_JWT_ALG, keyBytes };
};

/**
 * Extracts the key component of a did:key.
 * @param did The did:key to extract the key from.
 * @returns A compressed pubkey, without the did:key prefix.
 */
const extractMultikey = (did: string): string => {
	if (!did.startsWith(DID_KEY_PREFIX)) throw new Error("Incorrect prefix for did:key: " + did);
	return did.slice(DID_KEY_PREFIX.length);
};

/**
 * Removes the base58 multibase prefix from a compressed pubkey.
 * @param multikey The compressed pubkey to remove the prefix from.
 * @returns The pubkey without the multibase base58 prefix.
 */
const extractPrefixedBytes = (multikey: string): Uint8Array => {
	if (!multikey.startsWith(BASE58_MULTIBASE_PREFIX)) {
		throw new Error("Incorrect prefix for multikey: " + multikey);
	}
	return ui8.fromString(multikey.slice(BASE58_MULTIBASE_PREFIX.length), "base58btc");
};

/**
 * Parses a JWT payload.
 * @param b64 The JWT payload to parse.
 */
const parsePayload = (
	b64: string,
): { iss: string; aud: string; exp: number; lxm?: string; nonce?: string } => {
	const payload = JSON.parse(ui8.toString(ui8.fromString(b64, "base64url"), "utf8"));
	if (
		!payload
		|| typeof payload !== "object"
		|| typeof payload.iss !== "string"
		|| typeof payload.aud !== "string"
		|| typeof payload.exp !== "number"
		|| (payload.lxm && typeof payload.lxm !== "string")
		|| (payload.nonce && typeof payload.nonce !== "string")
	) {
		throw new XRPCError(401, { kind: "BadJwt", description: "Poorly formatted JWT" });
	}
	return payload;
};

/**
 * Parses a multibase encoded string to a Uint8Array.
 * @param mb The multibase encoded string.
 */
const multibaseToBytes = (mb: string): Uint8Array => {
	const base = mb[0];
	const key = mb.slice(1);
	switch (base) {
		case "f":
			return ui8.fromString(key, "base16");
		case "F":
			return ui8.fromString(key, "base16upper");
		case "b":
			return ui8.fromString(key, "base32");
		case "B":
			return ui8.fromString(key, "base32upper");
		case "z":
			return ui8.fromString(key, "base58btc");
		case "m":
			return ui8.fromString(key, "base64");
		case "u":
			return ui8.fromString(key, "base64url");
		case "U":
			return ui8.fromString(key, "base64urlpad");
		default:
			throw new Error(`Unsupported multibase: :${mb}`);
	}
};
