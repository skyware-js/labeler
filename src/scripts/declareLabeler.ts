import { AtpAgent, ComAtprotoLabelDefs } from "@atproto/api";
import { loginAgentOrCredentials } from "./util.js";

/**
 * Declare the labels this labeler will apply. Necessary for users to be able to configure what they see.
 * @param credentials The credentials of the labeler account.
 * @param labelDefinitions The label definitions to declare. You can learn about the definition format [here](https://docs.bsky.app/docs/advanced-guides/moderation#custom-label-values).
 * @param overwriteExisting Whether to overwrite the existing label definitions if they already exist.
 */
export async function declareLabeler(
	credentials: { pds?: string; identifier: string; password: string },
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
	overwriteExisting?: boolean,
): Promise<void>;
/**
 * Declare the labels this labeler will apply. Necessary for users to be able to configure what they see.
 * @param agent The agent logged into the labeler account.
 * @param labelDefinitions The label definitions to declare. You can learn about the definition format [here](https://docs.bsky.app/docs/advanced-guides/moderation#custom-label-values).
 * @param overwriteExisting Whether to overwrite the existing label definitions if they already exist.
 */
export async function declareLabeler(
	agent: AtpAgent,
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
	overwriteExisting?: boolean,
): Promise<void>;
export async function declareLabeler(
	agentOrCredentials: AtpAgent | { pds?: string; identifier: string; password: string },
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
	overwriteExisting?: boolean,
) {
	const agent = await loginAgentOrCredentials(agentOrCredentials);
	const labelValues = labelDefinitions.map(({ identifier }) => identifier);

	const existing = await getLabelerLabelDefinitions(agent);
	if (existing?.length && !overwriteExisting) {
		if (overwriteExisting === false) return;
		throw new Error(
			"Label definitions already exist. Use `overwriteExisting: true` to update them, or `overwriteExisting: false` to silence this error.",
		);
	}

	await agent.app.bsky.labeler.service.create({ repo: agent.accountDid }, {
		policies: { labelValues, labelValueDefinitions: labelDefinitions },
		createdAt: new Date().toUTCString(),
	});
}

/**
 * Get the label definitions currently declared by the labeler.
 * @param credentials The credentials of the labeler account.
 * @returns The label definitions.
 */
export async function getLabelerLabelDefinitions(
	credentials: { pds?: string; identifier: string; password: string },
): Promise<Array<ComAtprotoLabelDefs.LabelValueDefinition>>;
/**
 * Get the label definitions currently declared by the labeler.
 * @param agent The agent logged into the labeler account.
 * @returns The label definitions.
 */
export async function getLabelerLabelDefinitions(
	agent: AtpAgent,
): Promise<Array<ComAtprotoLabelDefs.LabelValueDefinition>>;
export async function getLabelerLabelDefinitions(
	agentOrCredentials: AtpAgent | { pds?: string; identifier: string; password: string },
) {
	const agent = await loginAgentOrCredentials(agentOrCredentials);
	const { value: { policies } } = await agent.app.bsky.labeler.service.get({
		rkey: "self",
		repo: agent.accountDid,
	});
	return policies.labelValueDefinitions;
}
