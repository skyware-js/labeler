import "@atcute/bluesky/lexicons";
import {
	AppBskyLabelerService,
	ComAtprotoLabelDefs,
	ComAtprotoRepoCreateRecord,
} from "@atcute/client/lexicons";
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
	const { agent, session } = await loginAgent(credentials);
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

	const data = {
		collection: "app.bsky.labeler.service",
		rkey: "self",
		repo: session.did,
		record: {
			$type: "app.bsky.labeler.service",
			policies: { labelValues, labelValueDefinitions: labelDefinitions },
			createdAt: new Date().toISOString(),
		} satisfies AppBskyLabelerService.Record,
		validate: true,
	} satisfies ComAtprotoRepoCreateRecord.Input;

	// We check if existing is truthy because an empty array means the record exists, but contains no definitions.
	if (existing) {
		await agent.call("com.atproto.repo.putRecord", { data });
	} else {
		await agent.call("com.atproto.repo.createRecord", { data });
	}
}

/**
 * Get the label definitions currently declared by the labeler.
 * @param credentials The credentials of the labeler account.
 * @returns The label definitions.
 */
export async function getLabelerLabelDefinitions(
	credentials: LoginCredentials,
): Promise<Array<ComAtprotoLabelDefs.LabelValueDefinition> | null> {
	const { agent, session } = await loginAgent(credentials);
	const { data: { value: declaration } } = await agent.get("com.atproto.repo.getRecord", {
		params: { collection: "app.bsky.labeler.service", rkey: "self", repo: session.did },
	}).catch(() => ({ data: { value: {} } }));
	// @ts-expect-error — declaration is unknown
	return declaration?.policies?.labelValueDefinitions ?? null;
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
	const { agent, session } = await loginAgent(credentials);
	await agent.call("com.atproto.repo.deleteRecord", {
		data: { collection: "app.bsky.labeler.service", rkey: "self", repo: session.did },
	});
}
