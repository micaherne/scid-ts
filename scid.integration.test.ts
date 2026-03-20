import { describe, it, expect } from "vitest";
import * as fs from "fs";
import { ScidDatabase } from "./index";

const TEST_DB_PATH = "C:\\Users\\michael\\Downloads\\LumbrasGigaBase_OTB_2025-12\\test-db.si5";
const dbExists = fs.existsSync(TEST_DB_PATH);

describe.skipIf(!dbExists)("ScidDatabase integration (SCID5)", () => {
	it("opens the database and reads game count", () => {
		const db = new ScidDatabase();
		db.open(TEST_DB_PATH);
		const count = db.getGameCount();
		expect(count).toBeGreaterThan(0);
		console.log(`Database has ${count} games`);
		db.close();
	});

	it("reads headers for game 0", () => {
		const db = new ScidDatabase();
		db.open(TEST_DB_PATH);
		const headers = db.getHeaders(0);
		console.log("Game 0 headers:", headers);

		expect(headers.white).toBeTruthy();
		expect(headers.white).not.toBe("?");
		expect(headers.black).toBeTruthy();
		expect(headers.black).not.toBe("?");

		db.close();
	});

	it("decodes moves for game 0", () => {
		const db = new ScidDatabase();
		db.open(TEST_DB_PATH);
		const moves = db.getMoves(0);

		expect(moves.length).toBeGreaterThan(0);
		for (let i = 0; i < moves.length; i++) {
			const m = moves[i];
			expect(m.from, `move ${i}: from=${m.from}`).toMatch(/^[a-h][1-8]$/);
			expect(m.to, `move ${i}: to=${m.to}`).toMatch(/^[a-h][1-8]$/);
		}

		db.close();
	});

	it("reads a full game", () => {
		const db = new ScidDatabase();
		db.open(TEST_DB_PATH);
		const game = db.getGame(0);

		expect(game.headers.white).toBeTruthy();
		expect(game.moves.length).toBeGreaterThan(0);
		console.log(`${game.headers.white} vs ${game.headers.black}: ${game.moves.length} moves, ${game.headers.result}`);

		db.close();
	});

	it("searches for games", () => {
		const db = new ScidDatabase();
		db.open(TEST_DB_PATH);
		const headers = db.getHeaders(0);
		// Search for the white player of game 0
		const result = db.search(headers.white.substring(0, 5), 0, 10);
		console.log(`Search found ${result.total} games, showing ${result.results.length}`);

		expect(result.total).toBeGreaterThan(0);
		expect(result.results.length).toBeGreaterThan(0);

		db.close();
	});
});
