import type { Bytes, CanonicalResourceUri, Cid, Datetime, Did } from "@atcute/lexicons";
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
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type LabelSubject = { uri: string; cid?: never } | { uri: string; cid?: Cid };

/** Base unsigned label. */
export type UnsignedLabel = {
	$type?: "com.atproto.label.defs#label" | undefined;
	/** Optionally, a CID specifying the version of {@link uri} to label. */
	cid?: string | undefined;
	/** The creation date of the label. Must be in ISO 8601 format. */
	cts: Datetime;
	/** The expiration date of the label, if any. Must be in ISO 8601 format. */
	exp?: Datetime | undefined;
	/** Whether this label is negating a previous instance of this label applied to the same subject. */
	neg?: boolean | undefined;
	/** The DID of the actor who created this label. */
	src: string;
	/** The subject of the label. If labeling an account, this should be a DID. Otherwise, an AT URI. */
	uri: string;
	/** The label value. */
	val: string;
	/** The label version. Always 1. */
	ver?: number | undefined;
};
/** Data to create a label. */
export type CreateLabelData = MakeOptional<Omit<UnsignedLabel, "$type" | "ver">, "cts" | "src">;
/** Label to be inserted into database. */
export type SignedLabel = UnsignedLabel & { sig: Uint8Array };
/** Label to be emitted via websocket or XRPC response. */
export type FormattedLabel = UnsignedLabel & {
	src: Did;
	uri: Did | CanonicalResourceUri;
	sig: Bytes;
};
/** Label with id, returned from creation methods. */
export type SavedLabel = FormattedLabel & { id: number };

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
