#!/usr/bin/env node
/**
 * Generates minimal valid SCID4 and SCID5 fixture databases for integration tests.
 *
 * Game 1 (test.*): Fool's Mate — no annotations
 *   1. f3 e5  2. g4 Qh4#  (result: 0-1)
 *
 * Game 2 (annotated.*): Fool's Mate with all annotation types (SCID5 only)
 *   {Game comment} 1. f3?! {A bad move} e5  2. g4 ({Interesting try} 2. e4 {Better}) Qh4#
 *   Tests: game-level comment, NAG, commentAfter, commentBefore in variation, commentAfter in variation
 *
 * Run with: node scripts/generate-fixtures.cjs
 */

"use strict";

const fs = require("fs");
const path = require("path");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
fs.mkdirSync(FIXTURES_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Move stream encoding helpers
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
//
// For the variation 2. e4: board is reset to before 2.g4 (after 1.f3 e5),
//   white to move, Pe2 still at list index 12, double push code 15 → 0xCF

// date encoding: (year << 9) | (month << 5) | day
const DATE = (2024 << 9) | (1 << 5) | 1; // 2024.01.01

// ---------------------------------------------------------------------------
// Game 1: Fool's Mate, no annotations
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Game 2: Fool's Mate with all annotation types (SCID5 only)
//   {Game comment} 1. f3?! {A bad move} e5  2. g4 ({Interesting try} 2. e4 {Better}) Qh4#
// ---------------------------------------------------------------------------
// Comment encoding: ENCODE_COMMENT markers (0x0C) appear in the move stream
// at the point where the comment belongs. The actual strings are stored as
// null-terminated sequences after the END_GAME (0x0F) byte, in stream order.
//
// NAG encoding: ENCODE_NAG (0x0B) followed by the NAG value byte.
//   NAG 6 = "?!" (dubious move)
//
// Move stream:
//   0x0C               — ENCODE_COMMENT (comment 1: "Game comment", pre-game)
//   0xD1               — 1. f3
//   0x0B, 0x06         — ENCODE_NAG, value=6 (?!)
//   0x0C               — ENCODE_COMMENT (comment 2: "A bad move", after f3)
//   0xCF               — 1... e5
//   0xEF               — 2. g4
//   0x0D               — START_VARIATION
//   0x0C               — ENCODE_COMMENT (comment 3: "Interesting try", before 2.e4)
//   0xCF               — 2. e4 (Pe2, list idx 12, double push; board before 2.g4)
//   0x0C               — ENCODE_COMMENT (comment 4: "Better", after e4)
//   0x0E               — END_VARIATION
//   0x43, 0x5F         — 2... Qh4
//   0x0F               — END_GAME
// Then null-terminated comment strings in stream order.

const ANNOTATED_GAME_DATA = Buffer.concat([
	Buffer.from([
		0x00,       // end of extra tags
		0x00,       // standard start position
		0x0C,       // ENCODE_COMMENT (pre-game: "Game comment")
		0xD1,       // 1. f3
		0x0B, 0x06, // ENCODE_NAG, value=6 (?!)
		0x0C,       // ENCODE_COMMENT (after f3: "A bad move")
		0xCF,       // 1... e5
		0xEF,       // 2. g4
		0x0D,       // START_VARIATION
		0x0C,       // ENCODE_COMMENT (before 2.e4: "Interesting try")
		0xCF,       // 2. e4
		0x0C,       // ENCODE_COMMENT (after e4: "Better")
		0x0E,       // END_VARIATION
		0x43, 0x5F, // 2... Qh4
		0x0F,       // END_GAME
	]),
	Buffer.from("Game comment\0", "utf8"),
	Buffer.from("A bad move\0", "utf8"),
	Buffer.from("Interesting try\0", "utf8"),
	Buffer.from("Better\0", "utf8"),
]);

// ---------------------------------------------------------------------------
// SCID5 namebase (shared between both fixtures — same players/event/site)
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

function makeSi5(gameData, offset) {
	// 56 bytes: 14 × uint32 LE
	const buf = Buffer.alloc(56);
	buf.writeUInt32LE(0, 0);                                // w0: whiteID=0
	buf.writeUInt32LE(1, 4);                                // w1: blackID=1
	buf.writeUInt32LE(0, 8);                                // w2: eventID=0
	buf.writeUInt32LE(0, 12);                               // w3: siteID=0
	buf.writeUInt32LE(0, 16);                               // w4: roundID=0
	buf.writeUInt32LE(DATE, 20);                            // w5: date
	buf.writeUInt32LE(0, 24);                               // w6
	buf.writeUInt32LE(4 * (1 << 22), 28);                   // w7: 4 half-moves
	buf.writeUInt32LE((gameData.length << 15) >>> 0, 32);   // w8: gameDataSize
	buf.writeUInt32LE(offset >>> 0, 36);                    // w9: offsetLow
	buf.writeUInt32LE(0, 40);                               // w10
	buf.writeUInt32LE(2 << 16, 44);                         // w11: result=2 (black wins)
	buf.writeUInt32LE(0, 48);                               // w12
	buf.writeUInt32LE(0, 52);                               // w13
	return buf;
}

const sn5 = makeSn5();
fs.writeFileSync(path.join(FIXTURES_DIR, "test.si5"), makeSi5(GAME_DATA, 0));
fs.writeFileSync(path.join(FIXTURES_DIR, "test.sn5"), sn5);
fs.writeFileSync(path.join(FIXTURES_DIR, "test.sg5"), GAME_DATA);

fs.writeFileSync(path.join(FIXTURES_DIR, "annotated.si5"), makeSi5(ANNOTATED_GAME_DATA, 0));
fs.writeFileSync(path.join(FIXTURES_DIR, "annotated.sn5"), sn5);
fs.writeFileSync(path.join(FIXTURES_DIR, "annotated.sg5"), ANNOTATED_GAME_DATA);

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

/**
 * Build a SCID4 index buffer: 182-byte header + one 47-byte record.
 *
 * @param {Buffer} gameData - game bytes (used for gameLength)
 * @param {object} opts
 * @param {number}  opts.gameOffset  - byte offset of game in .sg4 file
 * @param {number}  opts.blackId     - black player name ID
 * @param {number}  opts.result      - result (0=none,1=white,2=black,3=draw)
 * @param {number}  opts.nNags       - raw 4-bit coded NAG count
 * @param {number}  opts.nComments   - raw 4-bit coded comment count
 * @param {number}  opts.nVariations - raw 4-bit coded variation count
 * @param {number}  opts.numHalfMoves
 */
function makeSi4Record(gameData, opts) {
	const {
		gameOffset = 0,
		blackId = 1,
		result = 2,
		nNags = 0,
		nComments = 0,
		nVariations = 0,
		numHalfMoves = 4,
	} = opts || {};

	const record = Buffer.alloc(47);

	// Bytes 0-3: gameOffset
	record.writeUInt32BE(gameOffset >>> 0, 0);

	// Bytes 4-5: gameLength low 16 bits; byte 6 bit7 = gameLength bit16
	const gl = gameData.length;
	record[4] = (gl >> 8) & 0xff;
	record[5] = gl & 0xff;
	record[6] = (gl >= 0x10000) ? 0x80 : 0x00;

	// Byte 9 high nibble = whiteId bits19:16 (0), low nibble = blackId bits19:16 (0)
	// Bytes 10-11: whiteId low 16 = 0; bytes 12-13: blackId low 16
	record[12] = (blackId >> 8) & 0xff;
	record[13] = blackId & 0xff;

	// Bytes 21-22: varCounts uint16 BE
	// bits15:12=result, bits11:8=nNags, bits7:4=nComments, bits3:0=nVariations
	const varCounts = ((result & 0xf) << 12) | ((nNags & 0xf) << 8) | ((nComments & 0xf) << 4) | (nVariations & 0xf);
	record[21] = (varCounts >> 8) & 0xff;
	record[22] = varCounts & 0xff;

	// Bytes 25-28: uint32 BE: bits31:20=compactEventDate(0), bits19:0=date
	record.writeUInt32BE(DATE & 0xfffff, 25);

	// Byte 37: numHalfMoves low 8; byte 38: bits7:6=numHalfMoves bits9:8, bits5:0=homePawnCount(0)
	record[37] = numHalfMoves & 0xff;
	record[38] = ((numHalfMoves >> 8) & 0x3) << 6;

	return record;
}

function makeSi4(gameData, opts) {
	const header = Buffer.alloc(182);
	header[16] = 1; // numGames = 1
	return Buffer.concat([header, makeSi4Record(gameData, opts)]);
}

const sn4 = makeSn4();

fs.writeFileSync(path.join(FIXTURES_DIR, "test.si4"), makeSi4(GAME_DATA, { result: 2, numHalfMoves: 4 }));
fs.writeFileSync(path.join(FIXTURES_DIR, "test.sn4"), sn4);
fs.writeFileSync(path.join(FIXTURES_DIR, "test.sg4"), GAME_DATA);

// annotated.si4/sn4/sg4 — same game data as annotated.si5 (game format is identical)
// nComments=4 (game comment + after f3 + before e4 variation + after e4)
// nVariations=1, nNags=1
fs.writeFileSync(path.join(FIXTURES_DIR, "annotated.si4"), makeSi4(ANNOTATED_GAME_DATA, {
	result: 2, numHalfMoves: 4, nComments: 4, nVariations: 1, nNags: 1,
}));
fs.writeFileSync(path.join(FIXTURES_DIR, "annotated.sn4"), sn4);
fs.writeFileSync(path.join(FIXTURES_DIR, "annotated.sg4"), ANNOTATED_GAME_DATA);

console.log("Fixtures written to", FIXTURES_DIR);
console.log("  test.si4/sn4/sg4         — SCID4, Fool's Mate, no annotations");
console.log("  annotated.si4/sn4/sg4    — SCID4, Fool's Mate with comment and variation");
console.log("  test.si5/sn5/sg5         — SCID5, Fool's Mate, no annotations");
console.log("  annotated.si5/sn5/sg5    — SCID5, Fool's Mate with comment and variation");
