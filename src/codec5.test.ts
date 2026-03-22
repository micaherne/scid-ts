import { describe, it, expect } from "vitest";
import { codec5 } from "./codec5.js";
import { FLAG_DELETE, FLAG_TACTICS, FLAG_CUSTOM3, decodeAnnotationCount } from "./types.js";

// ---------------------------------------------------------------------------
// Standalone encoder matching SCID's encode_IndexEntry in codec_scid5.h.
// This is intentionally independent of our codec implementation so the tests
// act as a genuine spec-level check.
// ---------------------------------------------------------------------------

interface EntryFields {
	nComments?: number;    // raw 4-bit value (0-15)
	whiteId?: number;      // 28 bits
	nVariations?: number;  // raw 4-bit value (0-15)
	blackId?: number;      // 28 bits
	nNags?: number;        // raw 4-bit value (0-15)
	eventId?: number;      // 28 bits
	siteId?: number;       // 32 bits
	chess960?: boolean;
	roundId?: number;      // 31 bits
	whiteElo?: number;     // 12 bits
	date?: number;         // 20 bits
	blackElo?: number;     // 12 bits
	eventDate?: number;    // 20 bits
	numHalfMoves?: number; // 10 bits
	flags?: number;        // 22 bits
	gameLength?: number;   // 17 bits
	offset?: number;       // 47 bits (as JS number, safe up to 2^53)
	storedLineCode?: number; // 8 bits
	finalMatSig?: number;    // 24 bits
	homePawnCount?: number;  // 8 bits (stored in word 11 high byte)
	homePawnData?: number[]; // 8 bytes (bytes 48-55)
	whiteEloType?: number;   // 3 bits
	blackEloType?: number;   // 3 bits
	result?: number;         // 2 bits
	eco?: number;            // 16 bits
}

/** Pack a into top aSz bits and b into bottom (32-aSz) bits, returning uint32. */
function pack(a: number, aSz: number, b: number): number {
	return (((a << (32 - aSz)) >>> 0) | (b >>> 0)) >>> 0;
}

function writeU32LE(buf: Buffer, off: number, val: number): void {
	buf.writeUInt32LE(val >>> 0, off);
}

function encodeEntry(f: EntryFields = {}): Buffer {
	const {
		nComments = 0, whiteId = 0,
		nVariations = 0, blackId = 0,
		nNags = 0, eventId = 0,
		siteId = 0,
		chess960 = false, roundId = 0,
		whiteElo = 0, date = 0,
		blackElo = 0, eventDate = 0,
		numHalfMoves = 0, flags = 0,
		gameLength = 0, offset = 0,
		storedLineCode = 0, finalMatSig = 0,
		homePawnCount = 0, homePawnData = [],
		whiteEloType = 0, blackEloType = 0,
		result = 0, eco = 0,
	} = f;

	const buf = Buffer.alloc(56, 0);

	writeU32LE(buf, 0,  pack(nComments,                      4,  whiteId));
	writeU32LE(buf, 4,  pack(nVariations,                    4,  blackId));
	writeU32LE(buf, 8,  pack(nNags,                          4,  eventId));
	writeU32LE(buf, 12, siteId >>> 0);
	writeU32LE(buf, 16, pack(chess960 ? 1 : 0,               1,  roundId));
	writeU32LE(buf, 20, pack(whiteElo,                       12, date));
	writeU32LE(buf, 24, pack(blackElo,                       12, eventDate));
	writeU32LE(buf, 28, pack(numHalfMoves,                   10, flags & 0x3FFFFF));

	const offsetHigh = Math.floor(offset / 0x100000000) & 0x7FFF;
	const offsetLow  = offset >>> 0;
	writeU32LE(buf, 32, pack(gameLength,                     17, offsetHigh));
	writeU32LE(buf, 36, offsetLow);

	writeU32LE(buf, 40, pack(storedLineCode,                 8,  finalMatSig));

	const rtypes = ((whiteEloType & 0x7) << 5) | ((blackEloType & 0x7) << 2) | (result & 0x3);
	writeU32LE(buf, 44, pack((homePawnCount << 8) | rtypes,  16, eco));

	for (let i = 0; i < 8; i++) buf[48 + i] = homePawnData[i] ?? 0;

	return buf;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("codec5.readIndex", () => {
	it("parses an all-zero entry without throwing", () => {
		const buf = encodeEntry();
		const entries = codec5.readIndex(buf);
		expect(entries).toHaveLength(1);
		const e = entries[0];
		expect(e.whiteId).toBe(0);
		expect(e.blackId).toBe(0);
		expect(e.flags).toBe(0);
		expect(e.deleted).toBe(false);
		expect(e.chess960).toBe(false);
	});

	it("parses whiteId and nComments from word 0", () => {
		const buf = encodeEntry({ whiteId: 0x0ABCDEF, nComments: 7 });
		const [e] = codec5.readIndex(buf);
		expect(e.whiteId).toBe(0x0ABCDEF);
		expect(e.nComments).toBe(7);
	});

	it("parses blackId and nVariations from word 1", () => {
		const buf = encodeEntry({ blackId: 0x1234567, nVariations: 3 });
		const [e] = codec5.readIndex(buf);
		expect(e.blackId).toBe(0x1234567);
		expect(e.nVariations).toBe(3);
	});

	it("parses eventId and nNags from word 2", () => {
		const buf = encodeEntry({ eventId: 0x0FEDCBA, nNags: 15 });
		const [e] = codec5.readIndex(buf);
		expect(e.eventId).toBe(0x0FEDCBA);
		expect(e.nNags).toBe(15);
	});

	it("parses siteId from word 3", () => {
		const buf = encodeEntry({ siteId: 0xDEADBEEF });
		const [e] = codec5.readIndex(buf);
		expect(e.siteId).toBe(0xDEADBEEF >>> 0);
	});

	it("parses chess960 flag from word 4", () => {
		const buf = encodeEntry({ chess960: true, roundId: 0x1ABCDEF });
		const [e] = codec5.readIndex(buf);
		expect(e.chess960).toBe(true);
		expect(e.roundId).toBe(0x1ABCDEF);
	});

	it("parses chess960=false correctly", () => {
		const buf = encodeEntry({ chess960: false, roundId: 42 });
		const [e] = codec5.readIndex(buf);
		expect(e.chess960).toBe(false);
		expect(e.roundId).toBe(42);
	});

	it("parses whiteElo and date from word 5", () => {
		// date encoding: (year << 9) | (month << 5) | day
		const date = (2024 << 9) | (1 << 5) | 1;
		const buf = encodeEntry({ whiteElo: 2765, date });
		const [e] = codec5.readIndex(buf);
		expect(e.whiteElo).toBe(2765);
		expect(e.date).toBe(date);
	});

	it("parses blackElo and eventDate from word 6", () => {
		const eventDate = (2023 << 9) | (11 << 5) | 15;
		const buf = encodeEntry({ blackElo: 2400, eventDate });
		const [e] = codec5.readIndex(buf);
		expect(e.blackElo).toBe(2400);
		expect(e.eventDate).toBe(eventDate);
	});

	it("parses numHalfMoves from word 7", () => {
		const buf = encodeEntry({ numHalfMoves: 1023 });
		const [e] = codec5.readIndex(buf);
		expect(e.numHalfMoves).toBe(1023);
	});

	it("parses flags from word 7", () => {
		const buf = encodeEntry({ flags: FLAG_TACTICS | FLAG_CUSTOM3 });
		const [e] = codec5.readIndex(buf);
		expect(e.flags & FLAG_TACTICS).toBeTruthy();
		expect(e.flags & FLAG_CUSTOM3).toBeTruthy();
		expect(e.flags & FLAG_DELETE).toBeFalsy();
	});

	it("parses the delete flag correctly", () => {
		const buf = encodeEntry({ flags: FLAG_DELETE });
		const [e] = codec5.readIndex(buf);
		expect(e.flags & FLAG_DELETE).toBeTruthy();
		expect(e.deleted).toBe(true);
	});

	it("parses gameLength from word 8", () => {
		const buf = encodeEntry({ gameLength: 131071 }); // max 17-bit value
		const [e] = codec5.readIndex(buf);
		expect(e.gameLength).toBe(131071);
	});

	it("parses a simple offset from words 8-9", () => {
		const buf = encodeEntry({ offset: 4096 });
		const [e] = codec5.readIndex(buf);
		expect(e.gameOffset).toBe(4096);
	});

	it("parses a large offset spanning high and low words", () => {
		// offset = 5 * 2^32 + 0x12345678 (requires offsetHigh = 5)
		const offset = 5 * 0x100000000 + 0x12345678;
		const buf = encodeEntry({ offset });
		const [e] = codec5.readIndex(buf);
		expect(e.gameOffset).toBe(offset);
	});

	it("parses storedLineCode from word 10", () => {
		const buf = encodeEntry({ storedLineCode: 0xAB });
		const [e] = codec5.readIndex(buf);
		expect(e.storedLineCode).toBe(0xAB);
	});

	it("parses finalMatSig from word 10", () => {
		const buf = encodeEntry({ finalMatSig: 0x123456 });
		const [e] = codec5.readIndex(buf);
		expect(e.finalMatSig).toBe(0x123456);
	});

	it("parses whiteEloType, blackEloType, result, eco from word 11", () => {
		const buf = encodeEntry({ whiteEloType: 3, blackEloType: 5, result: 2, eco: 0x1A2B });
		const [e] = codec5.readIndex(buf);
		expect(e.whiteEloType).toBe(3);
		expect(e.blackEloType).toBe(5);
		expect(e.result).toBe(2);
		expect(e.eco).toBe(0x1A2B);
	});

	it("parses homePawnData bytes 48-55", () => {
		const homePawnData = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
		const buf = encodeEntry({ homePawnCount: 6, homePawnData });
		const [e] = codec5.readIndex(buf);
		expect(e.homePawnData[0]).toBe(6);       // count byte
		for (let i = 0; i < 8; i++) {
			expect(e.homePawnData[i + 1]).toBe(homePawnData[i]);
		}
	});

	it("decodes annotation counts using the 4-bit table", () => {
		// Raw value 11 → decoded count 15 (see DecodeCount in indexentry.h)
		const buf = encodeEntry({ nComments: 11, nVariations: 12, nNags: 15 });
		const [e] = codec5.readIndex(buf);
		expect(decodeAnnotationCount(e.nComments)).toBe(15);
		expect(decodeAnnotationCount(e.nVariations)).toBe(20);
		expect(decodeAnnotationCount(e.nNags)).toBe(50);
	});

	it("parses multiple entries in sequence", () => {
		const buf = Buffer.concat([
			encodeEntry({ whiteId: 1, result: 1 }),
			encodeEntry({ whiteId: 2, result: 2 }),
			encodeEntry({ whiteId: 3, result: 3 }),
		]);
		const entries = codec5.readIndex(buf);
		expect(entries).toHaveLength(3);
		expect(entries[0].whiteId).toBe(1);
		expect(entries[1].whiteId).toBe(2);
		expect(entries[2].whiteId).toBe(3);
		expect(entries[0].result).toBe(1);
		expect(entries[2].result).toBe(3);
	});

	it("ignores trailing bytes that don't form a complete entry", () => {
		const buf = Buffer.concat([encodeEntry({ whiteId: 99 }), Buffer.alloc(10)]);
		const entries = codec5.readIndex(buf);
		expect(entries).toHaveLength(1);
		expect(entries[0].whiteId).toBe(99);
	});

	it("parses a fully populated entry round-trip", () => {
		const date      = (2024 << 9) | (3 << 5) | 22;
		const eventDate = (2024 << 9) | (1 << 5) | 1;
		const offset    = 3 * 0x100000000 + 0xABCDEF00;
		const buf = encodeEntry({
			nComments: 5, whiteId: 0x0123456,
			nVariations: 2, blackId: 0x0FEDCBA,
			nNags: 1, eventId: 0x0ABCDEF,
			siteId: 0x87654321,
			chess960: false, roundId: 0x0001234,
			whiteElo: 2800, date,
			blackElo: 2600, eventDate,
			numHalfMoves: 80, flags: FLAG_DELETE | FLAG_TACTICS,
			gameLength: 256, offset,
			storedLineCode: 0x42, finalMatSig: 0xFEDCBA,
			homePawnCount: 4, homePawnData: [1, 2, 3, 4, 5, 6, 7, 8],
			whiteEloType: 1, blackEloType: 2, result: 1, eco: 0xB20,
		});

		const [e] = codec5.readIndex(buf);
		expect(e.nComments).toBe(5);
		expect(e.whiteId).toBe(0x0123456);
		expect(e.nVariations).toBe(2);
		expect(e.blackId).toBe(0x0FEDCBA);
		expect(e.nNags).toBe(1);
		expect(e.eventId).toBe(0x0ABCDEF);
		expect(e.siteId).toBe(0x87654321 >>> 0);
		expect(e.chess960).toBe(false);
		expect(e.roundId).toBe(0x0001234);
		expect(e.whiteElo).toBe(2800);
		expect(e.date).toBe(date);
		expect(e.blackElo).toBe(2600);
		expect(e.eventDate).toBe(eventDate);
		expect(e.numHalfMoves).toBe(80);
		expect(e.flags & FLAG_DELETE).toBeTruthy();
		expect(e.flags & FLAG_TACTICS).toBeTruthy();
		expect(e.deleted).toBe(true);
		expect(e.gameLength).toBe(256);
		expect(e.gameOffset).toBe(offset);
		expect(e.storedLineCode).toBe(0x42);
		expect(e.finalMatSig).toBe(0xFEDCBA);
		expect(e.homePawnData[0]).toBe(4);
		expect(e.homePawnData[1]).toBe(1);
		expect(e.whiteEloType).toBe(1);
		expect(e.blackEloType).toBe(2);
		expect(e.result).toBe(1);
		expect(e.eco).toBe(0xB20);
	});
});
