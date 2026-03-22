import { describe, it, expect } from "vitest";
import { codec4 } from "./codec4.js";
import { FLAG_DELETE, FLAG_BRILLIANCY, FLAG_CUSTOM1, FLAG_CUSTOM6, decodeAnnotationCount } from "./types.js";

// ---------------------------------------------------------------------------
// Standalone encoder matching SCID's encodeIndexEntry() in codec_scid4.cpp.
// This is intentionally independent of the codec implementation so the tests
// act as a genuine spec-level check.
//
// SCID4 index file layout (derived from codec_scid4.cpp):
//
//   Header (182 bytes):
//     0-7:   magic "Scid.si\x1a"
//     8-9:   version (uint16 BE)
//    10-13:  baseType (uint32 BE)
//    14-16:  numGames (uint24 BE)
//    17-19:  autoLoad (uint24 BE)
//    20-127: description (108 bytes, null-padded)
//   128-181: flag descriptions (6 × 9 bytes, null-padded)
//
//   Per-entry (47 bytes, all big-endian unless noted):
//    0-3:  gameOffset (uint32)
//    4-5:  gameLength low 16 bits (uint16)
//    6:    len_flags: bit7 = gameLength bit16; bits5:0 = customFlags (bits 21:16 of flags)
//    7-8:  flags16 (bits 15:0 of combined 22-bit flags)
//    9:    (whiteId bits 19:16) << 4 | (blackId bits 19:16)
//   10-11: whiteId low 16 bits
//   12-13: blackId low 16 bits
//   14:    (eventId bits 18:16) << 5 | (siteId bits 18:16) << 2 | (roundId bits 17:16)
//   15-16: eventId low 16 bits
//   17-18: siteId low 16 bits
//   19-20: roundId low 16 bits
//   21-22: varCounts uint16: bits15:12=result, bits11:8=nNags, bits7:4=nComments, bits3:0=nVariations
//   23-24: ECO (uint16)
//   25-28: uint32 BE: bits31:20 = compact eventDate (12 bits), bits19:0 = date (20 bits)
//          compact eventDate: bits11:9=eyear_rel, bits8:5=month, bits4:0=day
//          eyear_rel = (event_year - game_year + 4) & 7; 0 = unknown
//   29-30: (whiteEloType << 12) | whiteElo  [uint16]
//   31-32: (blackEloType << 12) | blackElo  [uint16]
//   33-36: uint32 BE: bits31:24 = storedLineCode, bits23:0 = finalMatSig
//   37:    numHalfMoves low 8 bits
//   38:    (numHalfMoves bits9:8) << 6 | (homePawnCount & 0x3F)
//   39-46: homePawnData (8 data bytes; count is in byte 38 bits 5:0)
// ---------------------------------------------------------------------------

interface EntryFields {
	gameOffset?: number;     // 32 bits
	gameLength?: number;     // 17 bits
	flags?: number;          // 22-bit combined (bits 21:16 = custom, 15:0 = standard)
	whiteId?: number;        // 20 bits
	blackId?: number;        // 20 bits
	eventId?: number;        // 19 bits
	siteId?: number;         // 19 bits
	roundId?: number;        // 18 bits
	nVariations?: number;    // raw 4-bit coded
	nComments?: number;      // raw 4-bit coded
	nNags?: number;          // raw 4-bit coded
	result?: number;         // 4 bits (0-3)
	eco?: number;            // 16 bits
	date?: number;           // 20-bit date (year<<9 | month<<5 | day)
	eventDate?: number;      // 20-bit absolute date (will be compact-encoded relative to date)
	whiteElo?: number;       // 12 bits
	whiteEloType?: number;   // 4 bits
	blackElo?: number;       // 12 bits
	blackEloType?: number;   // 4 bits
	storedLineCode?: number; // 8 bits
	finalMatSig?: number;    // 24 bits
	numHalfMoves?: number;   // 10 bits
	homePawnCount?: number;  // 6 bits (stored in byte 38 low 6 bits)
	homePawnData?: number[]; // 8 data bytes (bytes 39-46)
}

/** Write big-endian uint16 into buf at offset. */
function writeU16BE(buf: Buffer, off: number, v: number) {
	buf[off]     = (v >> 8) & 0xFF;
	buf[off + 1] = v & 0xFF;
}

/** Write big-endian uint32 into buf at offset. */
function writeU32BE(buf: Buffer, off: number, v: number) {
	buf[off]     = (v >>> 24) & 0xFF;
	buf[off + 1] = (v >>> 16) & 0xFF;
	buf[off + 2] = (v >>> 8) & 0xFF;
	buf[off + 3] = v & 0xFF;
}

/**
 * Encode an absolute eventDate into the 12-bit compact form relative to date.
 * Returns 0 if unknown or too far from date.
 */
function encodeCompactEventDate(eventDate: number, date: number): number {
	if (!eventDate) return 0;
	const eyear = eventDate >> 9;
	const dyear = date >> 9;
	if (eyear < dyear - 3 || eyear > dyear + 3) return 0;
	const eyearRel = (eyear - dyear + 4) & 7;
	const month = (eventDate >> 5) & 0xF;
	const day = eventDate & 0x1F;
	return (eyearRel << 9) | (month << 5) | day;
}

function encodeEntry(f: EntryFields = {}): Buffer {
	const {
		gameOffset = 0, gameLength = 0, flags = 0,
		whiteId = 0, blackId = 0,
		eventId = 0, siteId = 0, roundId = 0,
		nVariations = 0, nComments = 0, nNags = 0, result = 0,
		eco = 0, date = 0, eventDate = 0,
		whiteElo = 0, whiteEloType = 0,
		blackElo = 0, blackEloType = 0,
		storedLineCode = 0, finalMatSig = 0,
		numHalfMoves = 0, homePawnCount = 0, homePawnData = [],
	} = f;

	const buf = Buffer.alloc(47, 0);

	// Bytes 0-3: gameOffset
	writeU32BE(buf, 0, gameOffset >>> 0);

	// Bytes 4-5: gameLength low 16 bits
	writeU16BE(buf, 4, gameLength & 0xFFFF);

	// Byte 6: len_flags = (gameLength bit16 as bit7) | (customFlags in bits5:0)
	const customFlags = (flags >>> 16) & 0x3F;
	buf[6] = ((gameLength >= 0x10000) ? 0x80 : 0x00) | customFlags;

	// Bytes 7-8: flags16 (bits 15:0)
	writeU16BE(buf, 7, flags & 0xFFFF);

	// Byte 9: whiteId high nibble | blackId high nibble
	buf[9] = (((whiteId >>> 16) & 0xF) << 4) | ((blackId >>> 16) & 0xF);
	writeU16BE(buf, 10, whiteId & 0xFFFF);
	writeU16BE(buf, 12, blackId & 0xFFFF);

	// Byte 14: eventId/siteId/roundId high bits
	buf[14] = (((eventId >>> 16) & 0x7) << 5) | (((siteId >>> 16) & 0x7) << 2) | ((roundId >>> 16) & 0x3);
	writeU16BE(buf, 15, eventId & 0xFFFF);
	writeU16BE(buf, 17, siteId & 0xFFFF);
	writeU16BE(buf, 19, roundId & 0xFFFF);

	// Bytes 21-22: varCounts uint16: bits15:12=result, bits11:8=nNags, bits7:4=nComments, bits3:0=nVariations
	const varCounts = ((result & 0xF) << 12) | ((nNags & 0xF) << 8) | ((nComments & 0xF) << 4) | (nVariations & 0xF);
	writeU16BE(buf, 21, varCounts);

	// Bytes 23-24: ECO
	writeU16BE(buf, 23, eco & 0xFFFF);

	// Bytes 25-28: compact eventDate (12 bits high) | date (20 bits low)
	const compact = encodeCompactEventDate(eventDate, date);
	writeU32BE(buf, 25, ((compact & 0xFFF) << 20) | (date & 0xFFFFF));

	// Bytes 29-30: (whiteEloType << 12) | whiteElo
	writeU16BE(buf, 29, ((whiteEloType & 0xF) << 12) | (whiteElo & 0xFFF));

	// Bytes 31-32: (blackEloType << 12) | blackElo
	writeU16BE(buf, 31, ((blackEloType & 0xF) << 12) | (blackElo & 0xFFF));

	// Bytes 33-36: (storedLineCode << 24) | finalMatSig
	writeU32BE(buf, 33, ((storedLineCode & 0xFF) << 24) | (finalMatSig & 0xFFFFFF));

	// Byte 37: numHalfMoves low 8 bits
	buf[37] = numHalfMoves & 0xFF;

	// Byte 38: (numHalfMoves bits 9:8) << 6 | (homePawnCount & 0x3F)
	buf[38] = (((numHalfMoves >>> 8) & 0x3) << 6) | (homePawnCount & 0x3F);

	// Bytes 39-46: 8 homePawnData bytes
	for (let i = 0; i < 8; i++) buf[39 + i] = homePawnData[i] ?? 0;

	return buf;
}

/** Build a complete SCID4 index buffer: 182-byte header + entries. */
function buildIndex(...entries: Buffer[]): Buffer {
	const header = Buffer.alloc(182, 0);
	Buffer.from("Scid.si\x1a").copy(header, 0);  // magic
	header.writeUInt16BE(400, 8);                  // version
	// baseType at 10-13 (leave 0)
	// numGames at bytes 14-16
	const n = entries.length;
	header[14] = (n >> 16) & 0xFF;
	header[15] = (n >> 8) & 0xFF;
	header[16] = n & 0xFF;
	return Buffer.concat([header, ...entries]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("codec4.readIndex", () => {
	it("parses an all-zero entry without throwing", () => {
		const buf = buildIndex(encodeEntry());
		const entries = codec4.readIndex(buf);
		expect(entries).toHaveLength(1);
		const e = entries[0];
		expect(e.whiteId).toBe(0);
		expect(e.flags).toBe(0);
		expect(e.deleted).toBe(false);
		expect(e.chess960).toBe(false);
	});

	it("parses gameOffset from bytes 0-3", () => {
		const buf = buildIndex(encodeEntry({ gameOffset: 0x12345678 }));
		const [e] = codec4.readIndex(buf);
		expect(e.gameOffset).toBe(0x12345678);
	});

	it("parses gameLength below 65536", () => {
		const buf = buildIndex(encodeEntry({ gameLength: 1234 }));
		const [e] = codec4.readIndex(buf);
		expect(e.gameLength).toBe(1234);
	});

	it("parses gameLength at exactly 65536", () => {
		const buf = buildIndex(encodeEntry({ gameLength: 65536 }));
		const [e] = codec4.readIndex(buf);
		expect(e.gameLength).toBe(65536);
	});

	it("parses gameLength at max (131071)", () => {
		const buf = buildIndex(encodeEntry({ gameLength: 131071 }));
		const [e] = codec4.readIndex(buf);
		expect(e.gameLength).toBe(131071);
	});

	it("parses flags16 (bits 15:0) from bytes 7-8", () => {
		const buf = buildIndex(encodeEntry({ flags: FLAG_DELETE | FLAG_BRILLIANCY }));
		const [e] = codec4.readIndex(buf);
		expect(e.flags & FLAG_DELETE).toBeTruthy();
		expect(e.flags & FLAG_BRILLIANCY).toBeTruthy();
		expect(e.deleted).toBe(true);
	});

	it("parses customFlags (bits 21:16) from byte 6", () => {
		const buf = buildIndex(encodeEntry({ flags: FLAG_CUSTOM1 | FLAG_CUSTOM6 }));
		const [e] = codec4.readIndex(buf);
		expect(e.flags & FLAG_CUSTOM1).toBeTruthy();
		expect(e.flags & FLAG_CUSTOM6).toBeTruthy();
	});

	it("parses combined flags (standard + custom) correctly", () => {
		const combined = FLAG_DELETE | FLAG_BRILLIANCY | FLAG_CUSTOM1 | FLAG_CUSTOM6;
		const buf = buildIndex(encodeEntry({ flags: combined }));
		const [e] = codec4.readIndex(buf);
		expect(e.flags).toBe(combined);
	});

	it("parses whiteId (20-bit) correctly", () => {
		const buf = buildIndex(encodeEntry({ whiteId: 0xFABCD }));
		const [e] = codec4.readIndex(buf);
		expect(e.whiteId).toBe(0xFABCD);
	});

	it("parses blackId (20-bit) correctly", () => {
		const buf = buildIndex(encodeEntry({ blackId: 0xEDCBA }));
		const [e] = codec4.readIndex(buf);
		expect(e.blackId).toBe(0xEDCBA);
	});

	it("parses eventId, siteId, roundId", () => {
		const buf = buildIndex(encodeEntry({ eventId: 0x71234, siteId: 0x65432, roundId: 0x31234 }));
		const [e] = codec4.readIndex(buf);
		expect(e.eventId).toBe(0x71234);
		expect(e.siteId).toBe(0x65432);
		expect(e.roundId).toBe(0x31234);
	});

	it("parses nVariations, nComments, nNags, result from varCounts uint16", () => {
		const buf = buildIndex(encodeEntry({ nVariations: 5, nComments: 3, nNags: 7, result: 2 }));
		const [e] = codec4.readIndex(buf);
		expect(e.nVariations).toBe(5);
		expect(e.nComments).toBe(3);
		expect(e.nNags).toBe(7);
		expect(e.result).toBe(2);
	});

	it("parses ECO from bytes 23-24", () => {
		const buf = buildIndex(encodeEntry({ eco: 0x1A2B }));
		const [e] = codec4.readIndex(buf);
		expect(e.eco).toBe(0x1A2B);
	});

	it("parses date (20-bit) from low bits of bytes 25-28", () => {
		const date = (2024 << 9) | (3 << 5) | 22;
		const buf = buildIndex(encodeEntry({ date }));
		const [e] = codec4.readIndex(buf);
		expect(e.date).toBe(date);
	});

	it("parses eventDate (same year as date) from compact encoding", () => {
		const date      = (2024 << 9) | (1 << 5) | 1;
		const eventDate = (2024 << 9) | (3 << 5) | 15;
		const buf = buildIndex(encodeEntry({ date, eventDate }));
		const [e] = codec4.readIndex(buf);
		expect(e.date).toBe(date);
		expect(e.eventDate).toBe(eventDate);
	});

	it("parses eventDate one year before date", () => {
		const date      = (2024 << 9) | (6 << 5) | 1;
		const eventDate = (2023 << 9) | (12 << 5) | 15;
		const buf = buildIndex(encodeEntry({ date, eventDate }));
		const [e] = codec4.readIndex(buf);
		expect(e.eventDate).toBe(eventDate);
	});

	it("returns eventDate=0 when compact encoding is zero (unknown)", () => {
		const date = (2024 << 9) | (1 << 5) | 1;
		const buf = buildIndex(encodeEntry({ date, eventDate: 0 }));
		const [e] = codec4.readIndex(buf);
		expect(e.eventDate).toBe(0);
	});

	it("parses whiteElo and whiteEloType from bytes 29-30", () => {
		const buf = buildIndex(encodeEntry({ whiteElo: 2700, whiteEloType: 3 }));
		const [e] = codec4.readIndex(buf);
		expect(e.whiteElo).toBe(2700);
		expect(e.whiteEloType).toBe(3);
	});

	it("parses blackElo and blackEloType from bytes 31-32", () => {
		const buf = buildIndex(encodeEntry({ blackElo: 2500, blackEloType: 1 }));
		const [e] = codec4.readIndex(buf);
		expect(e.blackElo).toBe(2500);
		expect(e.blackEloType).toBe(1);
	});

	it("parses storedLineCode from high byte of bytes 33-36", () => {
		const buf = buildIndex(encodeEntry({ storedLineCode: 0xAB }));
		const [e] = codec4.readIndex(buf);
		expect(e.storedLineCode).toBe(0xAB);
	});

	it("parses finalMatSig from low 3 bytes of bytes 33-36", () => {
		const buf = buildIndex(encodeEntry({ finalMatSig: 0xABCDEF }));
		const [e] = codec4.readIndex(buf);
		expect(e.finalMatSig).toBe(0xABCDEF);
	});

	it("storedLineCode and finalMatSig are independent within the same uint32", () => {
		const buf = buildIndex(encodeEntry({ storedLineCode: 0xFF, finalMatSig: 0x123456 }));
		const [e] = codec4.readIndex(buf);
		expect(e.storedLineCode).toBe(0xFF);
		expect(e.finalMatSig).toBe(0x123456);
	});

	it("parses numHalfMoves below 256 (fits in one byte)", () => {
		const buf = buildIndex(encodeEntry({ numHalfMoves: 200 }));
		const [e] = codec4.readIndex(buf);
		expect(e.numHalfMoves).toBe(200);
	});

	it("parses numHalfMoves above 255 (needs high 2 bits in byte 38)", () => {
		const buf = buildIndex(encodeEntry({ numHalfMoves: 500 }));
		const [e] = codec4.readIndex(buf);
		expect(e.numHalfMoves).toBe(500);
	});

	it("parses numHalfMoves at max (1023)", () => {
		const buf = buildIndex(encodeEntry({ numHalfMoves: 1023 }));
		const [e] = codec4.readIndex(buf);
		expect(e.numHalfMoves).toBe(1023);
	});

	it("parses homePawnData (count in byte 38, data in bytes 39-46)", () => {
		const homePawnData = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
		const buf = buildIndex(encodeEntry({ homePawnCount: 5, homePawnData }));
		const [e] = codec4.readIndex(buf);
		expect(e.homePawnData[0]).toBe(5);  // count
		for (let i = 0; i < 8; i++) expect(e.homePawnData[i + 1]).toBe(homePawnData[i]);
	});

	it("decodes annotation counts using the 4-bit table", () => {
		const buf = buildIndex(encodeEntry({ nComments: 11, nVariations: 13, nNags: 15 }));
		const [e] = codec4.readIndex(buf);
		expect(decodeAnnotationCount(e.nComments)).toBe(15);
		expect(decodeAnnotationCount(e.nVariations)).toBe(30);
		expect(decodeAnnotationCount(e.nNags)).toBe(50);
	});

	it("chess960 is always false for SCID4", () => {
		const [e] = codec4.readIndex(buildIndex(encodeEntry()));
		expect(e.chess960).toBe(false);
	});

	it("parses multiple entries in sequence", () => {
		const buf = buildIndex(
			encodeEntry({ whiteId: 10, result: 1 }),
			encodeEntry({ whiteId: 20, result: 2 }),
		);
		const entries = codec4.readIndex(buf);
		expect(entries).toHaveLength(2);
		expect(entries[0].whiteId).toBe(10);
		expect(entries[1].whiteId).toBe(20);
	});

	it("parses a fully populated entry round-trip", () => {
		const date      = (2024 << 9) | (3 << 5) | 22;
		const eventDate = (2023 << 9) | (12 << 5) | 15;
		const buf = buildIndex(encodeEntry({
			gameOffset: 0x12345678, gameLength: 1234,
			flags: FLAG_DELETE | FLAG_CUSTOM1 | FLAG_CUSTOM6,
			whiteId: 0xFABCD, blackId: 0xEDCBA,
			eventId: 0x71234, siteId: 0x65432, roundId: 0x31234,
			nVariations: 5, nComments: 3, nNags: 2, result: 1,
			eco: 0xB20, date, eventDate,
			whiteElo: 2765, whiteEloType: 0,
			blackElo: 2732, blackEloType: 1,
			storedLineCode: 0xAB, finalMatSig: 0x123456,
			numHalfMoves: 80,
			homePawnCount: 3, homePawnData: [1, 2, 3, 4, 5, 6, 7, 8],
		}));

		const [e] = codec4.readIndex(buf);
		expect(e.gameOffset).toBe(0x12345678);
		expect(e.gameLength).toBe(1234);
		expect(e.flags & FLAG_DELETE).toBeTruthy();
		expect(e.flags & FLAG_CUSTOM1).toBeTruthy();
		expect(e.flags & FLAG_CUSTOM6).toBeTruthy();
		expect(e.deleted).toBe(true);
		expect(e.whiteId).toBe(0xFABCD);
		expect(e.blackId).toBe(0xEDCBA);
		expect(e.eventId).toBe(0x71234);
		expect(e.siteId).toBe(0x65432);
		expect(e.roundId).toBe(0x31234);
		expect(e.nVariations).toBe(5);
		expect(e.nComments).toBe(3);
		expect(e.nNags).toBe(2);
		expect(e.result).toBe(1);
		expect(e.eco).toBe(0xB20);
		expect(e.date).toBe(date);
		expect(e.eventDate).toBe(eventDate);
		expect(e.whiteElo).toBe(2765);
		expect(e.whiteEloType).toBe(0);
		expect(e.blackElo).toBe(2732);
		expect(e.blackEloType).toBe(1);
		expect(e.storedLineCode).toBe(0xAB);
		expect(e.finalMatSig).toBe(0x123456);
		expect(e.numHalfMoves).toBe(80);
		expect(e.homePawnData[0]).toBe(3);
		expect(e.chess960).toBe(false);
	});
});
