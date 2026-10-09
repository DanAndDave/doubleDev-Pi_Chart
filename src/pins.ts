import type { Budget } from "./assembler.ts";
import type { BranchEntry } from "./harness.ts";
import type { HarnessMessage } from "./messages.ts";
import { approximateTokens } from "./tokens.ts";

/**
 * Text the user placed in their Conversation, carried whole by every Pack
 * until they remove it. The id is never reused within the Conversation, so
 * a removed Pin and a later one are never taken for each other.
 */
export interface Pin {
	id: number;
	text: string;
}

/** What a Conversation's Journal says it holds, and the next id to give. */
export interface PinState {
	pins: Pin[];
	nextId: number;
}

/** The `customType` of every Pin entry this extension writes (ADR-0009). */
export const PIN_ENTRY = "pi-chart.pin";

/** What a Pin entry holds: one change, or the whole state at a fork. */
export type PinEvent =
	| { op: "add"; id: number; text: string }
	| { op: "remove"; ids: number[] }
	| { op: "snapshot"; pins: Pin[]; nextId: number };

/**
 * The Pins a Journal holds, folded over every entry of the file in the
 * order written — not the branch, so a Pin added after the entry `/tree`
 * returns to still holds.
 *
 * Malformed data is skipped rather than thrown on: a hand-edited Journal
 * must not take assembly down with it.
 */
export function replayPins(entries: readonly BranchEntry[]): PinState {
	let pins: Pin[] = [];
	let nextId = 1;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== PIN_ENTRY) continue;
		const event = parseEvent(entry.data);
		if (event === undefined) continue;
		if (event.op === "add") {
			if (pins.some((pin) => pin.id === event.id)) continue;
			pins.push({ id: event.id, text: event.text });
			nextId = Math.max(nextId, event.id + 1);
		} else if (event.op === "remove") {
			const gone = new Set(event.ids);
			pins = pins.filter((pin) => !gone.has(pin.id));
		} else {
			pins = event.pins.map((pin) => ({ id: pin.id, text: pin.text }));
			nextId = Math.max(
				nextId,
				event.nextId,
				...pins.map((pin) => pin.id + 1),
			);
		}
	}
	return { pins, nextId };
}

/**
 * Whether two states agree: the same Pins under the same ids, in order,
 * and the same next id, so a copy cannot give out an id its parent used.
 */
export function sameState(left: PinState, right: PinState): boolean {
	return (
		left.nextId === right.nextId &&
		left.pins.length === right.pins.length &&
		left.pins.every(
			(pin, index) =>
				pin.id === right.pins[index]?.id && pin.text === right.pins[index]?.text,
		)
	);
}

/**
 * One Pin as the model receives it: attributed to the user and identified,
 * so a standing instruction reads apart from retrieved background and from
 * the prompt being answered. `position` counts from one.
 */
export function renderPin(pin: Pin, position: number, total: number): HarnessMessage {
	return {
		role: "user",
		content: `[pinned by the user: #${pin.id}, ${position} of ${total}]\n${pin.text}`,
		cmPinned: true,
	};
}

/** Every Pin, rendered in the order added: the Pack's `pinned` part. */
export function renderPins(pins: readonly Pin[]): HarnessMessage[] {
	return pins.map((pin, index) => renderPin(pin, index + 1, pins.length));
}

/**
 * What the Pins cost, measured as the Pack measures them — rendered,
 * header included — so `/pins` and `/pack` give one figure.
 */
export function pinTokens(pins: readonly Pin[]): number {
	return approximateTokens(renderPins(pins));
}

export type Admission =
	| { ok: true; pin: Pin; tokens: number; total: number }
	| { ok: false; reason: string };

/**
 * Whether one more Pin fits the Budget, in count and in tokens. Bound here,
 * at writing, and never at assembly: a Pin held is carried whatever the
 * Budget has since become.
 */
export function admit(state: PinState, text: string, budget: Budget): Admission {
	const held = state.pins.length;
	if (held + 1 > budget.count) {
		return {
			ok: false,
			reason:
				`the pin budget is ${budget.count} pins and ${held} held; ` +
				`this one would be ${held + 1 - budget.count} over`,
		};
	}
	const pin = { id: state.nextId, text };
	const spent = pinTokens(state.pins);
	const total = pinTokens([...state.pins, pin]);
	if (total > budget.tokens) {
		return {
			ok: false,
			reason:
				`the pin budget is ${budget.tokens} tokens and the pins spend ~${spent}; ` +
				`this one adds ~${total - spent}, ${total - budget.tokens} over`,
		};
	}
	return { ok: true, pin, tokens: total - spent, total };
}

function parseEvent(data: unknown): PinEvent | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const event = data as Record<string, unknown>;
	if (event.op === "add") {
		return isId(event.id) && typeof event.text === "string"
			? { op: "add", id: event.id, text: event.text }
			: undefined;
	}
	if (event.op === "remove") {
		return Array.isArray(event.ids) && event.ids.every(isId)
			? { op: "remove", ids: event.ids }
			: undefined;
	}
	if (event.op === "snapshot") {
		if (!Array.isArray(event.pins) || !isId(event.nextId)) return undefined;
		const pins = event.pins.filter(isPin);
		return pins.length === event.pins.length
			? { op: "snapshot", pins, nextId: event.nextId }
			: undefined;
	}
	return undefined;
}

function isPin(value: unknown): value is Pin {
	if (typeof value !== "object" || value === null) return false;
	const pin = value as Record<string, unknown>;
	return isId(pin.id) && typeof pin.text === "string";
}

function isId(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}
