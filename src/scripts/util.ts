import { AtpAgent } from "@atproto/api";

export interface LoginCredentials {
	/** The URL of the PDS where the account is located. Defaults to "https://bsky.social". */
	pds?: string | undefined;
	/** The account identifier; a DID or handle. */
	identifier: string;
	/** The account password. */
	password: string;
}

export async function loginAgent({ pds, ...credentials }: LoginCredentials) {
	const agent = new AtpAgent({ service: pds || "https://bsky.social" });
	try {
		await agent.login(credentials);
	} catch (e) {
		throw new Error("Failed to log in to the account.", { cause: e });
	}
	return agent;
}
