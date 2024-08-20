import type { ComAtprotoLabelDefs } from "@atproto/api";
import { ErrorFrame, MessageFrame } from "@atproto/xrpc-server";
import Database, { type Database as SQLiteDatabase } from "better-sqlite3";
import express from "express";
import expressWs, { type Application, WebsocketRequestHandler } from "express-ws";
import { Server } from "node:http";
import type { WebSocket } from "ws";

export interface LabelerOptions {
	did: string;
	dbFile?: string;
}

export class LabelerServer {
	app: Application;

	server?: Server;

	db: SQLiteDatabase;

	did: string;

	private subscriptions = new Set<WebSocket>();

	constructor(options: LabelerOptions) {
		this.did = options.did;

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
		this.app.ws("/xrpc/com.atproto.label.subscribeLabels", this.subscribeLabelsHandler);
	}

	start(port = 443, callback?: () => void) {
		this.server = this.app.listen(port, callback);
	}

	stop(callback?: () => void) {
		if (this.server?.listening) this.server?.close(callback);
	}

	subscribeLabelsHandler: WebsocketRequestHandler = async (ws, req) => {
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
