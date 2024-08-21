import { encode as cborEncode } from "@atcute/cbor";
import type { ComAtprotoLabelDefs } from "@atproto/api";
import { Keypair, Secp256k1Keypair } from "@atproto/crypto";
import { ErrorFrame, InvalidRequestError, MessageFrame, XRPCError } from "@atproto/xrpc-server";
import Database, { type Database as SQLiteDatabase } from "better-sqlite3";
import express from "express";
import expressWs, { type Application, WebsocketRequestHandler } from "express-ws";
import { Server } from "node:http";
import { fromString as ui8FromString } from "uint8arrays";
import type { WebSocket } from "ws";
import { SignedLabel, StrictPartial } from "./util.js";

const LABEL_VERSION = 1;

export interface LabelerOptions {
	did: string;
	signingKey: string;
	dbFile?: string;
}

export class LabelerServer {
	app: Application;

	server?: Server;

	db: SQLiteDatabase;

	did: string;

	private signingKey: Keypair;

	private subscriptions = new Set<WebSocket>();

	constructor(options: LabelerOptions) {
		this.did = options.did;
		this.signingKey = new Secp256k1Keypair(ui8FromString(options.signingKey, "hex"), false);

		this.db = new Database(options.dbFile ?? "labels.db");
		this.db.pragma("journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS labels (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				src TEXT NOT NULL,
				uri TEXT NOT NULL,
				cid TEXT NOT NULL,
				val TEXT NOT NULL,
				neg BOOLEAN NOT NULL,
				cts DATETIME NOT NULL,
				exp DATETIME,
				sig BLOB
			);
		`);

		this.app = expressWs(express().use(express.json())).app;
		this.app.get("/xrpc/com.atproto.label.queryLabels", this.queryLabelsHandler);
		this.app.ws("/xrpc/com.atproto.label.subscribeLabels", this.subscribeLabelsHandler);
	}

	start(port = 443, callback?: () => void) {
		this.server = this.app.listen(port, callback);
	}

	stop(callback?: () => void) {
		if (this.server?.listening) this.server?.close(callback);
	}

	async signLabel(label: ComAtprotoLabelDefs.Label): Promise<SignedLabel> {
		const toSign = this.formatLabel(label);
		const bytes = cborEncode(toSign);
		const sig = await this.signingKey.sign(bytes);
		return { ...toSign, sig };
	}

	private formatLabel<T extends ComAtprotoLabelDefs.Label>(label: T): StrictPartial<T> {
		const { src, uri, cid, val, neg, cts, exp } = label;
		return {
			ver: LABEL_VERSION,
			src,
			uri,
			...(cid ? { cid } : {}),
			val,
			...(neg ? { neg } : {}),
			cts,
			...(exp ? { exp } : {}),
		} as never;
	}

	private async ensureSignedLabel(label: ComAtprotoLabelDefs.Label): Promise<SignedLabel> {
		if (!label.sig) {
			const signed = await this.signLabel(label);
			const stmt = this.db.prepare(`
				UPDATE labels
				SET sig = ?
				WHERE id = ?
			`).run(signed.sig, label.id);
			if (!stmt.changes) throw new Error("Failed to update label with signature");
			return signed;
		}
		return this.formatLabel(label) as ComAtprotoLabelDefs.Label & { sig: Uint8Array };
	}

	queryLabelsHandler: express.RequestHandler = async (req, res) => {
		try {
			const { uriPatterns, sources, limit: limitStr, cursor: cursorStr } = req.query as {
				uriPatterns?: Array<string>;
				sources?: Array<string>;
				limit?: string;
				cursor?: string;
			};

			const cursor = cursorStr ? parseInt(cursorStr, 10) : undefined;
			if (cursor && Number.isNaN(cursor)) {
				throw new InvalidRequestError("Cursor must be an integer");
			}

			const limit = parseInt(limitStr ?? "50", 10);
			if (Number.isNaN(limit) || limit < 1 || limit > 250) {
				throw new InvalidRequestError("Limit must be an integer between 1 and 250");
			}

			const patterns = uriPatterns?.includes("*")
				? undefined
				: uriPatterns?.map((pattern) => {
					if (pattern.indexOf("*") !== pattern.length - 1) {
						throw new InvalidRequestError(
							"Only trailing wildcards are supported in uriPatterns",
						);
					}
					return pattern.replaceAll(/%/g, "").replaceAll(/_/g, "\\_").slice(0, -1) + "%";
				});

			const stmt = this.db.prepare<unknown[], ComAtprotoLabelDefs.Label>(`
			SELECT * FROM labels
			${patterns?.length ? patterns.map(() => "WHERE uri LIKE ?").join(" OR ") : ""}
			${sources?.length ? "AND src IN (?)" : ""}
			${cursor ? "AND id > ?" : ""}
			ORDER BY id ASC
			LIMIT ?
		`);

			const rows = stmt.all([...(patterns ?? []), sources ?? [], cursor ?? 0, limit]);

			const labels = await Promise.all(rows.map((row) => this.ensureSignedLabel(row)));
			const nextCursor = rows[rows.length - 1]?.id ?? 0;

			res.json({ cursor: nextCursor, labels });
		} catch (e) {
			if (e instanceof XRPCError) {
				res.status(e.type).json(e.payload);
			} else {
				console.error(e);
				res.status(500).json({
					error: "InternalError",
					message: e instanceof Error ? e.message : "An unknown error occurred",
				});
			}
			return;
		}
	};

	subscribeLabelsHandler: WebsocketRequestHandler = (ws, req) => {
		const cursor = parseInt(req.params.cursor);

		if (cursor && !Number.isNaN(cursor)) {
			const latest = this.db.prepare(`
				SELECT MAX(id) AS id FROM labels
			`).get() as { id: number };
			if (cursor > (latest.id ?? 0)) {
				const errorFrame = new ErrorFrame({
					error: "FutureCursor",
					message: "Cursor is in the future",
				});
				ws.send(errorFrame.toBytes());
				ws.terminate();
			}

			const stmt = this.db.prepare<[number], ComAtprotoLabelDefs.Label>(`
				SELECT * FROM labels
				WHERE id > ?
				ORDER BY id ASC
			`);

			for (const row of stmt.iterate(cursor)) {
				const { id: seq, ...label } = row;
				const frame = new MessageFrame({ seq, labels: [label] }, { type: "#labels" });
				ws.send(frame.toBytes());
			}
		}

		this.subscriptions.add(ws);

		ws.on("close", () => {
			this.subscriptions.delete(ws);
		});
	};
}
