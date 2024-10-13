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
export type SavedLabel = SignedLabel & { id: number };

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
