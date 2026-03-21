import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { ScidDatabase } from "./index.js";

const FIXTURES_DIR = path.join(__dirname, "../fixtures");

// ---------------------------------------------------------------------------
// Fixture-based tests — always run, no external dependencies
// Fixture: Fool's Mate (1.f3 e5 2.g4 Qh4#), result 0-1, date 2024.01.01
// ---------------------------------------------------------------------------

const FOOL_S_MATE_MOVES = [
	{ from: "f2", to: "f3" },
	{ from: "e7", to: "e5" },
	{ from: "g2", to: "g4" },
	{ from: "d8", to: "h4" },
];

describe("ScidDatabase integration (SCID5 fixtures)", () => {
	it("reads game count", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si5"));
		expect(db.getGameCount()).toBe(1);
		db.close();
	});

	it("reads headers for game 0", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si5"));
		const h = db.getHeaders(0);
		expect(h.white).toBe("White");
		expect(h.black).toBe("Black");
		expect(h.event).toBe("Test");
		expect(h.site).toBe("Test");
		expect(h.round).toBe("1");
		expect(h.date).toBe("2024.01.01");
		expect(h.result).toBe("0-1");
		expect(h.whiteElo).toBe(0);
		expect(h.blackElo).toBe(0);
		db.close();
	});

	it("reads moves for Fool's Mate", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si5"));
		const moves = db.getMoves(0);
		expect(moves).toEqual(FOOL_S_MATE_MOVES);
		db.close();
	});

	it("reads a full game via getGame()", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si5"));
		const game = db.getGame(0);
		expect(game.headers.white).toBe("White");
		expect(game.headers.result).toBe("0-1");
		expect(game.moves).toEqual(FOOL_S_MATE_MOVES);
		db.close();
	});

	it("searches by player name", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si5"));
		const result = db.search("White", 0, 10);
		expect(result.total).toBe(1);
		expect(result.results).toEqual([0]);
		db.close();
	});

	it("search returns empty for unknown query", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si5"));
		const result = db.search("Kasparov", 0, 10);
		expect(result.total).toBe(0);
		expect(result.results).toEqual([]);
		db.close();
	});
});

describe("ScidDatabase integration (SCID4 fixtures)", () => {
	it("reads game count", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si4"));
		expect(db.getGameCount()).toBe(1);
		db.close();
	});

	it("reads headers for game 0", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si4"));
		const h = db.getHeaders(0);
		expect(h.white).toBe("White");
		expect(h.black).toBe("Black");
		expect(h.event).toBe("Test");
		expect(h.site).toBe("Test");
		expect(h.round).toBe("1");
		expect(h.date).toBe("2024.01.01");
		expect(h.result).toBe("0-1");
		db.close();
	});

	it("reads moves for Fool's Mate", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "test.si4"));
		const moves = db.getMoves(0);
		expect(moves).toEqual(FOOL_S_MATE_MOVES);
		db.close();
	});
});

// ---------------------------------------------------------------------------
// Annotated game fixtures (SCID5 only)
// Game: {Game comment} 1.f3?! {A bad move} e5  2.g4 ({Interesting try} 2.e4 {Better}) Qh4#
// ---------------------------------------------------------------------------

describe("ScidDatabase getAnnotatedGame (SCID5 annotated fixture)", () => {
	it("returns main-line moves unchanged", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		expect(game.moves.map(m => ({ from: m.from, to: m.to }))).toEqual(
			FOOL_S_MATE_MOVES.map(m => ({ from: m.from, to: m.to }))
		);
		db.close();
	});

	it("attaches game-level pre-game comment", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		expect(game.comment).toBe("Game comment");
		db.close();
	});

	it("attaches NAG to the correct move", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		expect(game.moves[0].nags).toEqual([6]); // ?! on 1.f3
		expect(game.moves[1].nags).toBeUndefined();
		db.close();
	});

	it("attaches commentAfter to the correct move", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		expect(game.moves[0].commentAfter).toBe("A bad move"); // after 1.f3
		expect(game.moves[1].commentAfter).toBeUndefined();
		expect(game.moves[2].commentAfter).toBeUndefined();
		expect(game.moves[3].commentAfter).toBeUndefined();
		db.close();
	});

	it("returns the variation on the correct move", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		// Variation is on 2.g4 (index 2): alternative is 2.e4
		expect(game.moves[0].variations).toBeUndefined();
		expect(game.moves[1].variations).toBeUndefined();
		expect(game.moves[2].variations).toHaveLength(1);
		expect(game.moves[3].variations).toBeUndefined();
		db.close();
	});

	it("decodes variation moves with commentBefore and commentAfter", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		const variation = game.moves[2].variations![0];
		expect(variation).toHaveLength(1);
		expect(variation[0].from).toBe("e2");
		expect(variation[0].to).toBe("e4");
		expect(variation[0].commentBefore).toBe("Interesting try");
		expect(variation[0].commentAfter).toBe("Better");
		db.close();
	});

	it("returns extraTags as empty array when no extra tags present", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		expect(game.extraTags).toEqual([]);
		db.close();
	});

	it("returns no startFen for standard starting position", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		expect(game.startFen).toBeUndefined();
		db.close();
	});

	it("headers are still correct", () => {
		const db = new ScidDatabase();
		db.open(path.join(FIXTURES_DIR, "annotated.si5"));
		const game = db.getAnnotatedGame(0);
		expect(game.headers.white).toBe("White");
		expect(game.headers.result).toBe("0-1");
		db.close();
	});
});

// ---------------------------------------------------------------------------
// Optional: run against a real external database if SCID_TEST_DB is set
// ---------------------------------------------------------------------------

const EXTERNAL_DB = process.env.SCID_TEST_DB;

describe.skipIf(!EXTERNAL_DB || !fs.existsSync(EXTERNAL_DB ?? ""))(
	"ScidDatabase integration (external database via SCID_TEST_DB)",
	() => {
		it("opens the database and reads game count", () => {
			const db = new ScidDatabase();
			db.open(EXTERNAL_DB!);
			const count = db.getGameCount();
			expect(count).toBeGreaterThan(0);
			db.close();
		});

		it("reads headers for game 0", () => {
			const db = new ScidDatabase();
			db.open(EXTERNAL_DB!);
			const headers = db.getHeaders(0);
			expect(headers.white).toBeTruthy();
			expect(headers.black).toBeTruthy();
			db.close();
		});

		it("decodes moves for game 0", () => {
			const db = new ScidDatabase();
			db.open(EXTERNAL_DB!);
			const moves = db.getMoves(0);
			expect(moves.length).toBeGreaterThan(0);
			for (const m of moves) {
				expect(m.from).toMatch(/^[a-h][1-8]$/);
				expect(m.to).toMatch(/^[a-h][1-8]$/);
			}
			db.close();
		});
	}
);
