import { describe, it, expect } from "vitest";
import * as path from "path";
import * as fs from "fs";
import { ScidDatabase } from "./index";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

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
