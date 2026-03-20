import { describe, it, expect } from "vitest";
import { Board } from "./board";
import { KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN, WHITE, BLACK } from "./types";

describe("Board", () => {
	describe("setupStartPosition", () => {
		it("places pieces correctly", () => {
			const board = new Board();
			board.setupStartPosition();

			// White king on E1 (sq 4)
			const wk = board.pieceAt(4);
			expect(wk).not.toBeNull();
			expect(wk!.type).toBe(KING);
			expect(wk!.color).toBe(WHITE);

			// Black king on E8 (sq 60)
			const bk = board.pieceAt(60);
			expect(bk).not.toBeNull();
			expect(bk!.type).toBe(KING);
			expect(bk!.color).toBe(BLACK);

			// White queen on D1 (sq 3)
			const wq = board.pieceAt(3);
			expect(wq).not.toBeNull();
			expect(wq!.type).toBe(QUEEN);

			// White pawns on rank 2 (sq 8-15)
			for (let f = 0; f < 8; f++) {
				const p = board.pieceAt(8 + f);
				expect(p).not.toBeNull();
				expect(p!.type).toBe(PAWN);
				expect(p!.color).toBe(WHITE);
			}

			// Empty squares in the middle
			for (let sq = 16; sq < 48; sq++) {
				expect(board.pieceAt(sq)).toBeNull();
			}

			expect(board.getSideToMove()).toBe(WHITE);
			expect(board.getPieceCount(WHITE)).toBe(16);
			expect(board.getPieceCount(BLACK)).toBe(16);
		});

		it("king is always at piece list index 0", () => {
			const board = new Board();
			board.setupStartPosition();

			const wking = board.getPiece(WHITE, 0);
			expect(wking.type).toBe(KING);
			expect(wking.square).toBe(4); // E1

			const bking = board.getPiece(BLACK, 0);
			expect(bking.type).toBe(KING);
			expect(bking.square).toBe(60); // E8
		});

		it("follows SCID standard piece ordering", () => {
			const board = new Board();
			board.setupStartPosition();

			// White: K, R(a1), N(b1), B(c1), Q(d1), B(f1), N(g1), R(h1), Pa2..Ph2
			expect(board.getPiece(WHITE, 0).type).toBe(KING);    // e1
			expect(board.getPiece(WHITE, 1).type).toBe(ROOK);    // a1
			expect(board.getPiece(WHITE, 1).square).toBe(0);     // a1
			expect(board.getPiece(WHITE, 2).type).toBe(KNIGHT);  // b1
			expect(board.getPiece(WHITE, 3).type).toBe(BISHOP);  // c1
			expect(board.getPiece(WHITE, 4).type).toBe(QUEEN);   // d1
			expect(board.getPiece(WHITE, 5).type).toBe(BISHOP);  // f1
			expect(board.getPiece(WHITE, 6).type).toBe(KNIGHT);  // g1
			expect(board.getPiece(WHITE, 6).square).toBe(6);     // g1
			expect(board.getPiece(WHITE, 7).type).toBe(ROOK);    // h1

			// Pawns at indices 8-15
			for (let i = 0; i < 8; i++) {
				expect(board.getPiece(WHITE, 8 + i).type).toBe(PAWN);
				expect(board.getPiece(WHITE, 8 + i).square).toBe(8 + i);
			}

			// Black: K, R(a8), N(b8), B(c8), Q(d8), B(f8), N(g8), R(h8), Pa7..Ph7
			expect(board.getPiece(BLACK, 0).type).toBe(KING);
			expect(board.getPiece(BLACK, 1).type).toBe(ROOK);    // a8
			expect(board.getPiece(BLACK, 4).type).toBe(QUEEN);   // d8
			expect(board.getPiece(BLACK, 6).type).toBe(KNIGHT);  // g8

			for (let i = 0; i < 8; i++) {
				expect(board.getPiece(BLACK, 8 + i).type).toBe(PAWN);
				expect(board.getPiece(BLACK, 8 + i).square).toBe(48 + i);
			}
		});
	});

	describe("setupFromFEN", () => {
		it("parses a FEN with black to move", () => {
			const board = new Board();
			board.setupFromFEN("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1");

			expect(board.getSideToMove()).toBe(BLACK);
			expect(board.getEpSquare()).toBe(20); // e3

			const pawn = board.pieceAt(28); // e4
			expect(pawn).not.toBeNull();
			expect(pawn!.type).toBe(PAWN);
			expect(pawn!.color).toBe(WHITE);

			// e2 should be empty
			expect(board.pieceAt(12)).toBeNull();
		});

		it("uses FEN encounter order for piece list", () => {
			const board = new Board();
			board.setupFromFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

			// FEN encounters black pieces first (rank 8), then pawns (rank 7),
			// then white pawns (rank 2), then white back rank (rank 1).
			// Black: r,n,b,q,k,b,n,r read, king at pos 4 swapped to 0
			// So idx 0=K, 1=N(b8), 2=B(c8), 3=Q(d8), 4=R(a8)...
			expect(board.getPiece(BLACK, 0).type).toBe(KING);
			expect(board.getPiece(BLACK, 0).square).toBe(60);

			// White: R,N,B,Q,K,B,N,R read, king at pos 4 swapped to 0
			expect(board.getPiece(WHITE, 0).type).toBe(KING);
			expect(board.getPiece(WHITE, 0).square).toBe(4);
		});

		it("handles a position with fewer pieces", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/4k3/4P3/4K3 w - - 0 1");

			expect(board.getPieceCount(WHITE)).toBe(2);
			expect(board.getPieceCount(BLACK)).toBe(1);

			const wk = board.getPiece(WHITE, 0);
			expect(wk.type).toBe(KING);
			expect(wk.square).toBe(4); // e1
		});
	});

	describe("applyMove", () => {
		it("moves a pawn forward", () => {
			const board = new Board();
			board.setupStartPosition();

			// 1. e4
			board.applyMove(12, 28, null, false, false); // e2→e4

			expect(board.pieceAt(12)).toBeNull();
			const p = board.pieceAt(28);
			expect(p).not.toBeNull();
			expect(p!.type).toBe(PAWN);
			expect(p!.color).toBe(WHITE);
			expect(board.getSideToMove()).toBe(BLACK);
			expect(board.getEpSquare()).toBe(20); // e3
		});

		it("handles a capture", () => {
			const board = new Board();
			board.setupFromFEN("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2");

			// exd5
			board.applyMove(28, 35, null, false, false); // e4→d5

			expect(board.pieceAt(28)).toBeNull();
			const p = board.pieceAt(35);
			expect(p!.type).toBe(PAWN);
			expect(p!.color).toBe(WHITE);
			// Black lost a pawn
			expect(board.getPieceCount(BLACK)).toBe(15);
		});

		it("handles en passant capture", () => {
			const board = new Board();
			board.setupFromFEN("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3");

			// exd6 e.p.
			board.applyMove(36, 43, null, false, false); // e5→d6

			expect(board.pieceAt(36)).toBeNull();
			expect(board.pieceAt(35)).toBeNull(); // captured pawn
			const p = board.pieceAt(43);
			expect(p!.type).toBe(PAWN);
			expect(p!.color).toBe(WHITE);
		});

		it("handles kingside castling", () => {
			const board = new Board();
			board.setupFromFEN("r1bqkbnr/pppppppp/2n5/8/8/5NP1/PPPPPPBP/RNBQK2R w KQkq - 2 3");

			board.applyMove(4, 6, null, true, false);

			expect(board.pieceAt(4)).toBeNull();
			expect(board.pieceAt(7)).toBeNull();
			const king = board.pieceAt(6);
			expect(king!.type).toBe(KING);
			const rook = board.pieceAt(5);
			expect(rook!.type).toBe(ROOK);
		});

		it("handles queenside castling", () => {
			const board = new Board();
			board.setupFromFEN("r3kbnr/pppqpppp/2n5/3p1b2/8/2NP1N2/PPPQPPPP/R3KB1R w KQkq - 4 5");

			board.applyMove(4, 2, null, true, false);

			expect(board.pieceAt(4)).toBeNull();
			expect(board.pieceAt(0)).toBeNull();
			const king = board.pieceAt(2);
			expect(king!.type).toBe(KING);
			const rook = board.pieceAt(3);
			expect(rook!.type).toBe(ROOK);
		});

		it("handles pawn promotion", () => {
			const board = new Board();
			board.setupFromFEN("8/4P3/8/8/8/8/8/4K2k w - - 0 1");

			board.applyMove(52, 60, QUEEN, false, false);

			const q = board.pieceAt(60);
			expect(q!.type).toBe(QUEEN);
			expect(q!.color).toBe(WHITE);
		});

		it("handles null move", () => {
			const board = new Board();
			board.setupStartPosition();

			board.applyMove(0, 0, null, false, true);

			expect(board.getSideToMove()).toBe(BLACK);
			expect(board.pieceAt(4)!.type).toBe(KING);
		});
	});

	describe("clone", () => {
		it("creates an independent copy", () => {
			const board = new Board();
			board.setupStartPosition();

			const clone = board.clone();
			board.applyMove(12, 28, null, false, false); // e4

			// Clone should be unaffected
			expect(clone.pieceAt(12)).not.toBeNull();
			expect(clone.pieceAt(28)).toBeNull();
			expect(clone.getSideToMove()).toBe(WHITE);
		});
	});
});
