import { describe, it, expect } from "vitest";
import { Board } from "./board";
import { decodeMoveOrMarker, DecodeResult, DecodeMarker } from "./decode";
import { KING, QUEEN, ROOK, BISHOP, KNIGHT, PAWN, WHITE, BLACK } from "./types";

function decodeMove(board: Board, byte: number, extraBytes: number[] = []): DecodeResult {
	let idx = 0;
	const result = decodeMoveOrMarker(board, byte, () => extraBytes[idx++]);
	expect(result.type).toBe("move");
	return result as DecodeResult;
}

function decodeMarker(board: Board, byte: number, extraBytes: number[] = []): DecodeMarker {
	let idx = 0;
	const result = decodeMoveOrMarker(board, byte, () => extraBytes[idx++]);
	expect(result.type).not.toBe("move");
	return result as DecodeMarker;
}

describe("decode", () => {
	describe("special markers", () => {
		it("decodes NAG marker", () => {
			const board = new Board();
			board.setupStartPosition();
			const m = decodeMarker(board, 0x0B, [1]);
			expect(m.type).toBe("nag");
			expect(m.nag).toBe(1);
		});

		it("decodes COMMENT marker", () => {
			const board = new Board();
			board.setupStartPosition();
			const m = decodeMarker(board, 0x0C);
			expect(m.type).toBe("comment");
		});

		it("decodes START_MARKER", () => {
			const board = new Board();
			board.setupStartPosition();
			const m = decodeMarker(board, 0x0D);
			expect(m.type).toBe("startVariation");
		});

		it("decodes END_MARKER", () => {
			const board = new Board();
			board.setupStartPosition();
			const m = decodeMarker(board, 0x0E);
			expect(m.type).toBe("endVariation");
		});

		it("decodes END_GAME", () => {
			const board = new Board();
			board.setupStartPosition();
			const m = decodeMarker(board, 0x0F);
			expect(m.type).toBe("endGame");
		});
	});

	describe("king moves", () => {
		it("decodes null move (code 0)", () => {
			const board = new Board();
			board.setupStartPosition();
			// King is at piece list index 0 → byte upper nibble 0, code 0 → 0x00
			const result = decodeMove(board, 0x00);
			expect(result.isNull).toBe(true);
			expect(result.move.from).toBe("e1");
			expect(result.move.to).toBe("e1");
		});

		it("decodes king move E+1 (code 5)", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/4K3/8/8/7k w - - 0 1");
			// King is always at index 0. Code 5 = East (+1) → e4→f4
			const result = decodeMove(board, 0x05);
			expect(result.move.from).toBe("e4");
			expect(result.move.to).toBe("f4");
			expect(result.isCastle).toBe(false);
		});

		it("decodes kingside castling (code 10)", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/4K2R w K - 0 1");
			const result = decodeMove(board, 0x0A);
			expect(result.move.from).toBe("e1");
			expect(result.move.to).toBe("g1");
			expect(result.isCastle).toBe(true);
		});

		it("decodes queenside castling (code 9)", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/R3K3 w Q - 0 1");
			const result = decodeMove(board, 0x09);
			expect(result.move.from).toBe("e1");
			expect(result.move.to).toBe("c1");
			expect(result.isCastle).toBe(true);
		});
	});

	describe("knight moves in standard position", () => {
		it("decodes Nf3 (Ng1 with code for +15 delta)", () => {
			const board = new Board();
			board.setupStartPosition();
			// Standard position: white piece idx 6 = N@g1
			// Knight code 7 = delta +15 → g1(6) → f3(21)
			const result = decodeMove(board, 0x67); // piece 6, code 7
			expect(result.move.from).toBe("g1");
			expect(result.move.to).toBe("f3");
		});

		it("decodes Nh3 (Ng1 with code for +17 delta)", () => {
			const board = new Board();
			board.setupStartPosition();
			// Knight code 8 = delta +17 → g1(6) → h3(23)
			const result = decodeMove(board, 0x68); // piece 6, code 8
			expect(result.move.from).toBe("g1");
			expect(result.move.to).toBe("h3");
		});
	});

	describe("rook moves", () => {
		it("decodes rook horizontal move", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/R3K3 w - - 0 1");
			// FEN encounter order: back rank R(a1), K(e1)
			// King swapped to idx 0, R@a1 at idx 1
			// Code 3 = move to file 3 → d1
			const result = decodeMove(board, 0x13); // piece 1, code 3
			expect(result.move.from).toBe("a1");
			expect(result.move.to).toBe("d1");
		});

		it("decodes rook vertical move", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/R3K3 w - - 0 1");
			// Code 12 = rank (12-8)=4 → a5
			const result = decodeMove(board, 0x1C); // piece 1, code 12
			expect(result.move.from).toBe("a1");
			expect(result.move.to).toBe("a5");
		});
	});

	describe("bishop moves", () => {
		it("decodes bishop up-right diagonal", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/2B1K3 w - - 0 1");
			// FEN encounter: B(c1), K(e1). King swapped to 0, B at idx 1.
			// Code 5 = up-right diag to file 5 (f). c1 file=2, diff=3, rank=0+3=3 → f4(29)
			const result = decodeMove(board, 0x15); // piece 1, code 5
			expect(result.move.from).toBe("c1");
			expect(result.move.to).toBe("f4");
		});

		it("decodes bishop up-left diagonal", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/2B1K3 w - - 0 1");
			// Code 8 = up-left diag to file (8-8)=0 (a). c1→a3(16)
			const result = decodeMove(board, 0x18); // piece 1, code 8
			expect(result.move.from).toBe("c1");
			expect(result.move.to).toBe("a3");
		});
	});

	describe("queen moves", () => {
		it("decodes queen horizontal move", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/3QK3 w - - 0 1");
			// FEN encounter: Q(d1), K(e1). King swapped to 0, Q at idx 1.
			// Code 0 = move to file 0 → a1
			const result = decodeMove(board, 0x10); // piece 1, code 0
			expect(result.move.from).toBe("d1");
			expect(result.move.to).toBe("a1");
		});

		it("decodes queen vertical move", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/3QK3 w - - 0 1");
			// Code 12 = rank (12-8)=4 → d5(35)
			const result = decodeMove(board, 0x1C); // piece 1, code 12
			expect(result.move.from).toBe("d1");
			expect(result.move.to).toBe("d5");
		});

		it("decodes queen diagonal move (two bytes)", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/8/8/8/8/3QK3 w - - 0 1");
			// Queen on d1 (file 3). Code = own file (3) → diagonal.
			// Second byte = dest + 64. Dest = h5(39). Second byte = 103.
			const result = decodeMove(board, 0x13, [103]); // piece 1, code 3
			expect(result.move.from).toBe("d1");
			expect(result.move.to).toBe("h5");
		});
	});

	describe("pawn moves in standard position", () => {
		it("decodes e2-e3 (pawn forward)", () => {
			const board = new Board();
			board.setupStartPosition();
			// Standard position white pawns: idx 8=Pa2, ..., idx 12=Pe2, ...
			// Pawn code 1 = forward one
			const result = decodeMove(board, 0xC1); // piece 12, code 1
			expect(result.move.from).toBe("e2");
			expect(result.move.to).toBe("e3");
		});

		it("decodes e2-e4 (pawn double push)", () => {
			const board = new Board();
			board.setupStartPosition();
			const result = decodeMove(board, 0xCF); // piece 12, code 15
			expect(result.move.from).toBe("e2");
			expect(result.move.to).toBe("e4");
		});

		it("decodes white pawn capture left", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/3p4/4P3/8/8/4K2k w - - 0 1");
			// FEN encounter: black k(h1), white P(e4), K(e1)
			// White pieces: K at idx 0 (swapped), P at idx 1
			// Pawn code 0 = capture left (towards a-file for white = file-1)
			const result = decodeMove(board, 0x10); // piece 1, code 0
			expect(result.move.from).toBe("e4");
			expect(result.move.to).toBe("d5");
		});

		it("decodes white pawn capture right", () => {
			const board = new Board();
			board.setupFromFEN("8/8/8/5p2/4P3/8/8/4K2k w - - 0 1");
			const result = decodeMove(board, 0x12); // piece 1, code 2
			expect(result.move.from).toBe("e4");
			expect(result.move.to).toBe("f5");
		});

		it("decodes pawn queen promotion forward", () => {
			const board = new Board();
			board.setupFromFEN("8/4P3/8/8/8/8/8/4K2k w - - 0 1");
			// White: k@h1(encountered first in FEN rank 1), P@e7(rank 7), K@e1(rank 1)
			// FEN encounter order: P@e7 first (rank 7), then K@e1, k@h1 (rank 1)
			// White pieces: P at idx 0? No — K always swapped to 0.
			// idx 0 = K@e1, idx 1 = P@e7
			// Code 4 = queen promo forward
			const result = decodeMove(board, 0x14); // piece 1, code 4
			expect(result.move.from).toBe("e7");
			expect(result.move.to).toBe("e8");
			expect(result.move.promotion).toBe("q");
		});

		it("decodes pawn knight promotion capture-right", () => {
			const board = new Board();
			board.setupFromFEN("5n2/4P3/8/8/8/8/8/4K2k w - - 0 1");
			// White: idx 0=K@e1, idx 1=P@e7
			// Code 14 = knight promo capture-right
			const result = decodeMove(board, 0x1E); // piece 1, code 14
			expect(result.move.from).toBe("e7");
			expect(result.move.to).toBe("f8");
			expect(result.move.promotion).toBe("n");
		});

		it("decodes black pawn forward", () => {
			const board = new Board();
			board.setupFromFEN("4k3/8/8/8/8/8/4p3/4K3 b - - 0 1");
			// Black: FEN encounter (rank 8 first): k@e8. Then rank 2: p@e2.
			// idx 0 = K@e8, idx 1 = P@e2
			const result = decodeMove(board, 0x11); // piece 1, code 1
			expect(result.move.from).toBe("e2");
			expect(result.move.to).toBe("e1");
		});

		it("decodes black pawn capture left (towards h-file)", () => {
			const board = new Board();
			board.setupFromFEN("4k3/8/8/8/8/8/4p3/4KN2 b - - 0 1");
			// Black "left" = towards h-file (file + 1)
			// e2(12) → f1(5)
			const result = decodeMove(board, 0x10); // piece 1, code 0
			expect(result.move.from).toBe("e2");
			expect(result.move.to).toBe("f1");
		});
	});
});
