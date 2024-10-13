import "@atcute/ozone/lexicons";
import { XRPCError } from "@atcute/client";
import type {
	At,
	ComAtprotoLabelQueryLabels,
	ToolsOzoneModerationEmitEvent,
} from "@atcute/client/lexicons";
import { fastifyWebsocket } from "@fastify/websocket";
import Database, { type Database as SQLiteDatabase } from "better-sqlite3";
import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { fromString as ui8FromString } from "uint8arrays";
import type { WebSocket } from "ws";
import { verifyJwt } from "./util/crypto.js";
import { formatLabel, labelIsSigned, signLabel } from "./util/labels.js";
import type {
	CreateLabelData,
	Label,
	ProcedureHandler,
	QueryHandler,
	SavedLabel,
	SubscriptionHandler,
} from "./util/types.js";
import { excludeNullish, frameToBytes } from "./util/util.js";

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
}

export class LabelerServer {
	/** The Fastify application instance. */
	app: FastifyInstance;

	/** The SQLite database instance. */
	db: SQLiteDatabase;

	/** The DID of the labeler account. */
	did: At.DID;

	/** A function that returns whether a DID is authorized to create labels. */
	private auth: (did: string) => boolean | Promise<boolean>;

	/** Open WebSocket connections, mapped by request NSID. */
	private connections = new Map<string, Set<WebSocket>>();

	/** The signing key used for the labeler. */
	#signingKey: Uint8Array;

	/**
	 * Create a labeler server.
	 * @param options Configuration options.
	 */
	constructor(options: LabelerOptions) {
		this.did = options.did as At.DID;
		this.#signingKey = ui8FromString(options.signingKey, "hex");
		this.auth = options.auth ?? ((did) => did === this.did);

		this.db = new Database(options.dbPath ?? "labels.db");
		this.db.pragma("journal_mode = WAL");
		this.db.exec(`
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
		`);

		this.app = fastify();
		void this.app.register(fastifyWebsocket).then(() => {
			this.app.get("/xrpc/com.atproto.label.queryLabels", this.queryLabelsHandler);
			this.app.post("/xrpc/tools.ozone.moderation.emitEvent", this.emitEventHandler);
			this.app.get(
				"/xrpc/com.atproto.label.subscribeLabels",
				{ websocket: true },
				this.subscribeLabelsHandler,
			);
			this.app.get("/xrpc/*", this.unknownMethodHandler);
			this.app.setErrorHandler(this.errorHandler);
		});
	}

	/**
	 * Start the server.
	 * @param port The port to listen on.
	 * @param callback A callback to run when the server is started.
	 */
	start(port: number, callback: (error: Error | null, address: string) => void = () => {}) {
		this.app.listen({ port }, callback);
	}

	/**
	 * Stop the server.
	 * @param callback A callback to run when the server is stopped.
	 */
	stop(callback: () => void = () => {}) {
		this.app.close(callback);
	}

	/**
	 * Insert a label into the database, emitting it to subscribers.
	 * @param label The label to insert.
	 * @returns The inserted label.
	 */
	private saveLabel(label: Label): SavedLabel {
		const signed = labelIsSigned(label) ? label : signLabel(label, this.#signingKey);

		const stmt = this.db.prepare(`
			INSERT INTO labels (src, uri, cid, val, neg, cts, exp, sig)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const { src, uri, cid, val, neg, cts, exp, sig } = signed;
		const result = stmt.run(src, uri, cid, val, neg ? 1 : 0, cts, exp, sig);
		if (!result.changes) throw new Error("Failed to insert label");

		const id = Number(result.lastInsertRowid);

		this.emitLabel(id, signed);
		return { id, ...signed };
	}

	/**
	 * Create and insert a label into the database, emitting it to subscribers.
	 * @param label The label to create.
	 * @returns The created label.
	 */
	createLabel(label: CreateLabelData): SavedLabel {
		return this.saveLabel(
			excludeNullish({
				...label,
				src: (label.src ?? this.did) as At.DID,
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
	createLabels(
		subject: { uri: string; cid?: string | undefined },
		labels: { create?: Array<string>; negate?: Array<string> },
	): Array<SavedLabel> {
		const { uri, cid } = subject;
		const { create, negate } = labels;

		const createdLabels: Array<SavedLabel> = [];
		if (create) {
			for (const val of create) {
				const created = this.createLabel({ uri, cid, val });
				createdLabels.push(created);
			}
		}
		if (negate) {
			for (const val of negate) {
				const negated = this.createLabel({ uri, cid, val, neg: true });
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
	private emitLabel(seq: number, label: Label) {
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
			throw new XRPCError(401, {
				kind: "AuthRequired",
				description: "Authorization header is required",
			});
		}

		const [type, token] = authHeader.split(" ");
		if (type !== "Bearer" || !token) {
			throw new XRPCError(400, {
				kind: "MissingJwt",
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
	queryLabelsHandler: QueryHandler<ComAtprotoLabelQueryLabels.Params> = async (req, res) => {
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
			throw new XRPCError(400, {
				kind: "InvalidRequest",
				description: "Cursor must be an integer",
			});
		}

		const limit = parseInt(`${req.query.limit || 50}`, 10);
		if (Number.isNaN(limit) || limit < 1 || limit > 250) {
			throw new XRPCError(400, {
				kind: "InvalidRequest",
				description: "Limit must be an integer between 1 and 250",
			});
		}

		const patterns = uriPatterns.includes("*") ? [] : uriPatterns.map((pattern) => {
			pattern = pattern.replaceAll(/%/g, "").replaceAll(/_/g, "\\_");

			const starIndex = pattern.indexOf("*");
			if (starIndex === -1) return pattern;

			if (starIndex !== pattern.length - 1) {
				throw new XRPCError(400, {
					kind: "InvalidRequest",
					description: "Only trailing wildcards are supported in uriPatterns",
				});
			}
			return pattern.slice(0, -1) + "%";
		});

		const stmt = this.db.prepare<unknown[], SavedLabel>(`
			SELECT * FROM labels
			WHERE 1 = 1
			${patterns.length ? "AND " + patterns.map(() => "uri LIKE ?").join(" OR ") : ""}
			${sources.length ? `AND src IN (${sources.map(() => "?").join(", ")})` : ""}
			${cursor ? "AND id > ?" : ""}
			ORDER BY id ASC
			LIMIT ?
		`);

		const params = [];
		if (patterns.length) params.push(...patterns);
		if (sources.length) params.push(...sources);
		if (cursor) params.push(cursor);
		params.push(limit);

		const rows = stmt.all(params);
		const labels = rows.map(formatLabel);

		const nextCursor = rows[rows.length - 1]?.id?.toString(10) || "0";

		await res.send({ cursor: nextCursor, labels });
	};

	/**
	 * Handler for [com.atproto.label.subscribeLabels](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/label/subscribeLabels.json).
	 */
	subscribeLabelsHandler: SubscriptionHandler<{ cursor?: string }> = (ws, req) => {
		const cursor = parseInt(req.query.cursor ?? "NaN", 10);

		if (!Number.isNaN(cursor)) {
			const latest = this.db.prepare(`
				SELECT MAX(id) AS id FROM labels
			`).get() as { id: number };
			if (cursor > (latest.id ?? 0)) {
				const errorBytes = frameToBytes("error", {
					error: "FutureCursor",
					message: "Cursor is in the future",
				});
				ws.send(errorBytes);
				ws.terminate();
			}

			const stmt = this.db.prepare<[number], SavedLabel>(`
				SELECT * FROM labels
				WHERE id > ?
				ORDER BY id ASC
			`);

			try {
				for (const row of stmt.iterate(cursor)) {
					const { id: seq, ...label } = row;
					const bytes = frameToBytes(
						"message",
						{ seq, labels: [formatLabel(label)] },
						"#labels",
					);
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
	emitEventHandler: ProcedureHandler<ToolsOzoneModerationEmitEvent.Input> = async (req, res) => {
		const actorDid = await this.parseAuthHeaderDid(req);
		const authed = await this.auth(actorDid);
		if (!authed) {
			throw new XRPCError(401, { kind: "AuthRequired", description: "Unauthorized" });
		}

		const { event, subject, subjectBlobCids = [], createdBy } = req.body;
		if (!event || !subject || !createdBy) {
			throw new XRPCError(400, {
				kind: "InvalidRequest",
				description: "Missing required field(s)",
			});
		}

		if (event.$type !== "tools.ozone.moderation.defs#modEventLabel") {
			throw new XRPCError(400, {
				kind: "InvalidRequest",
				description: "Unsupported event type",
			});
		}

		if (!event.createLabelVals?.length && !event.negateLabelVals?.length) {
			throw new XRPCError(400, {
				kind: "InvalidRequest",
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
			throw new XRPCError(400, { kind: "InvalidRequest", description: "Invalid subject" });
		}

		const labels = this.createLabels({ uri, cid }, {
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
			} satisfies ToolsOzoneModerationEmitEvent.Output,
		);
	};

	/**
	 * Catch-all handler for unknown XRPC methods.
	 */
	unknownMethodHandler: QueryHandler = async (_req, res) =>
		res.status(501).send({ error: "MethodNotImplemented", message: "Method Not Implemented" });

	/**
	 * Default error handler.
	 */
	errorHandler: typeof this.app.errorHandler = async (err, _req, res) => {
		if (err instanceof XRPCError) {
			return res.status(err.status).send({ error: err.kind, message: err.description });
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
