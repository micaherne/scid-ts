import {
	KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN, EMPTY,
	WHITE, BLACK, Color, PieceType,
	squareFile, squareRank
} from "./types";

interface Piece {
	type: PieceType;
	color: Color;
	square: number;   // 0-63, or -1 if captured
}

// Square constants for readability
const A1 = 0, B1 = 1, C1 = 2, D1 = 3, E1 = 4, F1 = 5, G1 = 6, H1 = 7;
const A2 = 8, B2 = 9, C2 = 10, D2 = 11, E2 = 12, F2 = 13, G2 = 14, H2 = 15;
const A7 = 48, B7 = 49, C7 = 50, D7 = 51, E7 = 52, F7 = 53, G7 = 54, H7 = 55;
const A8 = 56, B8 = 57, C8 = 58, D8 = 59, E8 = 60, F8 = 61, G8 = 62, H8 = 63;

/**
 * Minimal board representation for SCID move decoding.
 * Tracks piece positions and piece lists — NOT a full chess engine.
 *
 * Piece list ordering must exactly match SCID's position.cpp:
 * - Index 0 is always the king
 * - Standard position uses a hardcoded order (see getStdStart in SCID)
 * - FEN positions use AddPiece encounter order (FEN reading order, king swapped to 0)
 */
export class Board {
	// board[sq] = piece index into pieces[], or -1 if empty
	private board: Int8Array = new Int8Array(64);
	// All pieces, indexed by absolute ID. pieces[0..15] = white, pieces[16..31] = black.
	private pieces: Piece[] = [];
	// Piece list per color: list[color][0..count-1] = index into pieces[].
	// list[color][0] is always the king.
	private list: [number[], number[]] = [[], []];
	private listCount: [number, number] = [0, 0];

	private sideToMove: Color = WHITE;
	private epSquare: number = -1;

	constructor() {
		this.board.fill(-1);
		this.pieces = [];
		for (let i = 0; i < 32; i++) {
			this.pieces.push({ type: EMPTY, color: WHITE, square: -1 });
		}
	}

	getSideToMove(): Color {
		return this.sideToMove;
	}

	getPiece(color: Color, listIndex: number): Piece {
		const absIdx = this.list[color][listIndex];
		return this.pieces[absIdx];
	}

	getPieceCount(color: Color): number {
		return this.listCount[color];
	}

	getEpSquare(): number {
		return this.epSquare;
	}

	pieceAt(sq: number): { type: PieceType; color: Color } | null {
		const idx = this.board[sq];
		if (idx < 0) return null;
		return this.pieces[idx];
	}

	/**
	 * Set up the standard starting position with SCID's hardcoded piece ordering.
	 * Matches getStdStart() in position.cpp.
	 */
	setupStartPosition(): void {
		this.board.fill(-1);
		for (let i = 0; i < 32; i++) {
			this.pieces[i] = { type: EMPTY, color: WHITE, square: -1 };
		}
		this.list[WHITE] = [];
		this.list[BLACK] = [];
		this.listCount = [0, 0];
		this.sideToMove = WHITE;
		this.epSquare = -1;

		// White pieces: K, R(a1), N(b1), B(c1), Q(d1), B(f1), N(g1), R(h1), Pa2..Ph2
		const whitePieces: [PieceType, number][] = [
			[KING, E1], [ROOK, A1], [KNIGHT, B1], [BISHOP, C1],
			[QUEEN, D1], [BISHOP, F1], [KNIGHT, G1], [ROOK, H1],
			[PAWN, A2], [PAWN, B2], [PAWN, C2], [PAWN, D2],
			[PAWN, E2], [PAWN, F2], [PAWN, G2], [PAWN, H2],
		];

		// Black pieces: K, R(a8), N(b8), B(c8), Q(d8), B(f8), N(g8), R(h8), Pa7..Ph7
		const blackPieces: [PieceType, number][] = [
			[KING, E8], [ROOK, A8], [KNIGHT, B8], [BISHOP, C8],
			[QUEEN, D8], [BISHOP, F8], [KNIGHT, G8], [ROOK, H8],
			[PAWN, A7], [PAWN, B7], [PAWN, C7], [PAWN, D7],
			[PAWN, E7], [PAWN, F7], [PAWN, G7], [PAWN, H7],
		];

		for (let i = 0; i < 16; i++) {
			const [type, sq] = whitePieces[i];
			const absIdx = i;
			this.pieces[absIdx] = { type, color: WHITE, square: sq };
			this.board[sq] = absIdx;
			this.list[WHITE].push(absIdx);
		}
		this.listCount[WHITE] = 16;

		for (let i = 0; i < 16; i++) {
			const [type, sq] = blackPieces[i];
			const absIdx = 16 + i;
			this.pieces[absIdx] = { type, color: BLACK, square: sq };
			this.board[sq] = absIdx;
			this.list[BLACK].push(absIdx);
		}
		this.listCount[BLACK] = 16;
	}

	/**
	 * Set up from a FEN string using SCID's AddPiece encounter order.
	 * Pieces are added in FEN reading order (rank 8 to 1, left to right).
	 * King is always swapped to index 0.
	 */
	setupFromFEN(fen: string): void {
		this.board.fill(-1);
		for (let i = 0; i < 32; i++) {
			this.pieces[i] = { type: EMPTY, color: WHITE, square: -1 };
		}
		this.list[WHITE] = [];
		this.list[BLACK] = [];
		this.listCount = [0, 0];

		const parts = fen.split(" ");
		const rows = parts[0].split("/");

		// Parse FEN in reading order (rank 8 down to rank 1)
		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
			const rank = 7 - rowIdx;
			const row = rows[rowIdx];
			let file = 0;
			for (const ch of row) {
				if (ch >= "1" && ch <= "8") {
					file += parseInt(ch, 10);
				} else {
					const color: Color = ch === ch.toUpperCase() ? WHITE : BLACK;
					const type = charToPieceType(ch.toUpperCase());
					const sq = rank * 8 + file;
					this.addPiece(type, color, sq);
					file++;
				}
			}
		}

		this.sideToMove = (parts.length > 1 && parts[1] === "b") ? BLACK : WHITE;

		this.epSquare = -1;
		if (parts.length > 3 && parts[3] !== "-") {
			const epFile = parts[3].charCodeAt(0) - 97;
			const epRank = parseInt(parts[3][1], 10) - 1;
			this.epSquare = epRank * 8 + epFile;
		}
	}

	/**
	 * Add a piece to the board using SCID's AddPiece logic.
	 * King is always placed at list index 0.
	 */
	private addPiece(type: PieceType, color: Color, sq: number): void {
		const base = color * 16;
		const count = this.listCount[color];

		if (type === KING) {
			// King goes to index 0; if there's already a piece at 0, move it to the end
			if (count > 0) {
				const existingAbsIdx = this.list[color][0];
				this.list[color][count] = existingAbsIdx;
				this.list[color].length = count + 1;
			}
			const absIdx = base + count;
			this.pieces[absIdx] = { type, color, square: sq };
			this.board[sq] = absIdx;
			this.list[color][0] = absIdx;
		} else {
			const absIdx = base + count;
			this.pieces[absIdx] = { type, color, square: sq };
			this.board[sq] = absIdx;
			this.list[color][count] = absIdx;
		}
		this.listCount[color] = count + 1;
	}

	applyMove(from: number, to: number, promo: PieceType | null, isCastle: boolean, isNull: boolean): void {
		if (isNull) {
			this.sideToMove = (1 - this.sideToMove) as Color;
			this.epSquare = -1;
			return;
		}

		const movingIdx = this.board[from];
		if (movingIdx < 0) return;

		const movingPiece = this.pieces[movingIdx];
		const capturedIdx = this.board[to];

		// Check for en passant capture
		let epCaptureSq = -1;
		if (movingPiece.type === PAWN && to === this.epSquare) {
			epCaptureSq = this.sideToMove === WHITE ? to - 8 : to + 8;
		}

		// Update en passant square
		this.epSquare = -1;
		if (movingPiece.type === PAWN && Math.abs(to - from) === 16) {
			this.epSquare = (from + to) / 2;
		}

		// Handle capture
		if (capturedIdx >= 0) {
			this.removePiece(capturedIdx);
		} else if (epCaptureSq >= 0) {
			const epIdx = this.board[epCaptureSq];
			if (epIdx >= 0) {
				this.removePiece(epIdx);
				this.board[epCaptureSq] = -1;
			}
		}

		// Move the piece
		this.board[from] = -1;
		this.board[to] = movingIdx;
		movingPiece.square = to;

		// Handle promotion
		if (promo !== null) {
			movingPiece.type = promo;
		}

		// Handle castling — move the rook
		if (isCastle) {
			let rookFrom: number, rookTo: number;
			if (to > from) {
				rookFrom = (squareRank(from) * 8) + 7;
				rookTo = (squareRank(from) * 8) + 5;
			} else {
				rookFrom = squareRank(from) * 8;
				rookTo = (squareRank(from) * 8) + 3;
			}
			const rookIdx = this.board[rookFrom];
			if (rookIdx >= 0) {
				this.board[rookFrom] = -1;
				this.board[rookTo] = rookIdx;
				this.pieces[rookIdx].square = rookTo;
			}
		}

		this.sideToMove = (1 - this.sideToMove) as Color;
	}

	clone(): Board {
		const b = new Board();
		b.board = new Int8Array(this.board);
		b.pieces = this.pieces.map(p => ({ ...p }));
		b.list = [this.list[WHITE].slice(), this.list[BLACK].slice()];
		b.listCount = [this.listCount[WHITE], this.listCount[BLACK]];
		b.sideToMove = this.sideToMove;
		b.epSquare = this.epSquare;
		return b;
	}

	private removePiece(absIdx: number): void {
		const piece = this.pieces[absIdx];
		const color = piece.color;

		const listIdx = this.list[color].indexOf(absIdx);
		if (listIdx >= 0) {
			const lastIdx = this.listCount[color] - 1;
			if (listIdx < lastIdx) {
				this.list[color][listIdx] = this.list[color][lastIdx];
			}
			this.listCount[color]--;
			this.list[color].length = this.listCount[color];
		}

		if (piece.square >= 0) {
			this.board[piece.square] = -1;
		}
		piece.square = -1;
		piece.type = EMPTY;
	}
}

function charToPieceType(ch: string): PieceType {
	switch (ch) {
		case "K": return KING;
		case "Q": return QUEEN;
		case "R": return ROOK;
		case "B": return BISHOP;
		case "N": return KNIGHT;
		case "P": return PAWN;
		default: return PAWN;
	}
}
