import { AtpAgent } from "@atproto/api";

export interface LoginCredentials {
	/** The URL of the PDS where the account is located. Defaults to "https://bsky.social". */
	pds?: string;
	/** The account identifier; a DID or handle. */
	identifier: string;
	/** The account password. */
	password: string;
}

export async function loginAgentOrCredentials(
	agentOrCredentials: AtpAgent | { pds?: string; identifier: string; password: string },
) {
	const agent = agentOrCredentials instanceof AtpAgent
		? agentOrCredentials
		: new AtpAgent({ service: agentOrCredentials.pds || "https://bsky.social" });
	if (!agent.hasSession) {
		if (!(agentOrCredentials instanceof AtpAgent)) {
			await agent.login(agentOrCredentials);
		} else {
			throw new Error("A password must be provided to log in to the labeler account.");
		}
	}
	return agent;
}
