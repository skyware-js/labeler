import { fromBytes, toBytes } from "@atcute/cbor";
import type { ComAtprotoIdentitySignPlcOperation } from "@atcute/client/lexicons";
import { secp256k1 as k256 } from "@noble/curves/secp256k1";
import { formatDidKey, SECP256K1_JWT_ALG } from "../util/crypto.js";
import { loginAgent, LoginCredentials } from "./util.js";

/** Options for the {@link plcSetupLabeler} function. */
export interface PlcSetupLabelerOptions extends LoginCredentials {
	/** The HTTPS URL where the labeler is hosted. */
	endpoint: string;

	/**
	 * The token to use to sign the PLC operation.
	 * If you don't have a token, first call {@link plcRequestToken} to receive one via email.
	 */
	plcToken: string;

	/**
	 * You may choose to provide your own hex-encoded secp256k1 signing key to use for the labeler.
	 * Leave this empty to generate a new keypair.
	 */
	privateKey?: string | Uint8Array;
	/** Whether to overwrite the existing label signing key if one is already set. */
	overwriteExistingKey?: boolean;
}

/** Options for the {@link plcClearLabeler} function. */
export interface PlcClearLabelerOptions extends LoginCredentials {
	/**
	 * The token to use to sign the PLC operation.
	 * If you don't have a token, first call {@link plcRequestToken} to receive one via email.
	 */
	plcToken: string;
}

/**
 * This function will update the labeler account's DID document to include the
 * provided labeler endpoint and signing key. If no private key is provided, a
 * new keypair will be generated, and the private key will be printed to the
 * console. This private key will be needed to sign any labels created.
 * To set up a labeler, call this function followed by {@link declareLabeler}.
 * @param options Options for the function.
 * @returns The PLC operation that was submitted.
 */
export async function plcSetupLabeler(options: PlcSetupLabelerOptions) {
	const { agent } = await loginAgent({
		pds: options.pds,
		identifier: options.identifier,
		password: options.password,
	});

	const privateKey = options.privateKey
		? options.privateKey instanceof Uint8Array
			? options.privateKey
			: fromBytes({ $bytes: options.privateKey })
		: k256.utils.randomPrivateKey();

	const publicKey = k256.getPublicKey(privateKey);
	const keyDid = formatDidKey(SECP256K1_JWT_ALG, publicKey);

	const operation: ComAtprotoIdentitySignPlcOperation.Input = {};

	const credentials = await agent.get("com.atproto.identity.getRecommendedDidCredentials", {});

	if (
		!credentials.data.verificationMethods
		|| !(typeof credentials.data.verificationMethods === "object")
		|| !("atproto_label" in credentials.data.verificationMethods)
		|| !credentials.data.verificationMethods["atproto_label"]
		|| (credentials.data.verificationMethods["atproto_label"] !== keyDid
			&& options.overwriteExistingKey)
	) {
		operation.verificationMethods = {
			...(credentials.data.verificationMethods || {}),
			atproto_label: keyDid,
		};
	}

	if (
		!credentials.data.services
		|| !(typeof credentials.data.services === "object")
		|| !("atproto_labeler" in credentials.data.services)
		|| !credentials.data.services["atproto_labeler"]
		|| typeof credentials.data.services["atproto_labeler"] !== "object"
		|| !("endpoint" in credentials.data.services["atproto_labeler"])
		|| credentials.data.services["atproto_labeler"].endpoint !== options.endpoint
	) {
		operation.services = {
			...(credentials.data.services || {}),
			atproto_labeler: { type: "AtprotoLabeler", endpoint: options.endpoint },
		};
	}

	if (Object.keys(operation).length === 0) {
		return;
	}

	const plcOp = await agent.call("com.atproto.identity.signPlcOperation", {
		data: { token: options.plcToken, ...operation },
	});

	await agent.call("com.atproto.identity.submitPlcOperation", {
		data: { operation: plcOp.data.operation },
	});

	if (!options.privateKey && operation.verificationMethods) {
		const privateKeyString = toBytes(privateKey).$bytes;
		console.log(
			"This is your labeler's signing key. It will be needed to sign any labels you create.",
			"You will not be able to retrieve this key again, so make sure to save it somewhere safe.",
			"If you lose this key, you can run this again to generate a new one.",
		);
		console.log("Signing key:", privateKeyString);
	}

	return operation;
}

/**
 * This function will remove the labeler endpoint and signing key from the labeler account's DID document.
 * To restore a labeler to a regular account, call this function followed by {@link deleteLabelerDeclaration}.
 * @param options Options for the function.
 */
export async function plcClearLabeler(options: PlcClearLabelerOptions) {
	const { agent } = await loginAgent({
		pds: options.pds,
		identifier: options.identifier,
		password: options.password,
	});

	const credentials = await agent.get("com.atproto.identity.getRecommendedDidCredentials", {});

	if (
		credentials.data.verificationMethods
		&& typeof credentials.data.verificationMethods === "object"
		&& "atproto_label" in credentials.data.verificationMethods
	) {
		delete credentials.data.verificationMethods.atproto_label;
	}

	if (
		credentials.data.services && typeof credentials.data.services === "object"
		&& "atproto_labeler" in credentials.data.services
		&& credentials.data.services["atproto_labeler"]
	) {
		delete credentials.data.services.atproto_labeler;
	}

	const plcOp = await agent.call("com.atproto.identity.signPlcOperation", {
		data: { token: options.plcToken, ...credentials.data },
	});

	await agent.call("com.atproto.identity.submitPlcOperation", {
		data: { operation: plcOp.data.operation },
	});
}

/**
 * Request a PLC token, needed for {@link plcSetupLabeler}. The token will be sent to the email
 * associated with the labeler account.
 * @param credentials The credentials of the labeler account.
 */
export async function plcRequestToken(credentials: LoginCredentials): Promise<void> {
	const { agent } = await loginAgent(credentials);
	await agent.call("com.atproto.identity.requestPlcOperationSignature", {});
}
