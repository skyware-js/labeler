import { ComAtprotoLabelDefs } from "@atcute/atproto";
import { Bytes, Cid, Datetime, Did } from "@atcute/lexicons";
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

export type LabelUri = `${string}:${string}`;
export type LabelSubject = { uri: LabelUri; cid?: never } | { uri: LabelUri; cid?: Cid };
/**
 * Data required to create a label.
 */
export interface CreateLabelData {
	/** The label value. */
	val: string;
	/** The subject of the label. If labeling an account, this should be a string beginning with `did:`. */
	uri: LabelUri;
	/** Optionally, a CID specifying the version of `uri` to label. */
	cid?: Cid;
	/** Whether this label is negating a previous instance of this label applied to the same subject. */
	neg?: boolean;
	/** The DID of the actor who created this label, if different from the labeler. */
	src?: Did;
	/** The creation date of the label. Must be in ISO 8601 format. */
	cts?: Datetime;
	/** The expiration date of the label, if any. Must be in ISO 8601 format. */
	exp?: Datetime;
}
export type Label = ComAtprotoLabelDefs.Label;
export type UnsignedLabel = Omit<ComAtprotoLabelDefs.Label, "sig">;
export type SignedLabel = UnsignedLabel & { sig: Uint8Array };
export type FormattedLabel = UnsignedLabel & { sig: Bytes };
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
