import { StrictPartial } from "./types.js";

export function excludeUndefined<T extends Record<PropertyKey, unknown>>(obj: T): StrictPartial<T> {
	return Object.entries(obj).reduce<Record<string, unknown>>((acc, [key, value]) => {
		if (value !== undefined) {
			acc[key] = value;
		}
		return acc;
	}, {}) as never;
}
