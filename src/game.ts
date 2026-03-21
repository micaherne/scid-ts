import { Board } from "./board.js";
import { decodeMoveOrMarker, DecodeResult, DecodeMarker } from "./decode.js";
import { ScidMove, ScidAnnotatedMove } from "./types.js";

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

export interface ParsedAnnotatedGameData {
	extraTags: [string, string][];
	moves: ScidAnnotatedMove[];
	startFen: string | null;
	comment: string | null;
}

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

/**
 * Parse a single game's data including comments and variation trees.
 * Comments are stored as null-terminated strings after the END_GAME marker,
 * in the order their ENCODE_COMMENT markers appear in the move stream.
 */
export function parseAnnotatedGameData(buf: Buffer, offset: number, length: number): ParsedAnnotatedGameData {
	let pos = offset;
	const end = offset + length;

	// 1. Extra tags
	const extraTags: [string, string][] = [];
	while (pos < end) {
		const nameLen = buf[pos++];
		if (nameLen === 0) break;

		let tagName: string;
		if (nameLen > 240) {
			tagName = COMMON_TAGS[nameLen] || `Tag${nameLen}`;
		} else {
			tagName = buf.toString("latin1", pos, pos + nameLen);
			pos += nameLen;
		}

		let valueLen = buf[pos++];
		if (valueLen > 240) {
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
			const fenStart = pos;
			while (pos < end && buf[pos] !== 0) pos++;
			startFen = buf.toString("latin1", fenStart, pos);
			pos++;
		}
	}

	// 3. Board setup
	let board = new Board();
	if (startFen) {
		board.setupFromFEN(startFen);
	} else {
		board.setupStartPosition();
	}

	// 4. Parse move stream into annotation tree
	const mainLine: ScidAnnotatedMove[] = [];
	const lineStack: ScidAnnotatedMove[][] = [mainLine];

	// Board state per variation level: save both board-after-last-move and
	// board-before-last-move so that consecutive variations on the same move
	// all branch from the correct position.
	interface BoardFrame { afterMove: Board; beforeMove: Board; }
	const boardFrameStack: BoardFrame[] = [];
	let preMoveBoard = board.clone();

	// Comment callbacks are collected in stream order, then invoked once the
	// comment strings (after END_GAME) have been read.
	const commentCallbacks: Array<(text: string) => void> = [];

	// Per-line pending commentBefore: when a comment marker appears before any
	// moves in a line, we stash a holder here and fill it when the next move arrives.
	interface CommentBeforeHolder { target: ScidAnnotatedMove | null; }
	const pendingBeforeStack: (CommentBeforeHolder | null)[] = [null];

	let gameComment: string | null = null;
	let streamEndPos = end;

	while (pos < end) {
		const byte = buf[pos++];

		const result = decodeMoveOrMarker(board, byte, () => {
			if (pos < end) return buf[pos++];
			return 0;
		});

		const currentLine = lineStack[lineStack.length - 1];
		const lineIdx = lineStack.length - 1;

		if (result.type === "move") {
			const decoded = result as DecodeResult;
			const annotatedMove: ScidAnnotatedMove = { from: decoded.move.from, to: decoded.move.to };
			if (decoded.move.promotion !== undefined) annotatedMove.promotion = decoded.move.promotion;
			// Attach any pending commentBefore for this line
			const pending = pendingBeforeStack[lineIdx];
			if (pending) {
				pending.target = annotatedMove;
				pendingBeforeStack[lineIdx] = null;
			}
			currentLine.push(annotatedMove);
			preMoveBoard = board.clone();
			board.applyMove(decoded.from, decoded.to, decoded.promo, decoded.isCastle, decoded.isNull);
		} else {
			switch (result.type) {
				case "nag": {
					const nagValue = (result as DecodeMarker).nag!;
					if (currentLine.length > 0) {
						const lastMove = currentLine[currentLine.length - 1];
						if (!lastMove.nags) lastMove.nags = [];
						lastMove.nags.push(nagValue);
					}
					break;
				}
				case "comment": {
					if (currentLine.length > 0) {
						// commentAfter on the last move in this line
						const target = currentLine[currentLine.length - 1];
						commentCallbacks.push((text) => { target.commentAfter = text; });
					} else if (lineIdx === 0) {
						// Pre-game comment: stored on the game itself
						commentCallbacks.push((text) => { gameComment = text; });
					} else {
						// commentBefore on the next move in this variation
						const holder: CommentBeforeHolder = { target: null };
						pendingBeforeStack[lineIdx] = holder;
						commentCallbacks.push((text) => {
							if (holder.target) holder.target.commentBefore = text;
						});
					}
					break;
				}
				case "startVariation": {
					boardFrameStack.push({ afterMove: board, beforeMove: preMoveBoard });
					board = preMoveBoard.clone();
					const parentLastMove = currentLine.length > 0 ? currentLine[currentLine.length - 1] : null;
					const newLine: ScidAnnotatedMove[] = [];
					if (parentLastMove) {
						if (!parentLastMove.variations) parentLastMove.variations = [];
						parentLastMove.variations.push(newLine);
					}
					lineStack.push(newLine);
					pendingBeforeStack.push(null);
					break;
				}
				case "endVariation": {
					if (lineStack.length > 1) lineStack.pop();
					pendingBeforeStack.pop();
					if (boardFrameStack.length > 0) {
						const frame = boardFrameStack.pop()!;
						board = frame.afterMove;
						preMoveBoard = frame.beforeMove;
					}
					break;
				}
				case "endGame":
					streamEndPos = pos;
					pos = end;
					break;
			}
		}
	}

	// 5. Read comment strings from after the END_GAME marker
	pos = streamEndPos;
	for (const callback of commentCallbacks) {
		if (pos >= end) break;
		const start = pos;
		while (pos < end && buf[pos] !== 0) pos++;
		const text = buf.toString("utf8", start, pos);
		if (pos < end) pos++;
		callback(text);
	}

	return { extraTags, moves: mainLine, startFen, comment: gameComment };
}
