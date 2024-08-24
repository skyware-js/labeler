import { AtpAgent, ComAtprotoIdentitySignPlcOperation } from "@atproto/api";
import { Secp256k1Keypair } from "@atproto/crypto";
import * as ui8 from "uint8arrays";
import { loginAgentOrCredentials } from "./util.js";

/** Options for the {@link plcSetupLabeler} function. */
export interface PlcSetupLabelerOptions {
	/** The HTTPS URL where the labeler is hosted. */
	endpoint: string;

	/**
	 * The token to use to sign the PLC operation.
	 * If you don't have a token, first call {@link plcRequestToken} to receive one via email.
	 */
	plcToken: string;

	/** The URL of the PDS where the labeler account is located, if different from bsky.social. */
	pds?: string;
	/** The DID of the labeler account. */
	did: string;
	/** The password of the labeler account. You must provide either `password` or `agent`. */
	password?: string;
	/** An agent logged into the labeler account. You must provide either `password` or `agent`. */
	agent?: AtpAgent;

	/**
	 * You may choose to provide your own hex-encoded secp256k1 signing key to use for the labeler.
	 * Leave this empty to generate a new keypair.
	 */
	privateKey?: string | Uint8Array;
	/** Whether to overwrite the existing label signing key if one is already set. */
	overwriteExistingKey?: boolean;
}

/** Options for the {@link plcClearLabeler} function. */
export interface PlcClearLabelerOptions {
	/**
	 * The token to use to sign the PLC operation.
	 * If you don't have a token, first call {@link plcRequestToken} to receive one via email.
	 */
	plcToken: string;

	/** The URL of the PDS where the labeler account is located, if different from bsky.social. */
	pds?: string;
	/** The DID of the labeler account. */
	did: string;
	/** The password of the labeler account. You must provide either `password` or `agent`. */
	password?: string;
	/** An agent logged into the labeler account. You must provide either `password` or `agent`. */
	agent?: AtpAgent;
}

/**
 * This function will update the labeler account's DID document to include the
 * provided labeler endpoint and signing key. If no private key is provided, a
 * new keypair will be generated, and the private key will be printed to the
 * console. This private key will be needed to sign any labels created.
 * To set up a labeler, call this function followed by {@link declareLabeler}.
 * @param options Options for the function.
 */
export async function plcSetupLabeler(options: PlcSetupLabelerOptions) {
	if (!options.agent && !options.password) {
		throw new Error(
			"Either a logged-in agent or a password must be provided for the labeler account.",
		);
	}

	const agent = options.agent ?? new AtpAgent({ service: options.pds || "https://bsky.social" });
	if (!agent.hasSession) {
		if (!options.password) {
			throw new Error("A password must be provided to log in to the labeler account.");
		}
		await agent.login({ identifier: options.did, password: options.password });
	}

	const keypair = options.privateKey
		? await Secp256k1Keypair.import(options.privateKey)
		: await Secp256k1Keypair.create({ exportable: true });

	const keyDid = keypair.did();

	const operation: ComAtprotoIdentitySignPlcOperation.InputSchema = {};

	const credentials = await agent.com.atproto.identity.getRecommendedDidCredentials();
	if (!credentials.success) {
		throw new Error("Failed to fetch DID document.");
	}

	if (
		!credentials.data.verificationMethods
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
		|| !("atproto_label" in credentials.data.services)
		|| !credentials.data.services["atproto_label"]
		|| typeof credentials.data.services["atproto_label"] !== "object"
		|| !("endpoint" in credentials.data.services["atproto_label"])
		|| credentials.data.services["atproto_label"].endpoint !== options.endpoint
	) {
		operation.services = {
			...(credentials.data.services || {}),
			atproto_label: { type: "AtprotoLabeler", endpoint: options.endpoint },
		};
	}

	if (Object.keys(operation).length === 0) {
		return;
	}

	const plcOp = await agent.com.atproto.identity.signPlcOperation({
		token: options.plcToken,
		...operation,
	});

	await agent.com.atproto.identity.submitPlcOperation({ operation: plcOp.data.operation });

	if (!options.privateKey && operation.verificationMethods) {
		const privateKey = ui8.toString(await keypair.export(), "hex");
		console.log(
			"This is your labeler's signing key. It will be needed to sign any labels you create.",
			"You will not be able to retrieve this key again, so make sure to save it somewhere safe.",
			"If you lose this key, you can call this function again without passing a private key to generate a new one.",
		);
		console.log("Signing key:", privateKey);
	}
}

/**
 * This function will remove the labeler endpoint and signing key from the labeler account's DID document.
 * To restore a labeler to a regular account, call this function followed by {@link deleteLabelerDeclaration}.
 * @param options Options for the function.
 */
export async function plcClearLabeler(options: PlcClearLabelerOptions) {
	if (!options.agent && !options.password) {
		throw new Error(
			"Either a logged-in agent or a password must be provided for the labeler account.",
		);
	}

	const agent = options.agent ?? new AtpAgent({ service: options.pds || "https://bsky.social" });
	if (!agent.hasSession) {
		if (!options.password) {
			throw new Error("A password must be provided to log in to the labeler account.");
		}
		await agent.login({ identifier: options.did, password: options.password });
	}

	const credentials = await agent.com.atproto.identity.getRecommendedDidCredentials();
	if (!credentials.success) {
		throw new Error("Failed to fetch DID document.");
	}

	if (
		credentials.data.verificationMethods
		&& "atproto_label" in credentials.data.verificationMethods
	) {
		delete credentials.data.verificationMethods.atproto_label;
	}

	if (
		credentials.data.services
		&& "atproto_label" in credentials.data.services
		&& credentials.data.services["atproto_label"]
	) {
		delete credentials.data.services.atproto_label;
	}

	const plcOp = await agent.com.atproto.identity.signPlcOperation({
		token: options.plcToken,
		...credentials.data,
	});

	await agent.com.atproto.identity.submitPlcOperation({ operation: plcOp.data.operation });
}

/**
 * Request a PLC token, needed for {@link plcSetupLabeler}. The token will be sent to the email
 * associated with the labeler account.
 * @param credentials The credentials of the labeler account.
 */
export async function plcRequestToken(
	credentials: { pds?: string; identifier: string; password: string },
): Promise<void>;
/**
 * Request a PLC token, needed for {@link plcSetupLabeler}. The token will be sent to the email
 * associated with the labeler account.
 * @param agent An agent logged into the labeler account.
 */
export async function plcRequestToken(agent: AtpAgent): Promise<void>;
export async function plcRequestToken(
	agentOrCredentials: AtpAgent | { pds?: string; identifier: string; password: string },
) {
	const agent = await loginAgentOrCredentials(agentOrCredentials);
	await agent.com.atproto.identity.requestPlcOperationSignature();
}
