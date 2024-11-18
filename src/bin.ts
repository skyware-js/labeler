#!/usr/bin/env node
import { XRPCError } from "@atcute/client";
import type { ComAtprotoLabelDefs } from "@atcute/client/lexicons";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import prompt from "prompts";
import {
	declareLabeler,
	deleteLabelerDeclaration,
	getLabelerLabelDefinitions,
	LoginCredentials,
	plcClearLabeler,
	plcRequestToken,
	plcSetupLabeler,
	setLabelerLabelDefinitions,
} from "./scripts/index.js";
import { loginAgent } from "./scripts/util.js";
import { resolveHandle } from "./util/resolveHandle.js";

const argv = process.argv.slice(2);
const [command, subcommand, ...args] = argv;

if (command === "setup" || command === "clear") {
	const credentials = await promptCredentials();

	await plcRequestToken(credentials);

	const { plcToken } = await prompt({
		type: "text",
		name: "plcToken",
		message: "You will receive a confirmation code via email. Code:",
	}, { onCancel: () => process.exit(1) });

	if (command === "setup") {
		try {
			const { endpoint, privateKey } = await prompt([{
				type: "text",
				name: "endpoint",
				message: "URL where the labeler will be hosted:",
				validate: (value) => value.startsWith("https://") || "Must be a valid HTTPS URL.",
			}, {
				type: "text",
				name: "privateKey",
				message: "Enter a signing key to use, or leave blank to generate a new one:",

				validate: (value) => {
					if (!value) return true;
					if (/^[0-9a-f]*$/.test(value)) return true;
					if (/^[A-Za-z0-9+/=]+$/.test(value)) return true;
					return "Must be a hex or base64-encoded string.";
				},
			}], { onCancel: () => process.exit(1) });

			const operation = await plcSetupLabeler({
				...credentials,
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
				await declareLabeler(credentials, labelDefinitions, true);
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
			await plcClearLabeler({ ...credentials, plcToken });
			await deleteLabelerDeclaration(credentials);
			console.log("Labeler data cleared.");
		} catch (error) {
			console.error("Error setting up labeler:", error);
		}
	}
} else if (command === "recreate") {
	const credentials = await promptCredentials();

	const definitions = await getLabelerLabelDefinitions(credentials);
	if (!definitions) {
		console.log("No label definitions found.");
		process.exit(0);
	}

	try {
		await deleteLabelerDeclaration(credentials);
		await declareLabeler(credentials, definitions);
		console.log("Labeler declaration recreated.");
	} catch (error) {
		console.error("Error recreating labeler declaration:", error);
	}
} else if (
	command === "label"
	&& (subcommand === "add" || subcommand === "delete" || subcommand === "edit")
) {
	const credentials = await promptCredentials();
	const labelDefinitions = await getLabelerLabelDefinitions(credentials) ?? [];

	if (subcommand === "add") {
		console.log(
			"Now define a name, description, and settings for each of the labels you want to add.",
		);
		const newDefinitions = await promptLabelDefinitions();
		if (newDefinitions.length) {
			const definitions = [...labelDefinitions, ...newDefinitions];

			try {
				await setLabelerLabelDefinitions(credentials, definitions);
				console.log("Declared label(s):", definitions.map((d) => d.identifier).join(", "));
			} catch (error) {
				console.error("Error adding label(s):", error);
			}
		} else {
			console.log("No labels were defined.");
		}
	} else if (subcommand === "delete") {
		if (!labelDefinitions.length) {
			console.log(
				"No labels are currently declared. Use the `label add` command to define new labels.",
			);
			process.exit(0);
		}

		const identifiers = args.length
			? args
			: (await prompt({
				type: "multiselect",
				name: "identifiers",
				message: "Select the labels to remove",
				min: 1,
				choices: labelDefinitions.map((def) => ({
					title: def.locales[0].name,
					value: def.identifier,
				})),
			}, { onCancel: () => process.exit(1) })).identifiers;

		const [newDefinitions, removedIdentifiers] = labelDefinitions.reduce<
			[Array<ComAtprotoLabelDefs.LabelValueDefinition>, Array<string>]
		>(([newDefs, removed], def) => {
			if (!identifiers.includes(def.identifier)) {
				newDefs.push(def);
			} else {
				removed.push(def.identifier);
			}
			return [newDefs, removed];
		}, [[], []]);

		try {
			if (removedIdentifiers.length) {
				await setLabelerLabelDefinitions(credentials, newDefinitions);
				console.log("Deleted label(s):", removedIdentifiers.join(", "));
			} else {
				console.log("No labels were selected. Nothing to delete.");
			}
		} catch (error) {
			console.error("Failed to delete labels:", error);
		}
	} else if (subcommand === "edit") {
		const labelDefinitions = await getLabelerLabelDefinitions(credentials) ?? [];

		try {
			const newDefinitions = await editLabelDefinitions(labelDefinitions);
			if (newDefinitions.length) {
				await setLabelerLabelDefinitions(credentials, newDefinitions);
				console.log("Label definitions updated.");
			} else {
				console.log("No changes were made.");
			}
		} catch (error) {
			console.error("Error updating label definitions:", error);
		}
	}
} else {
	console.log("Usage: npx @skyware/labeler [command]");
	console.log("Commands:");
	console.log("  setup - Initialize an account as a labeler.");
	console.log("  clear - Restore a labeler account to normal.");
	console.log(
		"  recreate - Recreate the labeler declaration (recommended if labels are not showing up).",
	);
	console.log("  label add - Add new label declarations to a labeler account.");
	console.log("  label delete - Remove label declarations from a labeler account.");
	console.log("  label edit - Bulk edit label definitions.");
}

async function promptCredentials(): Promise<LoginCredentials> {
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
		did = didOrHandle.startsWith("did:") ? didOrHandle : await resolveHandle(didOrHandle);
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

	const credentials: LoginCredentials = { identifier: did, password, pds };

	try {
		await loginAgent(credentials);
	} catch (error) {
		if (error instanceof XRPCError && error.kind === "AuthFactorTokenRequired") {
			const { code } = await prompt({
				type: "text",
				name: "code",
				message: "You will receive a 2FA code via email. Code:",
				initial: "",
			}, { onCancel: () => process.exit(1) });
			credentials.code = code;
		} else {
			console.error("Error occurred while trying to log in:", error);
			process.exit(1);
		}
	}
	return credentials;
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
): Promise<ComAtprotoLabelDefs.LabelValueDefinition | null> {
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
			choices: [{ title: "None", description: "(no label)", value: "none" }, {
				title: "Informational",
				description: "(neutral)",
				value: "inform",
			}, { title: "Alert", description: "(warning)", value: "alert" }],
		}, {
			type: "select",
			name: "blurs",
			message: "Should this label hide content?",
			choices: [{ title: "None", description: "(no hiding)", value: "none" }, {
				title: "Media",
				description: "(hide media only)",
				value: "media",
			}, { title: "Content", description: "(hide all labeled content)", value: "content" }],
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

async function editLabelDefinitions(
	labelDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>,
): Promise<Array<ComAtprotoLabelDefs.LabelValueDefinition>> {
	// os.tmpdir() returns a symlink on macOS
	const tmpdir = await fs.realpath(os.tmpdir());

	const tmpFile = path.join(tmpdir, "labels.json");
	await fs.writeFile(tmpFile, JSON.stringify(labelDefinitions, null, 4));
	await fs.chmod(tmpFile, 0o600);

	const editor = process.env.VISUAL || process.env.EDITOR || "vi";
	await new Promise<void>((resolve, reject) => {
		const child = spawn(editor, [tmpFile], { stdio: "inherit" });
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Code ${code}`));
			}
		});
	});

	const definitionsText = await fs.readFile(tmpFile, "utf8");
	let newDefinitions: Array<ComAtprotoLabelDefs.LabelValueDefinition>;
	try {
		newDefinitions = JSON.parse(definitionsText);
	} catch (error) {
		throw new Error(
			`Error parsing JSON: ${error}` + "\n\nFull definitions:\n" + definitionsText,
		);
	} finally {
		await fs.unlink(tmpFile);
	}

	if (!Array.isArray(newDefinitions)) {
		throw new Error("Definitions must be an array.\n\nFull definitions:\n" + definitionsText);
	}

	for (const definition of newDefinitions) {
		if (
			!definition || typeof definition !== "object" || !definition.identifier
			|| !definition.locales.length || !definition.blurs || !definition.severity
		) {
			throw new Error(
				"Invalid label definition: " + JSON.stringify(definition)
					+ "\n\nFull definitions:\n"
					+ definitionsText,
			);
		}
	}

	return newDefinitions;
}
