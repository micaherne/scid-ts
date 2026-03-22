import { describe, it, expect } from "vitest";
import { Board } from "./board.js";
import { encodeMove } from "./encode.js";
import { decodeMoveOrMarker, DecodeResult } from "./decode.js";
import { algebraicToSquare, squareFile, KING } from "./types.js";

/**
 * Roundtrip helper: encode a move then decode it on the same board position.
 * Returns the decoded move for assertion.
 */
function roundtrip(
	board: Board,
	from: string,
	to: string,
	promo: string | null = null,
): DecodeResult {
	const fromSq = algebraicToSquare(from);
	const toSq   = algebraicToSquare(to);

	const pieceAtFrom = board.pieceAt(fromSq);
	const isCastle = pieceAtFrom?.type === KING
		&& Math.abs(squareFile(toSq) - squareFile(fromSq)) === 2;
	const isNull = from === to;

	const bytes = encodeMove(board, fromSq, toSq,
		promo ? (promo === "q" ? 2 : promo === "r" ? 3 : promo === "b" ? 4 : 5) as any : null,
		isCastle, isNull);

	let extraIdx = 1;
	const result = decodeMoveOrMarker(board, bytes[0], () => bytes[extraIdx++] ?? 0);
	expect(result.type).toBe("move");
	return result as DecodeResult;
}

describe("encode roundtrip — standard position moves", () => {
	it("pawn forward one square: e2-e3", () => {
		const b = new Board(); b.setupStartPosition();
		const m = roundtrip(b, "e2", "e3");
		expect(m.move.from).toBe("e2");
		expect(m.move.to).toBe("e3");
	});

	it("pawn double push: e2-e4", () => {
		const b = new Board(); b.setupStartPosition();
		const m = roundtrip(b, "e2", "e4");
		expect(m.move.from).toBe("e2");
		expect(m.move.to).toBe("e4");
	});

	it("pawn f2-f3 (Fool's Mate move 1)", () => {
		const b = new Board(); b.setupStartPosition();
		const m = roundtrip(b, "f2", "f3");
		expect(m.move.from).toBe("f2");
		expect(m.move.to).toBe("f3");
	});

	it("knight g1-f3: Nf3", () => {
		const b = new Board(); b.setupStartPosition();
		const m = roundtrip(b, "g1", "f3");
		expect(m.move.from).toBe("g1");
		expect(m.move.to).toBe("f3");
	});

	it("knight g1-h3: Nh3", () => {
		const b = new Board(); b.setupStartPosition();
		const m = roundtrip(b, "g1", "h3");
		expect(m.move.from).toBe("g1");
		expect(m.move.to).toBe("h3");
	});
});

describe("encode roundtrip — piece types", () => {
	it("king non-castling move", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/4K3/8/8/7k w - - 0 1");
		const m = roundtrip(b, "e4", "f4");
		expect(m.move.from).toBe("e4");
		expect(m.move.to).toBe("f4");
	});

	it("king null move", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/4K3/8/8/7k w - - 0 1");
		const m = roundtrip(b, "e4", "e4");
		expect(m.isNull).toBe(true);
	});

	it("king kingside castling", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/8/8/8/4K2R w K - 0 1");
		const m = roundtrip(b, "e1", "g1");
		expect(m.move.from).toBe("e1");
		expect(m.move.to).toBe("g1");
		expect(m.isCastle).toBe(true);
	});

	it("king queenside castling", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/8/8/8/R3K3 w Q - 0 1");
		const m = roundtrip(b, "e1", "c1");
		expect(m.move.from).toBe("e1");
		expect(m.move.to).toBe("c1");
		expect(m.isCastle).toBe(true);
	});

	it("queen horizontal move", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/8/8/8/3QK3 w - - 0 1");
		const m = roundtrip(b, "d1", "a1");
		expect(m.move.from).toBe("d1");
		expect(m.move.to).toBe("a1");
	});

	it("queen vertical move", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/8/8/8/3QK3 w - - 0 1");
		const m = roundtrip(b, "d1", "d5");
		expect(m.move.from).toBe("d1");
		expect(m.move.to).toBe("d5");
	});

	it("queen diagonal move (two bytes)", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/8/8/8/3QK3 w - - 0 1");
		const m = roundtrip(b, "d1", "h5");
		expect(m.move.from).toBe("d1");
		expect(m.move.to).toBe("h5");
	});

	it("rook horizontal move", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/8/8/8/R3K3 w - - 0 1");
		const m = roundtrip(b, "a1", "d1");
		expect(m.move.from).toBe("a1");
		expect(m.move.to).toBe("d1");
	});

	it("rook vertical move", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/8/8/8/R3K3 w - - 0 1");
		const m = roundtrip(b, "a1", "a5");
		expect(m.move.from).toBe("a1");
		expect(m.move.to).toBe("a5");
	});

	it("bishop diagonal move", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/8/8/8/8/2B1K3 w - - 0 1");
		const m = roundtrip(b, "c1", "f4");
		expect(m.move.from).toBe("c1");
		expect(m.move.to).toBe("f4");
	});

	it("pawn capture left (white)", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/3p4/4P3/8/8/4K2k w - - 0 1");
		const m = roundtrip(b, "e4", "d5");
		expect(m.move.from).toBe("e4");
		expect(m.move.to).toBe("d5");
	});

	it("pawn capture right (white)", () => {
		const b = new Board();
		b.setupFromFEN("8/8/8/5p2/4P3/8/8/4K2k w - - 0 1");
		const m = roundtrip(b, "e4", "f5");
		expect(m.move.from).toBe("e4");
		expect(m.move.to).toBe("f5");
	});

	it("pawn queen promotion forward", () => {
		const b = new Board();
		b.setupFromFEN("8/4P3/8/8/8/8/8/4K2k w - - 0 1");
		const m = roundtrip(b, "e7", "e8", "q");
		expect(m.move.from).toBe("e7");
		expect(m.move.to).toBe("e8");
		expect(m.move.promotion).toBe("q");
	});

	it("pawn knight promotion capture-right", () => {
		const b = new Board();
		b.setupFromFEN("5n2/4P3/8/8/8/8/8/4K2k w - - 0 1");
		const m = roundtrip(b, "e7", "f8", "n");
		expect(m.move.from).toBe("e7");
		expect(m.move.to).toBe("f8");
		expect(m.move.promotion).toBe("n");
	});

	it("black pawn forward", () => {
		const b = new Board();
		b.setupFromFEN("4k3/8/8/8/8/8/4p3/4K3 b - - 0 1");
		const m = roundtrip(b, "e2", "e1");
		expect(m.move.from).toBe("e2");
		expect(m.move.to).toBe("e1");
	});
});
