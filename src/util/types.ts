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

export type StrictPartial<T> =
	& { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
	& { [K in keyof T as undefined extends T[K] ? K : never]?: T[K] };

export type SignedLabel = ComAtprotoLabelDefs.Label & { sig: Uint8Array };
export type SavedLabel = SignedLabel & { id: number };

export type GetMethod<T extends RouteGenericInterface = RouteGenericInterface> = RouteHandlerMethod<
	RawServerDefault,
	RawRequestDefaultExpression,
	RawReplyDefaultExpression,
	T
>;
export type WebSocketMethod<T extends RequestGenericInterface = RequestGenericInterface> =
	WebsocketHandler<RawServerDefault, RawRequestDefaultExpression, T>;
