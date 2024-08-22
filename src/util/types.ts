import type { ComAtprotoLabelDefs } from "@atproto/api";

export type StrictPartial<T> =
	& { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
	& { [K in keyof T as undefined extends T[K] ? K : never]?: T[K] };

export type SignedLabel = ComAtprotoLabelDefs.Label & { sig: Uint8Array };