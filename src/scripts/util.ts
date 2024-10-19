import { AtpSessionData, CredentialManager, XRPC } from "@atcute/client";

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

let xrpc: XRPC | undefined;
let credentialManager: CredentialManager | undefined;

export async function loginAgent(
	{ pds, ...credentials }: LoginCredentials,
): Promise<{ agent: XRPC; session: AtpSessionData }> {
	credentialManager ??= new CredentialManager({ service: pds || "https://bsky.social" });
	xrpc ??= new XRPC({ handler: credentialManager });

	if (
		credentialManager.session && credentialsMatchSession(credentials, credentialManager.session)
	) {
		return { agent: xrpc, session: credentialManager.session };
	}
	const session = await credentialManager.login(credentials);
	return { agent: xrpc, session };
}

const credentialsMatchSession = (credentials: LoginCredentials, session: AtpSessionData) =>
	(!!credentials.pds ? credentials.pds === session.pdsUri : true)
	&& [session.did, session.handle, session.email].includes(credentials.identifier);
