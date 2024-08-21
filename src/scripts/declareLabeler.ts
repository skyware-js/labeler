import { AtpAgent, ComAtprotoLabelDefs } from "@atproto/api";

/**
 * Declare the labels this labeler will apply. Necessary for users to be able to configure what they see.
 * @param agent The agent logged into the labeler account.
 * @param labelDefinitions The label definitions to declare. You can learn about the definition format [here](https://docs.bsky.app/docs/advanced-guides/moderation#custom-label-values).
 */
export async function declareLabeler(
	agent: AtpAgent,
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
): Promise<void>;
/**
 * Declare the labels this labeler will apply. Necessary for users to be able to configure what they see.
 * @param credentials The credentials of the labeler account.
 * @param labelDefinitions The label definitions to declare. You can learn about the definition format [here](https://docs.bsky.app/docs/advanced-guides/moderation#custom-label-values).
 */
export async function declareLabeler(
	credentials: { pds?: string; identifier: string; password: string },
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
): Promise<void>;
export async function declareLabeler(
	agentOrCredentials: AtpAgent | { pds?: string; identifier: string; password: string },
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
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

	const labelValues = labelDefinitions.map(({ identifier }) => identifier);
	await agent.app.bsky.labeler.service.create({ repo: agent.did }, {
		policies: { labelValues, labelValueDefinitions: labelDefinitions },
		createdAt: new Date().toUTCString(),
	});
}
