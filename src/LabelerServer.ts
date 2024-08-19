import express, { type Express } from "express";
import Database, { type Database as SQLiteDatabase } from "better-sqlite3";

export interface LabelerOptions {
	did: string;
	dbFile?: string;
}

export class LabelerServer {
	app: Express = express();

	db: SQLiteDatabase;

	did: string;

	constructor(options: LabelerOptions) {
		this.did = options.did;
		this.db = new Database(options.dbFile ?? "labels.db");
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
	}


}

export interface Label {
	ver?: number;
	src: string;
	uri: string;
	cid?: string;
	val: string;
	neg?: boolean;
	cts: string;
	exp?: string;
	sig?: Buffer
}
