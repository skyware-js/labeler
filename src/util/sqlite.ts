import Database, { type Database as SQLiteDatabase } from "libsql";
import type {
	DBCallbacks,
	SavedLabel,
} from "./types.js";

/**
 * Creates the default set of sqlite callbacks
 */
export const createSqliteCallbacks: () => DBCallbacks = () => {
	let db: SQLiteDatabase;
	return {
		async connect(options) {
			db = new Database(options.dbPath ?? "labels.db");
			db.pragma("journal_mode = WAL");
			db.exec(`
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
		},
		async close() {
			db.close();
		},
		async createLabel(label) {
			const stmt = db.prepare(`
				INSERT INTO labels (src, uri, cid, val, neg, cts, exp, sig)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`);
	
			const { src, uri, cid, val, neg, cts, exp, sig } = label;
			const result = stmt.run(src, uri, cid, val, neg ? 1 : 0, cts, exp, sig);
			if (!result.changes) throw new Error("Failed to insert label");
	
			const id = Number(result.lastInsertRowid);

			return { id, ...label };
		},
		async findLabels(query) {
			const { uriPatterns: patterns, sources, after: cursor, limit} = query;

			const stmt = db.prepare(`
				SELECT * FROM labels
				WHERE 1 = 1
				${patterns?.length ? "AND " + patterns.map(() => "uri LIKE ?").join(" OR ") : ""}
				${sources?.length ? `AND src IN (${sources.map(() => "?").join(", ")})` : ""}
				${cursor ? "AND id > ?" : ""}
				ORDER BY id ASC
				LIMIT ?
			`);
	
			const params = [];
			if (patterns?.length) params.push(...patterns);
			if (sources?.length) params.push(...sources);
			if (cursor) params.push(cursor);
			params.push(limit);
	
			const rows = stmt.all(params) as Array<SavedLabel>;

			return rows;
		},
		async getLatestLabel() {
			const stmt = db.prepare(`
				SELECT * FROM labels
				ORDER BY id DESC
				LIMIT 1
			`);
	
			return stmt.get() as SavedLabel;
		},
		async getAllLabels(query) {
			const stmt = db.prepare(`
				SELECT * FROM labels
				WHERE id > ?
				ORDER BY id ASC
			`);
	
			return stmt.all(query.after) as Array<SavedLabel>;
		},
	};
}