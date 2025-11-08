import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";

export const handleResolver = new CompositeHandleResolver({
	strategy: "race",
	methods: {
		dns: new DohJsonHandleResolver({ dohUrl: "https://mozilla.cloudflare-dns.com/dns-query" }),
		http: new WellKnownHandleResolver(),
	},
});

export const didResolver = new CompositeDidDocumentResolver({
	methods: { plc: new PlcDidDocumentResolver(), web: new WebDidDocumentResolver() },
});
