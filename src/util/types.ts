import type { ComAtprotoLabelDefs } from "@atproto/api";
import type { WebsocketHandler } from "@fastify/websocket";
import type {
	RawReplyDefaultExpression,
	RawRequestDefaultExpression,
	RawServerDefault,
	RequestGenericInterface,
	RouteGenericInterface,
	RouteHandlerMethod,
} from "fastify";

type OptionalOrUndefinedKeys<T> = { [K in keyof T]: undefined extends T[K] ? K : never }[keyof T];
type RequiredDefinedKeys<T> = Exclude<keyof T, OptionalOrUndefinedKeys<T>>;
export type StrictPartial<T> =
	& { [K in OptionalOrUndefinedKeys<T>]+?: Exclude<T[K], undefined> }
	& { [K in RequiredDefinedKeys<T>]-?: T[K] };

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
export type SignedLabel = ComAtprotoLabelDefs.Label & { sig: Uint8Array };
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
export type SubscriptionHandler<T extends RequestGenericInterface = RequestGenericInterface> =
	WebsocketHandler<RawServerDefault, RawRequestDefaultExpression, T>;
