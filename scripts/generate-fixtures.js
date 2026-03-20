#!/usr/bin/env node
/**
 * Generates minimal valid SCID4 and SCID5 fixture databases for integration tests.
 *
 * Encodes a single game: Fool's Mate
 *   1. f3 e5  2. g4 Qh4#  (result: 0-1)
 *
 * Run with: node scripts/generate-fixtures.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
fs.mkdirSync(FIXTURES_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Game move stream (identical format for .sg4 and .sg5)
// ---------------------------------------------------------------------------
// Standard start position piece list indices (white):
//   0=K@e1, 1=R@a1, 2=N@b1, 3=B@c1, 4=Q@d1, 5=B@f1, 6=N@g1, 7=R@h1,
//   8=P@a2, 9=P@b2, 10=P@c2, 11=P@d2, 12=P@e2, 13=P@f2, 14=P@g2, 15=P@h2
// Standard start position piece list indices (black):
//   0=K@e8, 1=R@a8, 2=N@b8, 3=B@c8, 4=Q@d8, 5=B@f8, 6=N@g8, 7=R@h8,
//   8=P@a7..15=P@h7, so 12=P@e7
//
// Encoding: byte = (listIndex << 4) | code
//
// 1. f3:    white pawn f2 = listIdx 13, code 1 (forward) → 0xD1
// 1...e5:   black pawn e7 = listIdx 12, code 15 (double push) → 0xCF
// 2. g4:    white pawn g2 = listIdx 14, code 15 (double push) → 0xEF
// 2...Qh4:  black queen d8 = listIdx 4, diagonal move
//           Queen diagonal: code = fromFile (3), second byte = dest+64
//           dest h4 = rank3*8+file7 = 31, second byte = 31+64 = 95 = 0x5F
//           byte = (4<<4)|3 = 0x43, extra byte = 0x5F
// End game: 0x0F

const GAME_DATA = Buffer.from([
	0x00, // end of extra tags
	0x00, // standard start position (flagByte bit0 = 0)
	0xD1, // 1. f3
	0xCF, // 1... e5
	0xEF, // 2. g4
	0x43, // 2... Qh4 (byte 1)
	0x5F, // 2... Qh4 (byte 2: dest+64 = 31+64 = 95)
	0x0F, // end game
]);

const GAME_LENGTH = GAME_DATA.length; // 8

// date encoding: (year << 9) | (month << 5) | day
const DATE = (2024 << 9) | (1 << 5) | 1; // 2024.01.01 = 1036321

// ---------------------------------------------------------------------------
// SCID5
// ---------------------------------------------------------------------------

function makeSn5() {
	// Each entry: LEB128((strLen << 3) | nameType) + utf8 string
	// nameType: 0=player, 1=event, 2=site, 3=round
	const entries = [
		{ type: 0, name: "White" }, // player 0
		{ type: 0, name: "Black" }, // player 1
		{ type: 1, name: "Test" },  // event 0
		{ type: 2, name: "Test" },  // site 0
		{ type: 3, name: "1" },     // round 0
	];

	const parts = [];
	for (const { type, name } of entries) {
		let v = (name.length << 3) | type;
		const leb = [];
		do {
			let b = v & 0x7f;
			v >>>= 7;
			if (v !== 0) b |= 0x80;
			leb.push(b);
		} while (v !== 0);
		parts.push(Buffer.from(leb));
		parts.push(Buffer.from(name, "utf8"));
	}
	return Buffer.concat(parts);
}

function makeSi5() {
	// 56 bytes: 14 × uint32 LE
	// w0:  nComments(4) | whiteID(28)   → whiteID=0
	// w1:  nVariations(4) | blackID(28) → blackID=1
	// w2:  nNags(4) | eventID(28)       → eventID=0
	// w3:  siteID(32)                   → 0
	// w4:  chess960(1) | roundID(31)    → roundID=0
	// w5:  whiteElo(12) | date(20)      → date=DATE
	// w6:  blackElo(12) | eventDate(20) → 0
	// w7:  numHalfMoves(10) | flags(22) → 4 half-moves
	// w8:  gameDataSize(17) | offsetHigh(15) → size=GAME_LENGTH, high=0
	// w9:  offsetLow(32)                → 0
	// w10: storedLineCode(8) | finalMatSig(24) → 0
	// w11: homePawnCount(8) | ratingTypes(6) | result(2) | ECO(16)
	//      result=2 (RESULT_BLACK=0-1) at bits 17:16
	// w12-13: 0
	const buf = Buffer.alloc(56);
	buf.writeUInt32LE(0, 0);                          // w0: whiteID=0
	buf.writeUInt32LE(1, 4);                          // w1: blackID=1
	buf.writeUInt32LE(0, 8);                          // w2: eventID=0
	buf.writeUInt32LE(0, 12);                         // w3: siteID=0
	buf.writeUInt32LE(0, 16);                         // w4: roundID=0
	buf.writeUInt32LE(DATE, 20);                      // w5: date
	buf.writeUInt32LE(0, 24);                         // w6
	buf.writeUInt32LE(4 * (1 << 22), 28);             // w7: 4 half-moves
	buf.writeUInt32LE((GAME_LENGTH << 15) >>> 0, 32); // w8: gameDataSize
	buf.writeUInt32LE(0, 36);                         // w9: offsetLow=0
	buf.writeUInt32LE(0, 40);                         // w10
	buf.writeUInt32LE(2 << 16, 44);                   // w11: result=2 (black wins)
	buf.writeUInt32LE(0, 48);                         // w12
	buf.writeUInt32LE(0, 52);                         // w13
	return buf;
}

fs.writeFileSync(path.join(FIXTURES_DIR, "test.si5"), makeSi5());
fs.writeFileSync(path.join(FIXTURES_DIR, "test.sn5"), makeSn5());
fs.writeFileSync(path.join(FIXTURES_DIR, "test.sg5"), GAME_DATA);

// ---------------------------------------------------------------------------
// SCID4
// ---------------------------------------------------------------------------

function makeSn4() {
	// Header: 36 bytes
	//   [0-7]:   magic (zeros)
	//   [8-11]:  timestamp (zeros)
	//   [12-14]: player count = 2
	//   [15-17]: event count = 1
	//   [18-20]: site count = 1
	//   [21-23]: round count = 1
	//   [24-35]: max frequency per type (3 bytes each, value=1)
	const header = Buffer.alloc(36);
	header[14] = 2; // player count
	header[17] = 1; // event count
	header[20] = 1; // site count
	header[23] = 1; // round count
	for (let t = 0; t < 4; t++) header[26 + t * 3] = 1; // maxFreq=1

	// Entries: idSize=2 (count<=65535), freqSize=1 (maxFreq<=255)
	// Each entry: id(2 bytes BE), freq(1 byte), nameLen(1), prefix(1), suffix(...)
	function entry(id, name) {
		return Buffer.concat([
			Buffer.from([(id >> 8) & 0xff, id & 0xff]), // id
			Buffer.from([1]),                             // freq
			Buffer.from([name.length]),                   // nameLen
			Buffer.from([0]),                             // prefix (no compression)
			Buffer.from(name, "latin1"),                  // suffix
		]);
	}

	return Buffer.concat([
		header,
		entry(0, "White"), // player 0
		entry(1, "Black"), // player 1
		entry(0, "Test"),  // event 0
		entry(0, "Test"),  // site 0
		entry(0, "1"),     // round 0
	]);
}

function makeSi4() {
	// Header: 182 bytes
	//   [13-15]: numGames = 1
	const header = Buffer.alloc(182);
	header[15] = 1; // numGames = 1

	// Record: 47 bytes (big-endian)
	const record = Buffer.alloc(47);

	// Bytes 0-3: gameOffset = 0
	record.writeUInt32BE(0, 0);

	// Bytes 4-6: gameLength(17 bits) packed as (b4<<9)|(b5<<1)|(b6>>7)
	const gl = GAME_LENGTH;
	record[4] = (gl >> 9) & 0xff;
	record[5] = (gl >> 1) & 0xff;
	record[6] = (gl & 1) << 7;

	// Bytes 12-13: blackIdLow = 1 (black player ID)
	record[12] = 0;
	record[13] = 1;

	// Byte 22: result in lower nibble. RESULT_BLACK = 2.
	record[22] = 2;

	// Bytes 25-27: date(20 bits) packed as (b25<<12)|(b26<<4)|(b27>>4)
	record[25] = (DATE >> 12) & 0xff;
	record[26] = (DATE >> 4) & 0xff;
	record[27] = (DATE & 0xf) << 4;

	return Buffer.concat([header, record]);
}

fs.writeFileSync(path.join(FIXTURES_DIR, "test.si4"), makeSi4());
fs.writeFileSync(path.join(FIXTURES_DIR, "test.sn4"), makeSn4());
fs.writeFileSync(path.join(FIXTURES_DIR, "test.sg4"), GAME_DATA);

console.log("Fixtures written to", FIXTURES_DIR);
console.log("  test.si4/sn4/sg4 — SCID4 format");
console.log("  test.si5/sn5/sg5 — SCID5 format");
console.log("Game: Fool's Mate (1.f3 e5 2.g4 Qh4#), result 0-1, date 2024.01.01");
