import { type AppBskyLabelerService, AtpAgent, type ComAtprotoLabelDefs } from "@atproto/api";
import { loginAgent, LoginCredentials } from "./util.js";

/**
 * Declare the labels this labeler will apply. Necessary for users to be able to configure what they see.
 * @param credentials The credentials of the labeler account.
 * @param labelDefinitions The label definitions to declare. You can learn about the definition format [here](https://docs.bsky.app/docs/advanced-guides/moderation#custom-label-values).
 * @param overwriteExisting Whether to overwrite the existing label definitions if they already exist.
 */
export async function declareLabeler(
	credentials: LoginCredentials,
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
	overwriteExisting?: boolean,
): Promise<void> {
	const agent = await loginAgent(credentials);
	const labelValues = labelDefinitions.map(({ identifier }) => identifier);

	const existing = await getLabelerLabelDefinitions(credentials);
	if (existing?.length && !overwriteExisting) {
		if (overwriteExisting === false) return;
		else if (overwriteExisting === undefined) {
			throw new Error(
				"Label definitions already exist. Use `overwriteExisting: true` to update them, or `overwriteExisting: false` to silence this error.",
			);
		}
	}

	// We check if existing is truthy because an empty array means the record exists, but contains no definitions.
	if (existing) {
		await agent.com.atproto.repo.putRecord({
			collection: "app.bsky.labeler.service",
			rkey: "self",
			repo: agent.accountDid,
			record: {
				$type: "app.bsky.labeler.service",
				policies: { labelValues, labelValueDefinitions: labelDefinitions },
				createdAt: new Date().toISOString(),
			} satisfies AppBskyLabelerService.Record,
		});
	} else {
		await agent.app.bsky.labeler.service.create({ repo: agent.accountDid }, {
			policies: { labelValues, labelValueDefinitions: labelDefinitions },
			createdAt: new Date().toISOString(),
		});
	}
}

/**
 * Get the label definitions currently declared by the labeler.
 * @param agentOrCredentials An agent logged into the labeler account, or credentials to the labeler account.
 * @returns The label definitions.
 */
export async function getLabelerLabelDefinitions(
	agentOrCredentials: AtpAgent | LoginCredentials,
): Promise<Array<ComAtprotoLabelDefs.LabelValueDefinition> | null> {
	const agent = agentOrCredentials instanceof AtpAgent
		? agentOrCredentials
		: await loginAgent(agentOrCredentials);
	const { value: { policies } } = await agent.app.bsky.labeler.service.get({
		rkey: "self",
		repo: agent.accountDid,
	}).catch(() => ({ value: { policies: null } }));
	return policies?.labelValueDefinitions ?? null;
}

/**
 * Set the label definitions for this labeler account.
 * @param credentials The credentials of the labeler account.
 * @param labelDefinitions The label definitions to set.
 */
export async function setLabelerLabelDefinitions(
	credentials: LoginCredentials,
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
) {
	return declareLabeler(credentials, labelDefinitions, true);
}

/**
 * Delete the labeler declaration for this account, removing all label definitions.
 * @param credentials The credentials of the labeler account.
 */
export async function deleteLabelerDeclaration(credentials: LoginCredentials): Promise<void> {
	const agent = await loginAgent(credentials);
	return agent.app.bsky.labeler.service.delete({ repo: agent.accountDid }).catch(() => {});
}
