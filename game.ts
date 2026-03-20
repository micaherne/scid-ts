import { Board } from "./board";
import { decodeMoveOrMarker, DecodeResult } from "./decode";
import { ScidMove } from "./types";

/**
 * Common tag name codes for SCID game files.
 * When a tag name "length" byte is > 240, it maps to a predefined tag name.
 */
const COMMON_TAGS: Record<number, string> = {
	241: "Annotator",
	242: "PlyCount",
	243: "EventType",
	244: "EventRounds",
	245: "EventCountry",
	246: "EventCategory",
	247: "Source",
	248: "SourceDate",
	249: "TimeControl",
	250: "Board",
	251: "Opening",
	252: "Variation",
	253: "SubVariation",
	254: "Section",
	255: "Stage",
};

export interface ParsedGameData {
	extraTags: [string, string][];
	moves: ScidMove[];
	startFen: string | null;
}

/**
 * Parse a single game's data from the game file (.sg4 / .sg5).
 * The format is identical between SCID4 and SCID5.
 */
export function parseGameData(buf: Buffer, offset: number, length: number): ParsedGameData {
	let pos = offset;
	const end = offset + length;

	// 1. Extra tags
	const extraTags: [string, string][] = [];
	while (pos < end) {
		const nameLen = buf[pos++];
		if (nameLen === 0) break; // End of tags section

		let tagName: string;
		if (nameLen > 240) {
			tagName = COMMON_TAGS[nameLen] || `Tag${nameLen}`;
		} else {
			tagName = buf.toString("latin1", pos, pos + nameLen);
			pos += nameLen;
		}

		let valueLen = buf[pos++];
		if (valueLen > 240) {
			// Extended length: (byte - 240) * 256 + next byte
			valueLen = (valueLen - 240) * 256 + buf[pos++];
		}
		const tagValue = buf.toString("latin1", pos, pos + valueLen);
		pos += valueLen;

		extraTags.push([tagName, tagValue]);
	}

	// 2. Start board flag
	let startFen: string | null = null;
	if (pos < end) {
		const flagByte = buf[pos++];
		if (flagByte & 1) {
			// Custom start position: null-terminated FEN string
			const fenStart = pos;
			while (pos < end && buf[pos] !== 0) pos++;
			startFen = buf.toString("latin1", fenStart, pos);
			pos++; // skip null terminator
		}
	}

	// 3. Decode move stream
	// Use a board stack: variations branch from the position BEFORE the last move.
	// On startVariation, push a clone of the board at the pre-move state.
	// On endVariation, pop the stack.
	let board = new Board();
	if (startFen) {
		board.setupFromFEN(startFen);
	} else {
		board.setupStartPosition();
	}

	const moves: ScidMove[] = [];
	let depth = 0;
	// Stack of board states saved before the last main-line or variation move
	const boardStack: Board[] = [];
	// Save the board state before each move for variation branching
	let preMoveBoard = board.clone();

	while (pos < end) {
		const byte = buf[pos++];

		const result = decodeMoveOrMarker(board, byte, () => {
			if (pos < end) return buf[pos++];
			return 0;
		});

		if (result.type === "move") {
			const decoded = result as DecodeResult;
			if (depth === 0) {
				moves.push(decoded.move);
			}
			preMoveBoard = board.clone();
			board.applyMove(decoded.from, decoded.to, decoded.promo, decoded.isCastle, decoded.isNull);
		} else {
			switch (result.type) {
				case "nag":
					break;
				case "comment":
					break;
				case "startVariation":
					depth++;
					// Variation branches from position before last move
					boardStack.push(board);
					board = preMoveBoard.clone();
					break;
				case "endVariation":
					if (boardStack.length > 0) {
						board = boardStack.pop()!;
					}
					depth--;
					break;
				case "endGame":
					return { extraTags, moves, startFen };
			}
		}
	}

	return { extraTags, moves, startFen };
}
