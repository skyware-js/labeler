#!/usr/bin/env node
import { IdResolver } from "@atproto/identity";
import prompt from "prompts";
import { plcClearLabeler, plcRequestToken, plcSetupLabeler } from "./scripts/index.js";

const args = process.argv.slice(2);
const [command] = args;

const idResolver = new IdResolver();

if (command === "create" || command === "delete") {
	const did = await promptAndResolveDidOrHandle();

	const { password, pds, endpoint } = await prompt([{
		type: "password",
		name: "password",
		message: "Account password (cannot be an app password):",
	}, {
		type: "text",
		name: "pds",
		message: "URL of the PDS where the account is located:",
		initial: "https://bsky.social",
	}, {
		type: "text",
		name: "endpoint",
		message: "URL where the labeler will be hosted:",
		validate: (value) => value.startsWith("https://") || "Must be a valid HTTPS URL.",
	}]);

	await plcRequestToken({ identifier: did, password, pds });

	const { plcToken } = await prompt({
		type: "text",
		name: "plcToken",
		message: "You will receive a login token via email. Token:",
	});

	try {
		if (command === "create") {
			await plcSetupLabeler({ did, password, pds, plcToken, endpoint });
			console.log("Labeler setup complete!");
		} else {
			await plcClearLabeler({ did, password, pds, plcToken });
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
		did = didOrHandle.startsWith("did:")
			? didOrHandle
			: await idResolver.handle.resolve(didOrHandle);
		if (!did) {
			console.log(`Could not resolve "${didOrHandle}" to a valid account. Please try again.`);
		}
	}
	return did;
}
