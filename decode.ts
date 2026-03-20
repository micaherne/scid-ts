import { Board } from "./board";
import {
	KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN,
	WHITE, BLACK, Color, PieceType,
	squareFile, squareRank, squareToAlgebraic,
	ENCODE_NAG, ENCODE_COMMENT, ENCODE_START_MARKER,
	ENCODE_END_MARKER, ENCODE_END_GAME,
	ScidMove
} from "./types";

export interface DecodeResult {
	type: "move";
	move: ScidMove;
	from: number;
	to: number;
	promo: PieceType | null;
	isCastle: boolean;
	isNull: boolean;
}

export interface DecodeMarker {
	type: "nag" | "comment" | "startVariation" | "endVariation" | "endGame";
	nag?: number;
}

/**
 * Decode a single move byte (and possibly a second byte for queen diagonal moves).
 * Returns either a decoded move or a special marker.
 */
export function decodeMoveOrMarker(
	board: Board,
	byte: number,
	readNextByte: () => number
): DecodeResult | DecodeMarker {
	const pieceIndex = (byte >> 4) & 0x0F;
	const code = byte & 0x0F;

	// Special markers: piece index 0 (king), codes 11-15
	if (pieceIndex === 0 && code >= ENCODE_NAG) {
		switch (code) {
			case ENCODE_NAG:
				return { type: "nag", nag: readNextByte() };
			case ENCODE_COMMENT:
				return { type: "comment" };
			case ENCODE_START_MARKER:
				return { type: "startVariation" };
			case ENCODE_END_MARKER:
				return { type: "endVariation" };
			case ENCODE_END_GAME:
				return { type: "endGame" };
		}
	}

	const color = board.getSideToMove();
	const piece = board.getPiece(color, pieceIndex);
	const from = piece.square;
	const pieceType = piece.type;

	let to: number;
	let promo: PieceType | null = null;
	let isCastle = false;
	let isNull = false;

	switch (pieceType) {
		case KING:
			({ to, isCastle, isNull } = decodeKing(from, code));
			break;
		case QUEEN:
			to = decodeQueen(from, code, readNextByte);
			break;
		case ROOK:
			to = decodeRook(from, code);
			break;
		case BISHOP:
			to = decodeBishop(from, code);
			break;
		case KNIGHT:
			to = decodeKnight(from, code);
			break;
		case PAWN:
			({ to, promo } = decodePawn(from, code, color));
			break;
		default:
			throw new Error(`Unknown piece type ${pieceType} at square ${from}`);
	}

	const move: ScidMove = {
		from: squareToAlgebraic(from),
		to: squareToAlgebraic(to),
	};
	if (promo !== null) {
		move.promotion = pieceTypeToChar(promo);
	}

	return {
		type: "move",
		move,
		from,
		to,
		promo,
		isCastle,
		isNull,
	};
}

// King direction offsets: code 1-8 map to delta values
// 1=SW(-9), 2=S(-8), 3=SE(-7), 4=W(-1), 5=E(+1), 6=NW(+7), 7=N(+8), 8=NE(+9)
const KING_DELTAS = [0, -9, -8, -7, -1, 1, 7, 8, 9];

function decodeKing(from: number, code: number): { to: number; isCastle: boolean; isNull: boolean } {
	if (code === 0) {
		return { to: from, isCastle: false, isNull: true };
	}
	if (code === 10) {
		// Kingside castling: king moves 2 squares right
		return { to: from + 2, isCastle: true, isNull: false };
	}
	if (code === 9) {
		// Queenside castling: king moves 2 squares left
		return { to: from - 2, isCastle: true, isNull: false };
	}
	return { to: from + KING_DELTAS[code], isCastle: false, isNull: false };
}

function decodeQueen(from: number, code: number, readNextByte: () => number): number {
	const fromFile = squareFile(from);
	const fromRank = squareRank(from);

	if (code < 8) {
		// Horizontal: move to file=code, same rank
		if (code === fromFile) {
			// Diagonal move: read second byte
			const secondByte = readNextByte();
			return secondByte - 64;
		}
		return fromRank * 8 + code;
	}
	// Vertical: move to rank=(code-8), same file
	return (code - 8) * 8 + fromFile;
}

function decodeRook(from: number, code: number): number {
	if (code < 8) {
		// Move to file=code, same rank
		return squareRank(from) * 8 + code;
	}
	// Move to rank=(code-8), same file
	return (code - 8) * 8 + squareFile(from);
}

function decodeBishop(from: number, code: number): number {
	const fromFile = squareFile(from);
	const fromRank = squareRank(from);

	if (code < 8) {
		// Up-right/down-left diagonal: move to file=code
		const toFile = code;
		const fileDiff = toFile - fromFile;
		return (fromRank + fileDiff) * 8 + toFile;
	}
	// Up-left/down-right diagonal: move to file=(code-8)
	const toFile = code - 8;
	const fileDiff = toFile - fromFile;
	return (fromRank - fileDiff) * 8 + toFile;
}

// Knight offset table: code 1-8
const KNIGHT_DELTAS = [0, -17, -15, -10, -6, 6, 10, 15, 17];

function decodeKnight(from: number, code: number): number {
	return from + KNIGHT_DELTAS[code];
}

function decodePawn(from: number, code: number, color: Color): { to: number; promo: PieceType | null } {
	// Direction multiplier: white moves up (+8), black moves down (-8)
	const dir = color === WHITE ? 1 : -1;
	// "Left" from side's perspective: White a-file direction, Black h-file direction
	const leftFile = color === WHITE ? -1 : 1;

	let to: number;
	let promo: PieceType | null = null;

	if (code === 15) {
		// Double push
		to = from + dir * 16;
	} else if (code <= 2) {
		// No promotion: 0=capture-left, 1=forward, 2=capture-right
		const direction = code - 1; // -1, 0, 1
		to = from + dir * 8 + direction * (color === WHITE ? 1 : -1);
		// Actually: left = file decreasing for white, file increasing for black
		if (code === 0) {
			to = from + dir * 8 + leftFile;
		} else if (code === 1) {
			to = from + dir * 8;
		} else {
			to = from + dir * 8 - leftFile;
		}
	} else {
		// Promotion: 3-14
		// promo piece = (code - 3) / 3: 0=queen, 1=rook, 2=bishop, 3=knight
		// direction = (code - 3) % 3: 0=capture-left, 1=forward, 2=capture-right
		const promoCode = code - 3;
		const promoDir = promoCode % 3;
		const promoPiece = Math.floor(promoCode / 3);

		if (promoDir === 0) {
			to = from + dir * 8 + leftFile;
		} else if (promoDir === 1) {
			to = from + dir * 8;
		} else {
			to = from + dir * 8 - leftFile;
		}

		const PROMO_PIECES: PieceType[] = [QUEEN, ROOK, BISHOP, KNIGHT];
		promo = PROMO_PIECES[promoPiece];
	}

	return { to, promo };
}

function pieceTypeToChar(pt: number): string {
	switch (pt) {
		case QUEEN: return "q";
		case ROOK: return "r";
		case BISHOP: return "b";
		case KNIGHT: return "n";
		default: return "q";
	}
}
