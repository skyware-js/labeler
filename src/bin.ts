#!/usr/bin/env node
import { ComAtprotoLabelDefs } from "@atproto/api";
import { LabelValueDefinition } from "@atproto/api/dist/client/types/com/atproto/label/defs.js";
import { IdResolver } from "@atproto/identity";
import prompt from "prompts";
import {
	declareLabeler,
	deleteLabelerDeclaration,
	getLabelerLabelDefinitions,
	plcClearLabeler,
	plcRequestToken,
	plcSetupLabeler,
	setLabelerLabelDefinitions,
} from "./scripts/index.js";

const args = process.argv.slice(2);
const [command, subcommand] = args;

const idResolver = new IdResolver();

if (command === "setup" || command === "clear") {
	const { did, password, pds } = await promptAuthInfo();

	const { endpoint, privateKey } = await prompt([{
		type: command === "setup" ? "text" : undefined,
		name: "endpoint",
		message: "URL where the labeler will be hosted:",
		validate: (value) => value.startsWith("https://") || "Must be a valid HTTPS URL.",
	}, {
		type: "text",
		name: "privateKey",
		message: "Enter a hex-encoded signing key to use, or leave blank to generate a new one:",
		validate: (value) => !value || /^[0-9a-f]*$/.test(value) || "Must be a hex-encoded string.",
	}], { onCancel: () => process.exit(1) });

	await plcRequestToken({ identifier: did, password, pds });

	const { plcToken } = await prompt({
		type: "text",
		name: "plcToken",
		message: "You will receive a confirmation code via email. Code:",
	}, { onCancel: () => process.exit(1) });

	if (command === "setup") {
		try {
			const operation = await plcSetupLabeler({
				did,
				password,
				pds,
				plcToken,
				endpoint,
				privateKey,
				overwriteExistingKey: true,
			});

			// If a new key was generated and a verification method was added,
			// plcSetupLabeler logged the private key to the console.
			if (!privateKey && operation?.verificationMethods) {
				await confirm(
					"Have you saved the signing key and are you ready to begin defining labels?",
				);
			}

			console.log(
				"Next, you will need to define a name, description, and settings for each of the labels you want this labeler to apply.",
			);
			const labelDefinitions = await promptLabelDefinitions();
			if (labelDefinitions.length) {
				await declareLabeler({ identifier: did, password, pds }, labelDefinitions, true);
			} else {
				console.log(
					"No labels were defined. You can use the `label add` command later to define new labels.",
				);
			}

			console.log("Labeler setup complete!");
		} catch (error) {
			console.error("Error setting up labeler:", error);
		}
	} else {
		try {
			await plcClearLabeler({ did, password, pds, plcToken });
			await deleteLabelerDeclaration({ identifier: did, password, pds });
			console.log("Labeler data cleared.");
		} catch (error) {
			console.error("Error setting up labeler:", error);
		}
	}
} else if (command === "label" && (subcommand === "add" || subcommand === "delete")) {
	const { did, password, pds } = await promptAuthInfo();
	const labelDefinitions = await getLabelerLabelDefinitions({ identifier: did, password, pds })
		?? [];

	if (subcommand === "add") {
		console.log(
			"Now define a name, description, and settings for each of the labels you want to add.",
		);
		const newDefinitions = await promptLabelDefinitions();
		if (newDefinitions.length) {
			const definitions = [...labelDefinitions, ...newDefinitions];
			await setLabelerLabelDefinitions({ identifier: did, password, pds }, definitions);
			console.log("Declared label(s):", definitions.map((d) => d.identifier).join(", "));
		} else {
			console.log(
				"No labels were defined. You can use the `label add` command later to define new labels.",
			);
		}
	} else {
		if (!labelDefinitions.length) {
			console.log(
				"No labels are currently declared. Use the `label add` command to define new labels.",
			);
			process.exit(0);
		}

		const { identifiers } = await prompt({
			type: "multiselect",
			name: "identifiers",
			message: "Select the labels to remove",
			min: 1,
			choices: labelDefinitions.map((def) => ({
				title: def.locales[0].name,
				value: def.identifier,
			})),
		}, { onCancel: () => process.exit(1) });

		const definitions = labelDefinitions.filter((def) => !identifiers.includes(def.identifier));

		try {
			if (definitions.length) {
				await setLabelerLabelDefinitions({ identifier: did, password, pds }, definitions);
				console.log("Deleted label(s):", identifiers.join(", "));
			} else {
				await deleteLabelerDeclaration({ identifier: did, password, pds });
				console.log("All labels cleared.");
			}
		} catch (error) {
			console.error("Failed to delete labels:", error);
		}
	}
} else {
	console.log("Usage: npx @skyware/labeler [command]");
	console.log("Commands:");
	console.log("  setup - Initialize an account as a labeler.");
	console.log("  clear - Restore a labeler account to normal.");
	console.log("  label add - Add new label declarations to a labeler account.");
	console.log("  label delete - Remove label declarations from a labeler account.");
}

async function promptAuthInfo() {
	let did: string | undefined;
	while (!did) {
		const { did: didOrHandle } = await prompt({
			type: "text",
			name: "did",
			message: "DID or handle of the account to use:",
			validate: (value) =>
				value.startsWith("did:") || value.includes(".") || "Invalid DID or handle.",
			format: (value) => value.startsWith("@") ? value.slice(1) : value,
		}, { onCancel: () => process.exit(1) });
		if (!didOrHandle) continue;
		did = didOrHandle.startsWith("did:")
			? didOrHandle
			: await idResolver.handle.resolve(didOrHandle);
		if (!did) {
			console.log(`Could not resolve "${didOrHandle}" to a valid account. Please try again.`);
		}
	}

	const { password, pds } = await prompt([{
		type: "password",
		name: "password",
		message: "Account password (cannot be an app password):",
	}, {
		type: "text",
		name: "pds",
		message: "URL of the PDS where the account is located:",
		initial: "https://bsky.social",
		validate: (value) => value.startsWith("https://") || "Must be a valid HTTPS URL.",
	}], { onCancel: () => process.exit(1) });

	return { did, password, pds };
}

async function confirm(message: string) {
	let confirmed = false;
	while (!confirmed) {
		const { confirm } = await prompt({ type: "confirm", name: "confirm", message });
		confirmed = confirm;
	}
}

async function promptLabelDefinition(
	existing?: Array<string>,
): Promise<LabelValueDefinition | null> {
	let canceled = false;
	const { identifier, name, description, adultOnly, severity, blurs, defaultSetting } =
		await prompt([{
			type: "text",
			name: "identifier",
			message: "Identifier (non-user-facing, must be unique, 100 characters max):",
			validate: (value) => {
				if (!value) return "Required.";
				if (value.length > 100) return "Must be <= 100 characters.";
				if (existing?.some((id) => id === value)) return "Must be unique.";
				if (/[^a-z-]/.test(value)) return "Must be lowercase letters and hyphens only.";
				return true;
			},
			format: (value) => value.toLowerCase(),
		}, {
			type: "text",
			name: "name",
			message: "Name (user-facing, 64 characters max):",
			validate: (value) => value.length <= 64 || "Must be <= 64 characters.",
		}, {
			type: "text",
			name: "description",
			message: "Description (user-facing):",
			validate: (value) => value.length <= 10_000 || "10,000 characters max.",
		}, {
			type: "confirm",
			name: "adultOnly",
			message: "Does the user need to have adult content enabled to configure this label?",
			initial: false,
		}, {
			type: "select",
			name: "severity",
			message: "Label severity:",
			choices: [{ title: "Informational", description: "(neutral)", value: "inform" }, {
				title: "Alert",
				description: "(warning)",
				value: "alert",
			}, { title: "None", description: "(no label)", value: "none" }],
		}, {
			type: "select",
			name: "blurs",
			message: "Should this label hide content?",
			choices: [
				{ title: "Content", description: "(hide all labeled content)", value: "content" },
				{ title: "Media", description: "(hide media only)", value: "media" },
				{ title: "None", description: "(no hiding)", value: "none" },
			],
		}, {
			type: "select",
			name: "defaultSetting",
			message: "What should the default setting be for a new subscriber?",
			choices: [
				{ title: "Ignore", description: "(don't show this label)", value: "ignore" },
				{
					title: "Warn",
					description: "(display labeled content with warning)",
					value: "warn",
				},
				{ title: "Hide", description: "(hide labeled content from feed)", value: "hide" },
			],
		}], {
			onCancel: () => {
				canceled = true;
			},
		});

	return canceled
		? null
		: {
			identifier,
			adultOnly,
			severity,
			blurs,
			defaultSetting,
			locales: [{ lang: "en", name, description }],
		};
}

async function promptLabelDefinitions() {
	const definitions: Array<ComAtprotoLabelDefs.LabelValueDefinition> = [];
	let addAnother = true;
	while (addAnother) {
		console.log("Enter the details for the next label you would like this labeler to apply.");
		console.log("Press Esc or Ctrl+C to exit at any time with the labels defined so far.");

		const definition = await promptLabelDefinition(definitions.map((d) => d.identifier));
		if (!definition) break;
		definitions.push(definition);

		({ addAnother } = await prompt({
			type: "confirm",
			name: "addAnother",
			message: "Add another label definition?",
			initial: true,
		}));
	}

	return definitions;
}
