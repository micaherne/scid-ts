import { IndexEntry, ScidCodec, FLAG_DELETE, encodeAnnotationCount } from "./types.js";

const HEADER_SIZE = 182;
const RECORD_SIZE = 47;

/**
 * Decode the compact 12-bit eventDate relative to the game date.
 * compact bits: 11:9 = eyear_rel (0=unknown, else offset by -4 from game year),
 *               8:5  = month, 4:0 = day.
 * Returns absolute 20-bit date value, or 0 if unknown.
 */
function decodeCompactEventDate(compact: number, date: number): number {
	if (!compact) return 0;
	const eyearRel = (compact >> 9) & 0x7;
	const month    = (compact >> 5) & 0xF;
	const day      = compact & 0x1F;
	const dyear    = date >> 9;
	const eyear    = dyear + eyearRel - 4;
	return (eyear << 9) | (month << 5) | day;
}

/**
 * Encode an absolute eventDate into the 12-bit compact form relative to date.
 * Returns 0 if unknown or too far away.
 */
function encodeCompactEventDate4(eventDate: number, date: number): number {
	if (!eventDate) return 0;
	const eyear = eventDate >> 9;
	const dyear  = date >> 9;
	if (eyear < dyear - 3 || eyear > dyear + 3) return 0;
	const eyearRel = (eyear - dyear + 4) & 7;
	const month = (eventDate >> 5) & 0xF;
	const day   = eventDate & 0x1F;
	return (eyearRel << 9) | (month << 5) | day;
}

/**
 * SCID4 codec: reads .si4 index and .sn4 namebase files.
 * All multi-byte integers are big-endian.
 * Layout derived from codec_scid4.cpp in the SCID source.
 */
export const codec4: ScidCodec = {
	readIndex(buf: Buffer): IndexEntry[] {
		if (buf.length < HEADER_SIZE) return [];

		// Header: 8 magic, 2 version, 4 baseType, 3 numGames, 3 autoLoad, 162 description
		const numGames = (buf[14] << 16) | (buf[15] << 8) | buf[16];

		const dataStart = HEADER_SIZE;
		const available = Math.floor((buf.length - dataStart) / RECORD_SIZE);
		const count = Math.min(numGames, available);
		const entries: IndexEntry[] = new Array(count);

		for (let i = 0; i < count; i++) {
			const base = dataStart + i * RECORD_SIZE;

			// Bytes 0-3: gameOffset (32-bit BE)
			const gameOffset = buf.readUInt32BE(base);

			// Bytes 4-5: gameLength low 16 bits (uint16 BE)
			const gameLenLow = (buf[base + 4] << 8) | buf[base + 5];

			// Byte 6: bit7 = gameLength bit16; bits5:0 = customFlags (flags bits 21:16)
			const b6 = buf[base + 6];
			const gameLength  = ((b6 & 0x80) ? 0x10000 : 0) | gameLenLow;
			const customFlags = b6 & 0x3F;

			// Bytes 7-8: flags16 (bits 15:0 of combined 22-bit flags, BE)
			const flags16 = (buf[base + 7] << 8) | buf[base + 8];
			const flags   = (customFlags << 16) | flags16;

			// Bytes 9-13: whiteId and blackId (20-bit each)
			const b9 = buf[base + 9];
			const whiteId = (((b9 >> 4) & 0xF) << 16) | (buf[base + 10] << 8) | buf[base + 11];
			const blackId = ((b9 & 0xF) << 16)         | (buf[base + 12] << 8) | buf[base + 13];

			// Bytes 14-20: eventId(19-bit), siteId(19-bit), roundId(18-bit)
			const b14 = buf[base + 14];
			const eventId = (((b14 >> 5) & 0x7) << 16) | (buf[base + 15] << 8) | buf[base + 16];
			const siteId  = (((b14 >> 2) & 0x7) << 16) | (buf[base + 17] << 8) | buf[base + 18];
			const roundId = ((b14 & 0x3) << 16)         | (buf[base + 19] << 8) | buf[base + 20];

			// Bytes 21-22: varCounts uint16 BE: bits15:12=result, 11:8=nNags, 7:4=nComments, 3:0=nVariations
			const varCounts  = (buf[base + 21] << 8) | buf[base + 22];
			const result     = (varCounts >> 12) & 0xF;
			const nNags      = (varCounts >>  8) & 0xF;
			const nComments  = (varCounts >>  4) & 0xF;
			const nVariations = varCounts & 0xF;

			// Bytes 23-24: ECO code (16-bit BE)
			const eco = (buf[base + 23] << 8) | buf[base + 24];

			// Bytes 25-28: uint32 BE — bits31:20 = compact eventDate (12 bits), bits19:0 = date (20 bits)
			const dw = buf.readUInt32BE(base + 25);
			const date    = dw & 0xFFFFF;
			const compact = (dw >>> 20) & 0xFFF;
			const eventDate = decodeCompactEventDate(compact, date);

			// Bytes 29-30: (whiteEloType << 12) | whiteElo  [uint16 BE]
			const ew = (buf[base + 29] << 8) | buf[base + 30];
			const whiteEloType = (ew >> 12) & 0xF;
			const whiteElo     = ew & 0xFFF;

			// Bytes 31-32: (blackEloType << 12) | blackElo  [uint16 BE]
			const bw = (buf[base + 31] << 8) | buf[base + 32];
			const blackEloType = (bw >> 12) & 0xF;
			const blackElo     = bw & 0xFFF;

			// Bytes 33-36: uint32 BE — bits31:24 = storedLineCode, bits23:0 = finalMatSig
			const lw = buf.readUInt32BE(base + 33);
			const storedLineCode = (lw >>> 24) & 0xFF;
			const finalMatSig    = lw & 0xFFFFFF;

			// Byte 37: numHalfMoves low 8 bits
			// Byte 38: bits7:6 = numHalfMoves bits9:8; bits5:0 = homePawnCount
			const numHalfMoves = ((buf[base + 38] >> 6) << 8) | buf[base + 37];
			const homePawnCount = buf[base + 38] & 0x3F;

			// Bytes 39-46: 8 homePawnData bytes; store as 9-byte array [count, ...data]
			const homePawnData = new Uint8Array(9);
			homePawnData[0] = homePawnCount;
			for (let j = 0; j < 8; j++) homePawnData[j + 1] = buf[base + 39 + j];

			entries[i] = {
				whiteId, blackId, eventId, siteId, roundId,
				whiteElo, blackElo, whiteEloType, blackEloType,
				date, eventDate,
				result, eco,
				flags,
				deleted: (flags & FLAG_DELETE) !== 0,
				nComments, nVariations, nNags,
				numHalfMoves,
				chess960: false,
				gameOffset, gameLength,
				storedLineCode, finalMatSig, homePawnData,
			};
		}

		return entries;
	},

	readNamebase(buf: Buffer): string[][] {
		// 5 types: player, event, site, round (+ spare)
		const names: string[][] = [[], [], [], [], []];

		if (buf.length < 12) return names;

		// Header: bytes 0-7 magic, bytes 8-11 timestamp
		// Bytes 12-14: player count, 15-17: event count, 18-20: site count, 21-23: round count
		const counts = [
			(buf[12] << 16) | (buf[13] << 8) | buf[14],  // players
			(buf[15] << 16) | (buf[16] << 8) | buf[17],  // events
			(buf[18] << 16) | (buf[19] << 8) | buf[20],  // sites
			(buf[21] << 16) | (buf[22] << 8) | buf[23],  // rounds
		];

		// Bytes 24-35: max frequency for each type (3 bytes each)
		const maxFreq: number[] = [];
		for (let t = 0; t < 4; t++) {
			const off = 24 + t * 3;
			maxFreq.push((buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2]);
		}

		let pos = 36;

		for (let type = 0; type < 4; type++) {
			const count = counts[type];
			let prevName = "";
			const idSize = count > 65535 ? 3 : 2;
			const freqSize = maxFreq[type] > 65535 ? 3 : maxFreq[type] > 255 ? 2 : 1;

			// Allocate array for this type, indexed by ID
			const nameArr: string[] = new Array(count).fill("");

			for (let i = 0; i < count; i++) {
				if (pos + idSize + freqSize + 2 > buf.length) break;

				// Read ID
				let id: number;
				if (idSize === 3) {
					id = (buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2];
				} else {
					id = (buf[pos] << 8) | buf[pos + 1];
				}
				pos += idSize;

				// Read frequency (skip)
				pos += freqSize;

				// Read length and prefix
				const nameLen = buf[pos++];
				const prefix = buf[pos++];

				// Read suffix
				const suffixLen = nameLen - prefix;
				if (pos + suffixLen > buf.length) break;
				const suffix = buf.toString("latin1", pos, pos + suffixLen);
				pos += suffixLen;

				// Reconstruct full name
				const name = prevName.substring(0, prefix) + suffix;
				prevName = name;

				if (id < count) {
					nameArr[id] = name;
				}
			}

			names[type] = nameArr;
		}

		return names;
	},

	gameFileExt(): string {
		return ".sg4";
	},

	encodeIndexEntry(e: IndexEntry): Buffer {
		const buf = Buffer.alloc(47, 0);

		function writeU16BE(off: number, v: number) {
			buf[off] = (v >> 8) & 0xFF; buf[off + 1] = v & 0xFF;
		}
		function writeU32BE(off: number, v: number) {
			buf[off] = (v >>> 24) & 0xFF; buf[off + 1] = (v >>> 16) & 0xFF;
			buf[off + 2] = (v >>> 8) & 0xFF; buf[off + 3] = v & 0xFF;
		}

		writeU32BE(0, e.gameOffset >>> 0);

		const gl = e.gameLength;
		writeU16BE(4, gl & 0xFFFF);
		buf[6] = ((gl >= 0x10000) ? 0x80 : 0x00) | ((e.flags >>> 16) & 0x3F);
		writeU16BE(7, e.flags & 0xFFFF);

		buf[9] = (((e.whiteId >>> 16) & 0xF) << 4) | ((e.blackId >>> 16) & 0xF);
		writeU16BE(10, e.whiteId & 0xFFFF);
		writeU16BE(12, e.blackId & 0xFFFF);

		buf[14] = (((e.eventId >>> 16) & 0x7) << 5) | (((e.siteId >>> 16) & 0x7) << 2) | ((e.roundId >>> 16) & 0x3);
		writeU16BE(15, e.eventId & 0xFFFF);
		writeU16BE(17, e.siteId  & 0xFFFF);
		writeU16BE(19, e.roundId & 0xFFFF);

		const varCounts = ((e.result & 0xF) << 12) | ((encodeAnnotationCount(e.nNags) & 0xF) << 8)
		                | ((encodeAnnotationCount(e.nComments) & 0xF) << 4) | (encodeAnnotationCount(e.nVariations) & 0xF);
		writeU16BE(21, varCounts);

		writeU16BE(23, e.eco & 0xFFFF);

		// Compact eventDate relative to date
		const compact = encodeCompactEventDate4(e.eventDate, e.date);
		writeU32BE(25, ((compact & 0xFFF) << 20) | (e.date & 0xFFFFF));

		writeU16BE(29, ((e.whiteEloType & 0xF) << 12) | (e.whiteElo & 0xFFF));
		writeU16BE(31, ((e.blackEloType & 0xF) << 12) | (e.blackElo & 0xFFF));

		writeU32BE(33, ((e.storedLineCode & 0xFF) << 24) | (e.finalMatSig & 0xFFFFFF));

		buf[37] = e.numHalfMoves & 0xFF;
		buf[38] = (((e.numHalfMoves >>> 8) & 0x3) << 6) | (e.homePawnData[0] & 0x3F);

		for (let i = 0; i < 8; i++) buf[39 + i] = e.homePawnData[i + 1] ?? 0;

		return buf;
	},

	writeIndex(entries: IndexEntry[]): Buffer {
		const header = Buffer.alloc(182, 0);
		Buffer.from("Scid.si\x1a").copy(header, 0);
		header.writeUInt16BE(400, 8);  // version
		const n = entries.length;
		header[14] = (n >> 16) & 0xFF;
		header[15] = (n >> 8) & 0xFF;
		header[16] = n & 0xFF;
		return Buffer.concat([header, ...entries.map(e => this.encodeIndexEntry(e))]);
	},

	writeNamebase(names: string[][]): Buffer {
		// SCID4 namebase: 36-byte header + front-coded entries per type
		const counts   = [0, 1, 2, 3].map(t => (names[t] ?? []).length);
		const maxFreqs = [1, 1, 1, 1]; // we track no frequencies; use 1

		const header = Buffer.alloc(36, 0);
		for (let t = 0; t < 4; t++) {
			const off = 12 + t * 3;
			header[off]     = (counts[t] >> 16) & 0xFF;
			header[off + 1] = (counts[t] >> 8)  & 0xFF;
			header[off + 2] = counts[t] & 0xFF;
		}
		for (let t = 0; t < 4; t++) {
			const off = 24 + t * 3;
			header[off + 2] = maxFreqs[t] & 0xFF; // maxFreq = 1, fits in 1 byte
		}

		const parts: Buffer[] = [header];
		for (let type = 0; type < 4; type++) {
			const typeNames = names[type] ?? [];
			const count  = typeNames.length;
			const idSize = count > 65535 ? 3 : 2;
			let prevName = "";

			for (let i = 0; i < count; i++) {
				const name = typeNames[i];

				// ID bytes
				if (idSize === 3) {
					parts.push(Buffer.from([(i >> 16) & 0xFF, (i >> 8) & 0xFF, i & 0xFF]));
				} else {
					parts.push(Buffer.from([(i >> 8) & 0xFF, i & 0xFF]));
				}
				parts.push(Buffer.from([1])); // frequency (1 byte, value 1)

				// Prefix compression
				let prefix = 0;
				while (prefix < prevName.length && prefix < name.length && prevName[prefix] === name[prefix]) {
					prefix++;
				}
				const suffix = name.substring(prefix);
				parts.push(Buffer.from([name.length, prefix]));
				parts.push(Buffer.from(suffix, "latin1"));

				prevName = name;
			}
		}
		return Buffer.concat(parts);
	},
};
