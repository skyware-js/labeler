import type { ComAtprotoLabelQueryLabels } from "@atcute/atproto";
import { Did, isDid } from "@atcute/lexicons/syntax";
import type { ToolsOzoneModerationEmitEvent } from "@atcute/ozone";
import { XRPCError } from "@atcute/xrpc-server";

import { fastifyWebsocket } from "@fastify/websocket";
import { Client, Config, createClient } from "@libsql/client";
import fastify, {
	type FastifyInstance,
	type FastifyListenOptions,
	type FastifyRequest,
} from "fastify";
import type { WebSocket } from "ws";
import { parsePrivateKey, verifyJwt } from "./util/crypto.js";
import { formatLabel, toSignedLabel } from "./util/labels.js";
import type {
	CreateLabelData,
	LabelSubject,
	ProcedureHandler,
	QueryHandler,
	SavedLabel,
	SignedLabel,
	SubscriptionHandler,
	UnsignedLabel,
} from "./util/types.js";
import { excludeNullish, frameToBytes } from "./util/util.js";

const INVALID_DID_ERROR =
	`Make sure to provide a valid DID using either did:plc or did:web methods.`;
const INVALID_SIGNING_KEY_ERROR = `Make sure to provide a private signing key, not a public key.

If you don't have a key, generate and set one using the \`npx @skyware/labeler setup\` command or the \`import { plcSetupLabeler } from "@skyware/labeler/scripts"\` function.
For more information, see https://skyware.js.org/guides/labeler/introduction/getting-started/`;

/**
 * Options for the {@link LabelerServer} class.
 */
export interface LabelerOptions {
	/** The DID of the labeler account. */
	did: string;

	/**
	 * The private signing key used for the labeler.
	 * If you don't have a key, generate and set one using {@link plcSetupLabeler}.
	 */
	signingKey: string;

	/**
	 * A function that returns whether a DID is authorized to create labels.
	 * By default, only the labeler account is authorized.
	 * @param did The DID to check.
	 */
	auth?: (did: string) => boolean | Promise<boolean>;

	/**
	 * The path to the SQLite `.db` database file.
	 * @default labels.db
	 */
	dbPath?: string;

	/**
	 * The URL of the remote SQLite database.
	 * If provided, {@link dbPath} is ignored.
	 */
	dbUrl?: string;

	/**
	 * The authentication token for the remote SQLite database.
	 * Required if {@link dbUrl} is provided.
	 */
	dbToken?: string;
}

interface LabelerContext {
	auth: (did: string) => boolean | Promise<boolean>;
	databaseConfig: Config;
	app: FastifyInstance;
	did: Did;
	signingKey: Uint8Array;
}

export class LabelerServer {
	/** The Fastify application instance. */
	readonly app: FastifyInstance;

	/** The DID of the labeler account. */
	readonly did: Did;

	/** The SQLite database instance. */
	private db: Client;

	/** A function that returns whether a DID is authorized to create labels. */
	private auth: (did: string) => boolean | Promise<boolean>;

	/** Open WebSocket connections, mapped by request NSID. */
	private connections = new Map<string, Set<WebSocket>>();

	/** The signing key used for the labeler. */
	readonly #signingKey: Uint8Array;

	/**
	 * Promise that resolves when database initialization is complete. This should
	 * be awaited before any database operations. It is automatically awaited
	 * before starting the server.
	 */
	readonly #dbInitLock?: Promise<void>;

	/**
	 * @private
	 */
	constructor(context: LabelerContext) {
		this.app = context.app;
		this.did = context.did;
		this.auth = context.auth;
		this.#signingKey = context.signingKey;

		this.db = createClient(context.databaseConfig);
		this.#dbInitLock = this.initializeDatabase();

		// Register the routes:
		this.app.get("/xrpc/com.atproto.label.queryLabels", this.queryLabelsHandler);
		this.app.post("/xrpc/tools.ozone.moderation.emitEvent", this.emitEventHandler);
		this.app.get(
			"/xrpc/com.atproto.label.subscribeLabels",
			{ websocket: true },
			this.subscribeLabelsHandler,
		);
		this.app.get("/xrpc/_health", this.healthHandler);
		this.app.get("/xrpc/*", this.unknownMethodHandler);
		this.app.setErrorHandler(this.errorHandler);
	}

	/**
	 * Create a labeler server.
	 * @param options Configuration options.
	 */
	static async create(options: LabelerOptions): Promise<LabelerServer> {
		if (!isDid(options.did)) {
			throw new Error(INVALID_DID_ERROR);
		}

		let signingKey;
		try {
			if (options.signingKey.startsWith("did:key:")) throw 0;
			signingKey = parsePrivateKey(options.signingKey);
			if (signingKey.byteLength !== 32) throw 0;
		} catch {
			throw new Error(INVALID_SIGNING_KEY_ERROR);
		}

		let databaseConfig: Config = { url: "file:" + (options.dbPath ?? "labels.db") };

		if (options.dbUrl) {
			if (!options.dbToken) {
				throw new Error(
					"The `dbToken` option is required when using a remote database URL.",
				);
			}
			databaseConfig = { url: options.dbUrl, authToken: options.dbToken };
		}

		const app = fastify();
		await app.register(fastifyWebsocket);

		return new LabelerServer({
			databaseConfig,
			app,
			signingKey,
			did: options.did,
			auth: typeof options.auth === "function" ? options.auth : (did) => did === options.did,
		});
	}

	/**
	 * Initializes the database with the required schema.
	 * @returns A promise that resolves when initialization is complete
	 */
	private async initializeDatabase() {
		await this.db.execute("PRAGMA journal_mode = WAL").catch(() => {
			console.warn(
				"Unable to set WAL mode — performance and concurrent access may be impacted.",
			);
		});

		await this.db.execute(`
			CREATE TABLE IF NOT EXISTS labels (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				src TEXT NOT NULL,
				uri TEXT NOT NULL,
				cid TEXT,
				val TEXT NOT NULL,
				neg BOOLEAN DEFAULT FALSE,
				cts DATETIME NOT NULL,
				exp DATETIME,
				sig BLOB
			);
		`).catch((error) => {
			console.error("Failed to initialize database:", error);
			throw error;
		});
	}

	/**
	 * Start the server.
	 * @param port The port to listen on.
	 * @returns address of the server
	 */
	async start(port: number): Promise<string>;
	/**
	 * Start the server.
	 * @param options Options for the server.
	 * @returns address of the server
	 */
	async start(options: FastifyListenOptions): Promise<string>;
	async start(portOrOptions: number | FastifyListenOptions) {
		// ensure the database is setup prior to listening:
		await this.#dbInitLock;

		const options = typeof portOrOptions === "number" ? { port: portOrOptions } : portOrOptions;

		return await this.app.listen(options);
	}

	/**
	 * Stop the server & closes the database:
	 */
	async stop(): Promise<void> {
		await this.app.close();
		this.db.close();
	}

	/**
	 * Insert a label into the database, emitting it to subscribers.
	 * @param label The label to insert.
	 * @returns The inserted label.
	 */
	private async saveLabel(label: UnsignedLabel): Promise<SavedLabel> {
		const signed = toSignedLabel(label, this.#signingKey);
		const { src, uri, cid, val, neg, cts, exp, sig } = signed;

		const sql = `
    		INSERT INTO labels (src, uri, cid, val, neg, cts, exp, sig)
    		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    		RETURNING id
		`;

		const args = [src, uri, cid || null, val, neg ? 1 : 0, cts, exp || null, sig];

		const result = await this.db.execute({ sql, args });
		if (!result.rows.length) throw new Error("Failed to insert label");

		const id = Number(result.rows[0].id);

		this.emitLabel(id, signed);
		return { id, ...formatLabel(signed) };
	}

	/**
	 * Create and insert a label into the database, emitting it to subscribers.
	 * @param label The label to create.
	 * @returns The created label.
	 */
	async createLabel(label: CreateLabelData): Promise<SavedLabel> {
		// Ensure the database is setup prior to creating any labels:
		await this.#dbInitLock;

		return await this.saveLabel(
			excludeNullish({
				...label,
				src: (label.src ?? this.did),
				cts: label.cts ?? new Date().toISOString(),
			}),
		);
	}

	/**
	 * Create and insert labels into the database, emitting them to subscribers.
	 * @param subject The subject of the labels.
	 * @param labels The labels to create.
	 * @returns The created labels.
	 */
	async createLabels(
		subject: LabelSubject,
		labels: { create?: Array<string>; negate?: Array<string> },
	): Promise<Array<SavedLabel>> {
		// Ensure the database is setup prior to creating any labels:
		await this.#dbInitLock;

		const { create, negate } = labels;

		const createdLabels: Array<SavedLabel> = [];
		if (create) {
			for (const val of create) {
				const created = await this.createLabel({ ...subject, val });
				createdLabels.push(created);
			}
		}
		if (negate) {
			for (const val of negate) {
				const negated = await this.createLabel({ ...subject, val, neg: true });
				createdLabels.push(negated);
			}
		}
		return createdLabels;
	}

	/**
	 * Emit a label to all subscribers.
	 * @param seq The label's id.
	 * @param label The label to emit.
	 */
	private emitLabel(seq: number, label: SignedLabel) {
		const bytes = frameToBytes("message", { seq, labels: [formatLabel(label)] }, "#labels");
		this.connections.get("com.atproto.label.subscribeLabels")?.forEach((ws) => {
			ws.send(bytes);
		});
	}

	/**
	 * Parse a user DID from an Authorization header JWT.
	 * @param req The Express request object.
	 */
	private async parseAuthHeaderDid(req: FastifyRequest): Promise<string> {
		const authHeader = req.headers.authorization;
		if (!authHeader) {
			throw new XRPCError({
				status: 401,
				error: "AuthRequired",
				description: "Authorization header is required",
			});
		}

		const [type, token] = authHeader.split(" ");
		if (type !== "Bearer" || !token) {
			throw new XRPCError({
				status: 400,
				error: "MissingJwt",
				description: "Missing or invalid bearer token",
			});
		}

		const nsid = (req.originalUrl || req.url || "").split("?")[0].replace("/xrpc/", "").replace(
			/\/$/,
			"",
		);

		const payload = await verifyJwt(token, this.did, nsid);

		return payload.iss;
	}

	/**
	 * Handler for [com.atproto.label.queryLabels](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/label/queryLabels.json).
	 */
	private queryLabelsHandler: QueryHandler<ComAtprotoLabelQueryLabels.$params> = async (
		req,
		res,
	) => {
		let uriPatterns: Array<string>;
		if (!req.query.uriPatterns) {
			uriPatterns = [];
		} else if (typeof req.query.uriPatterns === "string") {
			uriPatterns = [req.query.uriPatterns];
		} else {
			uriPatterns = req.query.uriPatterns || [];
		}

		let sources: Array<string>;
		if (!req.query.sources) {
			sources = [];
		} else if (typeof req.query.sources === "string") {
			sources = [req.query.sources];
		} else {
			sources = req.query.sources || [];
		}

		const cursor = parseInt(`${req.query.cursor || 0}`, 10);
		if (cursor !== undefined && Number.isNaN(cursor)) {
			throw new XRPCError({
				status: 400,
				error: "InvalidRequest",
				description: "Cursor must be an integer",
			});
		}

		const limit = parseInt(`${req.query.limit || 50}`, 10);
		if (Number.isNaN(limit) || limit < 1 || limit > 250) {
			throw new XRPCError({
				status: 400,
				error: "InvalidRequest",
				description: "Limit must be an integer between 1 and 250",
			});
		}

		const patterns = uriPatterns.includes("*") ? [] : uriPatterns.map((pattern) => {
			pattern = pattern.replaceAll(/%/g, "").replaceAll(/_/g, "\\_");

			const starIndex = pattern.indexOf("*");
			if (starIndex === -1) return pattern;

			if (starIndex !== pattern.length - 1) {
				throw new XRPCError({
					status: 400,
					error: "InvalidRequest",
					description: "Only trailing wildcards are supported in uriPatterns",
				});
			}
			return pattern.slice(0, -1) + "%";
		});

		const conditions: string[] = [];
		const params: any[] = [];

		if (patterns.length) {
			conditions.push("(" + patterns.map(() => "uri LIKE ?").join(" OR ") + ")");
			params.push(...patterns);
		}

		if (sources.length) {
			conditions.push(`src IN (${sources.map(() => "?").join(", ")})`);
			params.push(...sources);
		}

		if (cursor) {
			conditions.push("id > ?");
			params.push(cursor);
		}

		params.push(limit);

		const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
		const result = await this.db.execute({
			sql: `
				SELECT * FROM labels
				${whereClause}
				ORDER BY id ASC
				LIMIT ?
			`,
			args: params,
		});

		const rows = result.rows.map((row) => ({
			id: Number(row.id),
			src: row.src as Did,
			uri: row.uri as string,
			val: row.val as string,
			neg: Boolean(row.neg),
			cts: row.cts as string,
			...(row.cid ? { cid: row.cid as string } : {}),
			...(row.exp ? { exp: row.exp as string } : {}),
			...(row.sig ? { sig: new Uint8Array(row.sig as ArrayBuffer) } : {}),
		}));
		const labels = rows.map(formatLabel);

		const nextCursor = rows[rows.length - 1]?.id?.toString(10) || "0";

		await res.send({ cursor: nextCursor, labels } satisfies ComAtprotoLabelQueryLabels.$output);
	};

	/**
	 * Handler for [com.atproto.label.subscribeLabels](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/label/subscribeLabels.json).
	 */
	private subscribeLabelsHandler: SubscriptionHandler<{ cursor?: string }> = async (ws, req) => {
		const cursor = parseInt(req.query.cursor ?? "NaN", 10);

		if (!Number.isNaN(cursor)) {
			const latest = await this.db.execute({
				sql: "SELECT MAX(id) AS id FROM labels",
				args: [],
			});
			if (cursor > (Number(latest.rows[0]?.id) ?? 0)) {
				const errorBytes = frameToBytes("error", {
					error: "FutureCursor",
					message: "Cursor is in the future",
				});
				ws.send(errorBytes);
				ws.terminate();
			}

			try {
				const result = await this.db.execute({
					sql: `
						SELECT * FROM labels
						WHERE id > ?
						ORDER BY id ASC
					`,
					args: [cursor],
				});

				for (const row of result.rows) {
					const { id: seq, src, uri, cid, val, neg, cts, exp, sig } = row;
					const label = {
						src: src as Did,
						uri: uri as string,
						val: val as string,
						neg: Boolean(neg),
						cts: cts as string,
						...(cid ? { cid: cid as string } : {}),
						...(exp ? { exp: exp as string } : {}),
						...(sig ? { sig: new Uint8Array(sig as ArrayBuffer) } : {}),
					};
					const bytes = frameToBytes("message", {
						seq: Number(seq),
						labels: [formatLabel(label)],
					}, "#labels");
					ws.send(bytes);
				}
			} catch (e) {
				console.error(e);
				const errorBytes = frameToBytes("error", {
					error: "InternalServerError",
					message: "An unknown error occurred",
				});
				ws.send(errorBytes);
				ws.terminate();
			}
		}

		this.addSubscription("com.atproto.label.subscribeLabels", ws);

		ws.on("close", () => {
			this.removeSubscription("com.atproto.label.subscribeLabels", ws);
		});
	};

	/**
	 * Handler for [tools.ozone.moderation.emitEvent](https://github.com/bluesky-social/atproto/blob/main/lexicons/tools/ozone/moderation/emitEvent.json).
	 */
	private emitEventHandler: ProcedureHandler<ToolsOzoneModerationEmitEvent.$output> = async (
		req,
		res,
	) => {
		const actorDid = await this.parseAuthHeaderDid(req);
		const authed = await this.auth(actorDid);
		if (!authed) {
			throw new XRPCError({
				status: 401,
				error: "AuthRequired",
				description: "Unauthorized",
			});
		}

		const { event, subject, subjectBlobCids = [], createdBy } = req.body;
		if (!event || !subject || !createdBy) {
			throw new XRPCError({
				status: 400,
				error: "InvalidRequest",
				description: "Missing required field(s)",
			});
		}

		if (event.$type !== "tools.ozone.moderation.defs#modEventLabel") {
			throw new XRPCError({
				status: 400,
				error: "InvalidRequest",
				description: "Unsupported event type",
			});
		}

		if (!event.createLabelVals?.length && !event.negateLabelVals?.length) {
			throw new XRPCError({
				status: 400,
				error: "InvalidRequest",
				description: "Must provide at least one label value",
			});
		}

		const uri = subject.$type === "com.atproto.admin.defs#repoRef"
			? subject.did
			: subject.$type === "com.atproto.repo.strongRef"
			? subject.uri
			: null;
		const cid = subject.$type === "com.atproto.repo.strongRef" ? subject.cid : undefined;

		if (!uri) {
			throw new XRPCError({
				status: 400,
				error: "InvalidRequest",
				description: "Invalid subject",
			});
		}

		const labelSubject: LabelSubject = { uri };
		if (cid) {
			labelSubject.cid = cid;
		}

		const labels = await this.createLabels(labelSubject, {
			create: event.createLabelVals,
			negate: event.negateLabelVals,
		});

		if (!labels.length || !labels[0]?.id) {
			throw new Error(`No labels were created\nEvent:\n${JSON.stringify(event, null, 2)}`);
		}

		await res.send(
			{
				id: labels[0].id,
				event,
				subject,
				subjectBlobCids,
				createdBy,
				createdAt: new Date().toISOString(),
			} satisfies ToolsOzoneModerationEmitEvent.$output,
		);
	};

	/**
	 * Handler for the health check endpoint.
	 */
	private healthHandler: QueryHandler = async (_req, res) => {
		const VERSION = "0.2.0";
		try {
			await this.db.execute({ sql: "SELECT 1", args: [] });
			return res.send({ version: VERSION });
		} catch (e) {
			return res.status(503).send({ version: VERSION, error: "Service Unavailable" });
		}
	};

	/**
	 * Catch-all handler for unknown XRPC methods.
	 */
	private unknownMethodHandler: QueryHandler = async (_req, res) =>
		res.status(501).send({ error: "MethodNotImplemented", message: "Method Not Implemented" });

	/**
	 * Default error handler.
	 */
	private errorHandler: typeof this.app.errorHandler = async (err, _req, res) => {
		if (err instanceof XRPCError) {
			return res.status(err.status).send({ error: err.error, message: err.description });
		} else {
			console.error(err);
			return res.status(500).send({
				error: "InternalServerError",
				message: "An unknown error occurred",
			});
		}
	};

	/**
	 * Add a WebSocket connection to the list of subscribers for a given lexicon.
	 * @param nsid The NSID of the lexicon to subscribe to.
	 * @param ws The WebSocket connection to add.
	 */
	private addSubscription(nsid: string, ws: WebSocket) {
		const subs = this.connections.get(nsid) ?? new Set();
		subs.add(ws);
		this.connections.set(nsid, subs);
	}

	/**
	 * Remove a WebSocket connection from the list of subscribers for a given lexicon.
	 * @param nsid The NSID of the lexicon to unsubscribe from.
	 * @param ws The WebSocket connection to remove.
	 */
	private removeSubscription(nsid: string, ws: WebSocket) {
		const subs = this.connections.get(nsid);
		if (subs) {
			subs.delete(ws);
			if (!subs.size) this.connections.delete(nsid);
		}
	}
}
