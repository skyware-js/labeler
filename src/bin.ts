#!/usr/bin/env node
import { ComAtprotoLabelDefs } from "@atproto/api";
import { IdResolver } from "@atproto/identity";
import prompt from "prompts";
import {
	declareLabeler,
	deleteLabelerDeclaration,
	plcClearLabeler,
	plcRequestToken,
	plcSetupLabeler,
} from "./scripts/index.js";

const args = process.argv.slice(2);
const [command] = args;

const idResolver = new IdResolver();

if (command === "create" || command === "delete") {
	const did = await promptAndResolveDidOrHandle();

	const { password, pds, endpoint, privateKey } = await prompt([{
		type: "password",
		name: "password",
		message: "Account password (cannot be an app password):",
	}, {
		type: "text",
		name: "pds",
		message: "URL of the PDS where the account is located:",
		initial: "https://bsky.social",
	}, {
		type: command === "create" ? "text" : undefined,
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

	try {
		if (command === "create") {
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
			await declareLabeler({ identifier: did, password, pds }, labelDefinitions, true);

			console.log("Labeler setup complete!");
		} else {
			await plcClearLabeler({ did, password, pds, plcToken });
			await deleteLabelerDeclaration({ identifier: did, password, pds });
			console.log("Labeler account restored to normal.");
		}
	} catch (error) {
		console.error("Error setting up labeler:", error);
	}
} else {
	console.log("Usage: npx @skyware/labeler [command]");
	console.log("Commands:");
	console.log("  create - Initialize an account as a labeler.");
	console.log("  delete - Restore a labeler account to normal.");
}

async function promptAndResolveDidOrHandle() {
	let did: string | undefined;
	while (!did) {
		const { did: didOrHandle } = await prompt({
			type: "text",
			name: "did",
			message: "DID or handle of the account to use:",
			validate: (value) =>
				value.startsWith("did:") || value.includes(".") || "Invalid DID or handle.",
			format: (value) => value.startsWith("@") ? value.slice(1) : value,
		});
		if (!didOrHandle) continue;
		did = didOrHandle.startsWith("did:")
			? didOrHandle
			: await idResolver.handle.resolve(didOrHandle);
		if (!did) {
			console.log(`Could not resolve "${didOrHandle}" to a valid account. Please try again.`);
		}
	}
	return did;
}

async function confirm(message: string) {
	let confirmed = false;
	while (!confirmed) {
		const { confirm } = await prompt({ type: "confirm", name: "confirm", message });
		confirmed = confirm;
	}
}

async function promptLabelDefinitions() {
	const definitions: Array<ComAtprotoLabelDefs.LabelValueDefinition> = [];
	let addAnother = true;
	while (addAnother) {
		console.log("Enter the details for the next label you would like this labeler to apply.");
		console.log("Press Esc or Ctrl+C to exit at any time with the labels defined so far.");
		const {
			identifier,
			name,
			description,
			adultOnly,
			severity,
			blurs,
			defaultSetting,
			addAnother: _addAnother,
		} = await prompt([{
			type: "text",
			name: "identifier",
			message: "Identifier (non-user-facing, must be unique, 100 characters max):",
			validate: (value) => {
				if (!value) return "Required.";
				if (value.length > 100) return "Must be <= 100 characters.";
				if (definitions.some((d) => d.identifier === value)) return "Must be unique.";
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
		}, {
			type: "confirm",
			name: "addAnother",
			message: "Add another label definition?",
			initial: true,
		}]);
		addAnother = _addAnother;

		definitions.push({
			identifier,
			adultOnly,
			severity,
			blurs,
			defaultSetting,
			locales: [{ lang: "en", name, description }],
		});
	}

	return definitions;
}
