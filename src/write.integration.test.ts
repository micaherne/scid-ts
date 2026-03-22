import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ScidDatabase, NewGame, ScidAnnotatedMove } from "./index.js";

const FOOL_S_MATE: ScidAnnotatedMove[] = [
	{ from: "f2", to: "f3" },
	{ from: "e7", to: "e5" },
	{ from: "g2", to: "g4" },
	{ from: "d8", to: "h4" },
];

const FOOL_S_MATE_GAME: NewGame = {
	headers: {
		white: "White", black: "Black",
		event: "Test", site: "Test", round: "1",
		date: "2024.01.01", result: "0-1",
	},
	moves: FOOL_S_MATE,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "scid-ts-test-"));
}

for (const ext of [".si4", ".si5"] as const) {
	describe(`write support (${ext})`, () => {
		let dir: string;

		beforeEach(() => { dir = tempDir(); });
		afterEach(() => { fs.rmSync(dir, { recursive: true }); });

		const dbPath = () => path.join(dir, `test${ext}`);

		// -------------------------------------------------------------------

		it("creates an empty database", () => {
			const db = ScidDatabase.create(dbPath());
			expect(db.getGameCount()).toBe(0);
			db.close();
		});

		it("addGame returns the correct index", () => {
			const db = ScidDatabase.create(dbPath());
			const n0 = db.addGame(FOOL_S_MATE_GAME);
			const n1 = db.addGame(FOOL_S_MATE_GAME);
			expect(n0).toBe(0);
			expect(n1).toBe(1);
			db.close();
		});

		it("getGameCount reflects buffered games before save", () => {
			const db = ScidDatabase.create(dbPath());
			db.addGame(FOOL_S_MATE_GAME);
			expect(db.getGameCount()).toBe(1);
			db.close();
		});

		it("saves and reads back headers correctly", () => {
			const db = ScidDatabase.create(dbPath());
			db.addGame(FOOL_S_MATE_GAME);
			db.save();
			db.close();

			const db2 = new ScidDatabase();
			db2.open(dbPath());
			expect(db2.getGameCount()).toBe(1);
			const h = db2.getHeaders(0);
			expect(h.white).toBe("White");
			expect(h.black).toBe("Black");
			expect(h.event).toBe("Test");
			expect(h.site).toBe("Test");
			expect(h.round).toBe("1");
			expect(h.date).toBe("2024.01.01");
			expect(h.result).toBe("0-1");
			db2.close();
		});

		it("saves and reads back moves correctly", () => {
			const db = ScidDatabase.create(dbPath());
			db.addGame(FOOL_S_MATE_GAME);
			db.save();
			db.close();

			const db2 = new ScidDatabase();
			db2.open(dbPath());
			const moves = db2.getMoves(0);
			expect(moves).toEqual(FOOL_S_MATE);
			db2.close();
		});

		it("saves and reads back annotated game correctly", () => {
			const annotated: NewGame = {
				headers: { white: "A", black: "B", result: "0-1" },
				comment: "Game comment",
				moves: [
					{ from: "f2", to: "f3", nags: [6], commentAfter: "A bad move" },
					{ from: "e7", to: "e5" },
					{
						from: "g2", to: "g4",
						variations: [[
							{
								from: "g2", to: "g3",
								commentBefore: "Safer",
								commentAfter:  "Solid",
							},
						]],
					},
					{ from: "d8", to: "h4" },
				],
			};

			const db = ScidDatabase.create(dbPath());
			db.addGame(annotated);
			db.save();
			db.close();

			const db2 = new ScidDatabase();
			db2.open(dbPath());
			const game = db2.getAnnotatedGame(0);
			expect(game.comment).toBe("Game comment");
			expect(game.moves[0].nags).toEqual([6]);
			expect(game.moves[0].commentAfter).toBe("A bad move");
			expect(game.moves[2].variations).toHaveLength(1);
			expect(game.moves[2].variations![0][0].from).toBe("g2");
			expect(game.moves[2].variations![0][0].to).toBe("g3");
			expect(game.moves[2].variations![0][0].commentBefore).toBe("Safer");
			expect(game.moves[2].variations![0][0].commentAfter).toBe("Solid");
			db2.close();
		});

		it("multiple games round-trip correctly", () => {
			const db = ScidDatabase.create(dbPath());
			db.addGame({ headers: { white: "Alice", black: "Bob",   result: "1-0" }, moves: [{ from: "e2", to: "e4" }] });
			db.addGame({ headers: { white: "Carol", black: "Dave",  result: "0-1" }, moves: [{ from: "d2", to: "d4" }] });
			db.save();
			db.close();

			const db2 = new ScidDatabase();
			db2.open(dbPath());
			expect(db2.getGameCount()).toBe(2);
			expect(db2.getHeaders(0).white).toBe("Alice");
			expect(db2.getHeaders(1).white).toBe("Carol");
			expect(db2.getMoves(0)).toEqual([{ from: "e2", to: "e4" }]);
			expect(db2.getMoves(1)).toEqual([{ from: "d2", to: "d4" }]);
			db2.close();
		});

		it("deleteGame marks the game deleted after save", () => {
			const db = ScidDatabase.create(dbPath());
			db.addGame(FOOL_S_MATE_GAME);
			db.save();
			db.deleteGame(0);
			db.save();
			db.close();

			const db2 = new ScidDatabase();
			db2.open(dbPath());
			expect(db2.getHeaders(0).deleted).toBe(true);
			db2.close();
		});

		it("updateGame replaces headers and moves after save", () => {
			const db = ScidDatabase.create(dbPath());
			db.addGame(FOOL_S_MATE_GAME);
			db.save();
			db.updateGame(0, {
				headers: { white: "Updated", result: "1-0" },
				moves: [{ from: "e2", to: "e4" }],
			});
			db.save();
			db.close();

			const db2 = new ScidDatabase();
			db2.open(dbPath());
			const h = db2.getHeaders(0);
			expect(h.white).toBe("Updated");
			expect(h.result).toBe("1-0");
			expect(db2.getMoves(0)).toEqual([{ from: "e2", to: "e4" }]);
			db2.close();
		});

		it("compact removes deleted games and reassigns offsets", () => {
			const db = ScidDatabase.create(dbPath());
			db.addGame({ headers: { white: "A" }, moves: [{ from: "e2", to: "e4" }] });
			db.addGame({ headers: { white: "B" }, moves: [{ from: "d2", to: "d4" }] });
			db.addGame({ headers: { white: "C" }, moves: [{ from: "c2", to: "c4" }] });
			db.save();
			db.deleteGame(1); // remove B
			db.save();
			db.compact();
			db.close();

			const db2 = new ScidDatabase();
			db2.open(dbPath());
			expect(db2.getGameCount()).toBe(2);
			expect(db2.getHeaders(0).white).toBe("A");
			expect(db2.getHeaders(1).white).toBe("C");
			expect(db2.getMoves(0)).toEqual([{ from: "e2", to: "e4" }]);
			expect(db2.getMoves(1)).toEqual([{ from: "c2", to: "c4" }]);
			db2.close();
		});

		it("search works on a freshly written database", () => {
			const db = ScidDatabase.create(dbPath());
			db.addGame(FOOL_S_MATE_GAME);
			db.save();
			db.close();

			const db2 = new ScidDatabase();
			db2.open(dbPath());
			const result = db2.search("White", 0, 10);
			expect(result.total).toBe(1);
			db2.close();
		});
	});
}
