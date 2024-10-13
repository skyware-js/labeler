import dns from "dns/promises";

export async function resolveHandle(handle: string): Promise<string | undefined> {
	const dnsPromise = resolveDns(handle);
	const httpAbort = new AbortController();
	const httpPromise = resolveHttp(handle, httpAbort.signal).catch(() => undefined);

	const dnsRes = await dnsPromise;
	if (dnsRes) {
		httpAbort.abort();
		return dnsRes;
	}
	const res = await httpPromise;
	if (res) {
		return res;
	}
}

async function resolveDns(handle: string): Promise<string | undefined> {
	let chunkedResults: string[][];
	try {
		chunkedResults = await dns.resolveTxt(`_atproto.${handle}`);
	} catch (err) {
		return undefined;
	}
	return parseDnsResult(chunkedResults);
}

async function resolveHttp(handle: string, signal?: AbortSignal): Promise<string | undefined> {
	const url = new URL("/.well-known/atproto-did", `https://${handle}`);
	try {
		const res = await fetch(url, signal ? { signal } : undefined);
		const did = (await res.text()).split("\n")[0].trim();
		if (typeof did === "string" && did.startsWith("did:")) {
			return did;
		}
		return undefined;
	} catch (err) {
		return undefined;
	}
}

function parseDnsResult(chunkedResults: string[][]): string | undefined {
	const results = chunkedResults.map((chunks) => chunks.join(""));
	const found = results.filter((i) => i.startsWith("did="));
	if (found.length !== 1) {
		return undefined;
	}
	return found[0].slice("did=".length);
}
