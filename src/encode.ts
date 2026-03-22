import { Board } from "./board.js";
import {
	KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN, WHITE, Color, PieceType,
	squareFile, squareRank,
} from "./types.js";

// King direction table — matches KING_DELTAS in decode.ts (indices 1-8)
const KING_DELTAS = [0, -9, -8, -7, -1, 1, 7, 8, 9];

function encodeKing(from: number, to: number, isCastle: boolean, isNull: boolean): number {
	if (isNull) return 0;
	if (isCastle) return to > from ? 10 : 9;
	const delta = to - from;
	const code = KING_DELTAS.indexOf(delta);
	if (code < 0) throw new Error(`Invalid king delta ${delta}`);
	return code;
}

function encodeQueen(from: number, to: number): number[] {
	const fromFile = squareFile(from);
	const fromRank = squareRank(from);
	const toFile   = squareFile(to);
	const toRank   = squareRank(to);
	if (fromRank === toRank) {
		// Horizontal: code = toFile (can't equal fromFile for a real move)
		return [toFile];
	}
	if (fromFile === toFile) {
		// Vertical: code = 8 + toRank
		return [8 + toRank];
	}
	// Diagonal: code = fromFile, second byte = to + 64
	return [fromFile, to + 64];
}

function encodeRook(from: number, to: number): number {
	if (squareRank(from) === squareRank(to)) {
		return squareFile(to);           // horizontal
	}
	return 8 + squareRank(to);          // vertical
}

function encodeBishop(from: number, to: number): number {
	const fileDiff = squareFile(to) - squareFile(from);
	const rankDiff = squareRank(to) - squareRank(from);
	if (rankDiff === fileDiff) {
		return squareFile(to);           // up-right / down-left diagonal
	}
	return 8 + squareFile(to);          // up-left / down-right diagonal
}

// Knight deltas — matches KNIGHT_DELTAS in decode.ts (indices 1-8)
const KNIGHT_DELTAS = [0, -17, -15, -10, -6, 6, 10, 15, 17];

function encodeKnight(from: number, to: number): number {
	const delta = to - from;
	const code = KNIGHT_DELTAS.indexOf(delta);
	if (code < 0) throw new Error(`Invalid knight delta ${delta}`);
	return code;
}

function encodePawn(from: number, to: number, promo: PieceType | null, color: Color): number {
	// "left" direction (towards a-file for white, h-file for black)
	const leftFileDiff = color === WHITE ? -1 : 1;
	const fileDiff = squareFile(to) - squareFile(from);

	if (Math.abs(to - from) === 16) return 15;  // double push

	// direction: 0=capture-left, 1=forward, 2=capture-right
	const dir = fileDiff === 0 ? 1 : fileDiff === leftFileDiff ? 0 : 2;

	if (promo === null) return dir;

	const PROMO_PIECES: PieceType[] = [QUEEN, ROOK, BISHOP, KNIGHT];
	const promoPieceIdx = PROMO_PIECES.indexOf(promo);
	if (promoPieceIdx < 0) throw new Error(`Invalid promotion piece ${promo}`);
	return 3 + promoPieceIdx * 3 + dir;
}

/**
 * Encode a single move into 1 or 2 SCID move bytes.
 * The board must be in the position BEFORE the move is applied.
 */
export function encodeMove(
	board: Board,
	fromSq: number,
	toSq: number,
	promo: PieceType | null,
	isCastle: boolean,
	isNull: boolean,
): number[] {
	const color = board.getSideToMove();
	const listIndex = board.getListIndex(color, fromSq);
	if (listIndex < 0) throw new Error(`No ${color} piece at square ${fromSq}`);

	const piece = board.getPiece(color, listIndex);

	let codes: number[];
	switch (piece.type) {
		case KING:   codes = [encodeKing(fromSq, toSq, isCastle, isNull)]; break;
		case QUEEN:  codes = encodeQueen(fromSq, toSq); break;
		case ROOK:   codes = [encodeRook(fromSq, toSq)]; break;
		case BISHOP: codes = [encodeBishop(fromSq, toSq)]; break;
		case KNIGHT: codes = [encodeKnight(fromSq, toSq)]; break;
		case PAWN:   codes = [encodePawn(fromSq, toSq, promo, color)]; break;
		default: throw new Error(`Unknown piece type ${piece.type}`);
	}

	return [(listIndex << 4) | codes[0], ...codes.slice(1)];
}
