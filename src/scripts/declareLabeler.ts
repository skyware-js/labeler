import "@atcute/bluesky/lexicons";
import { ComAtprotoLabelDefs, ComAtprotoRepoPutRecord } from "@atcute/atproto";
import { AppBskyLabelerService } from "@atcute/bluesky";
import { is } from "@atcute/lexicons";
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

	const existingService = (await getLabelerService(credentials)).service;
	if (existingService) {
		if (!Array.isArray(existingService.reasonTypes) && overwriteExisting !== true) {
			console.warn(
				"Label service definition is missing reasonTypes, you should recreate the labeller to declare that it does not receive reports.",
			);
		}

		const existingLabelDefinitions = getDefinitions(existingService);

		if (existingLabelDefinitions && existingLabelDefinitions.length && !overwriteExisting) {
			if (overwriteExisting === false) return;
			else if (overwriteExisting === undefined) {
				throw new Error(
					"Label definitions already exist. Use `overwriteExisting: true` to update them, or `overwriteExisting: false` to silence this error.",
				);
			}
		}
	}

	const record: AppBskyLabelerService.Main = {
		$type: "app.bsky.labeler.service",
		policies: { labelValues, labelValueDefinitions: labelDefinitions },
		// We don't implement com.atproto.moderation.createReport,
		// so to disable receiving reports:
		reasonTypes: [],
		subjectTypes: [],
		subjectCollections: [],
		createdAt: new Date().toISOString(),
	};

	const data: ComAtprotoRepoPutRecord.$input = {
		collection: "app.bsky.labeler.service",
		rkey: "self",
		repo: session.did,
		record,
		validate: true,
	};

	// We check if existing is truthy because an empty array means the record exists, but contains no definitions.
	if (existingService) {
		await agent.post("com.atproto.repo.putRecord", { input: data });
	} else {
		await agent.post("com.atproto.repo.createRecord", { input: data });
	}
}

export async function getLabelerService(
	credentials: LoginCredentials,
): Promise<{ service?: AppBskyLabelerService.Main }> {
	const { agent, session } = await loginAgent(credentials);
	const response = await agent.get("com.atproto.repo.getRecord", {
		params: { collection: "app.bsky.labeler.service", rkey: "self", repo: session.did },
	});

	if (response.ok && is(AppBskyLabelerService.mainSchema, response.data)) {
		return { service: response.data };
	}

	return {};
}

function getDefinitions(
	service?: AppBskyLabelerService.Main,
): ComAtprotoLabelDefs.LabelValueDefinition[] | undefined {
	return service?.policies?.labelValueDefinitions;
}

/**
 * Get the label definitions currently declared by the labeler.
 * @param credentials The credentials of the labeler account.
 * @returns The label definitions.
 */
export async function getLabelerLabelDefinitions(
	credentials: LoginCredentials,
): Promise<Array<ComAtprotoLabelDefs.LabelValueDefinition> | null> {
	const response = await getLabelerService(credentials);
	return getDefinitions(response.service) ?? null;
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
	await agent.post("com.atproto.repo.deleteRecord", {
		input: { collection: "app.bsky.labeler.service", rkey: "self", repo: session.did },
	});
}
