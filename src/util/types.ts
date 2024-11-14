import { At, ComAtprotoLabelDefs } from "@atcute/client/lexicons";
import type { WebsocketHandler } from "@fastify/websocket";
import type {
	RawReplyDefaultExpression,
	RawRequestDefaultExpression,
	RawServerDefault,
	RequestGenericInterface,
	RouteGenericInterface,
	RouteHandlerMethod,
} from "fastify";

type NullishKeys<T> = {
	[K in keyof T]: null extends T[K] ? K : undefined extends T[K] ? K : never;
}[keyof T];
type NonNullishKeys<T> = Exclude<keyof T, NullishKeys<T>>;
export type NonNullishPartial<T> =
	& { [K in NullishKeys<T>]+?: Exclude<T[K], null | undefined> }
	& { [K in NonNullishKeys<T>]-?: T[K] };

/**
 * Data required to create a label.
 */
export interface CreateLabelData {
	/** The label value. */
	val: string;
	/** The subject of the label. If labeling an account, this should be a string beginning with `did:`. */
	uri: string;
	/** Optionally, a CID specifying the version of `uri` to label. */
	cid?: string | undefined;
	/** Whether this label is negating a previous instance of this label applied to the same subject. */
	neg?: boolean | undefined;
	/** The DID of the actor who created this label, if different from the labeler. */
	src?: string | undefined;
	/** The creation date of the label. Must be in ISO 8601 format. */
	cts?: string | undefined;
	/** The expiration date of the label, if any. Must be in ISO 8601 format. */
	exp?: string | undefined;
}
export type UnsignedLabel = Omit<ComAtprotoLabelDefs.Label, "sig">;
export type SignedLabel = UnsignedLabel & { sig: Uint8Array };
export type FormattedLabel = UnsignedLabel & { sig?: At.Bytes };
export type SavedLabel = UnsignedLabel & { sig: ArrayBuffer; id: number };

export type QueryHandler<
	T extends RouteGenericInterface["Querystring"] = RouteGenericInterface["Querystring"],
> = RouteHandlerMethod<
	RawServerDefault,
	RawRequestDefaultExpression,
	RawReplyDefaultExpression,
	{ Querystring: T }
>;
export type ProcedureHandler<
	T extends RouteGenericInterface["Body"] = RouteGenericInterface["Body"],
> = RouteHandlerMethod<
	RawServerDefault,
	RawRequestDefaultExpression,
	RawReplyDefaultExpression,
	{ Body: T }
>;
export type SubscriptionHandler<
	T extends RequestGenericInterface["Querystring"] = RequestGenericInterface["Querystring"],
> = WebsocketHandler<RawServerDefault, RawRequestDefaultExpression, { Querystring: T }>;

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
	 * Set database callbacks for all labeler operations.
	 * Only required if you want to bring your own database to LabelerServer
	 */
	dbCallbacks?: DBCallbacks;
}

/**
 * A collection of optional database callbacks for the LabelerService
 * This is only necessary if you're bringing a sevice other than the default
 * sqlite driver, but does make it possible to connect skyware/labeler to any
 * other scalable database (postgres, mysql, turso, etc)
 * 
 * When using your own database, it's important that your label's primary key
 * be sortable. This is because the cursor uses the primary key for pagination.
 */
export type DBCallbacks = {
	/**
	 * Connects to the database and performs any migration or initialization tasks
	 */
	connect: (options: LabelerOptions) => Promise<void>;

	/**
	 * Close the db connection cleanly
	 */
	close: () => Promise<void>;

	/**
	 * Creates a label in the database.
	 * Returns a signed label including the inserted id
	 */
	createLabel: (label: SignedLabel) => Promise<SavedLabel>;

	/**
	 * Finds one or more labels based on the provided query.
	 * Takes in uri patterns, sources, and a cursor.
	 */
	findLabels: (query: {
		uriPatterns?: string[];
		sources?: string[];
		after?: number;
		limit: number;
	}) => Promise<SavedLabel[]>;

	/**
	 * Gets the most recent label in the system. Used to avoid the cursor
	 * going out of bounds from badly behaving clients
	 */
	getLatestLabel: () => Promise<SavedLabel>;

	/**
	 * Get all labels in the system after a given cursor
	 */
	getAllLabels: (query: {after: number}) => Promise<SavedLabel[]>;
}