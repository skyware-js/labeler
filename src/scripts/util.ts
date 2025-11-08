import type {} from "@atcute/bluesky";
import type {} from "@atcute/atproto";
import { AtpSessionData, Client, CredentialManager } from "@atcute/client";

export interface LoginCredentials {
	/** The URL of the PDS where the account is located. Defaults to "https://bsky.social". */
	pds?: string | undefined;
	/** The account identifier; a DID or handle. */
	identifier: string;
	/** The account password. */
	password: string;
	/** The 2FA code, if 2FA is enabled. */
	code?: string;
}

let client: Client;
let credentialManager: CredentialManager | undefined;

export async function loginAgent(
	{ pds, ...credentials }: LoginCredentials,
): Promise<{ agent: Client; session: AtpSessionData }> {
	credentialManager ??= new CredentialManager({ service: pds || "https://bsky.social" });
	client ??= new Client({ handler: credentialManager });

	if (
		credentialManager.session && credentialsMatchSession(credentials, credentialManager.session)
	) {
		return { agent: client, session: credentialManager.session };
	}
	const session = await credentialManager.login(credentials);
	return { agent: client, session };
}

const credentialsMatchSession = (credentials: LoginCredentials, session: AtpSessionData) =>
	(!!credentials.pds ? credentials.pds === session.pdsUri : true)
	&& [session.did, session.handle, session.email].includes(credentials.identifier);
