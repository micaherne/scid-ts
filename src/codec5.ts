import { IndexEntry, ScidCodec, FLAG_DELETE, encodeAnnotationCount } from "./types.js";

const RECORD_SIZE = 56; // 14 × uint32 LE + 8 bytes homePawnData

/**
 * Read a little-endian uint32 from a buffer.
 */
function readU32LE(buf: Buffer, off: number): number {
	return buf.readUInt32LE(off);
}

/**
 * SCID5 codec: reads .si5 index and .sn5 namebase files.
 */
export const codec5: ScidCodec = {
	readIndex(buf: Buffer): IndexEntry[] {
		const count = Math.floor(buf.length / RECORD_SIZE);
		const entries: IndexEntry[] = new Array(count);

		for (let i = 0; i < count; i++) {
			const base = i * RECORD_SIZE;

			const w0  = readU32LE(buf, base);       // nComments(4)    + whiteID(28)
			const w1  = readU32LE(buf, base + 4);   // nVariations(4)  + blackID(28)
			const w2  = readU32LE(buf, base + 8);   // nNags(4)        + eventID(28)
			const w3  = readU32LE(buf, base + 12);  // siteID(32)
			const w4  = readU32LE(buf, base + 16);  // chess960(1)     + roundID(31)
			const w5  = readU32LE(buf, base + 20);  // whiteElo(12)    + date(20)
			const w6  = readU32LE(buf, base + 24);  // blackElo(12)    + eventDate(20)
			const w7  = readU32LE(buf, base + 28);  // numHalfMoves(10)+ flags(22)
			const w8  = readU32LE(buf, base + 32);  // gameDataSize(17)+ offsetHigh(15)
			const w9  = readU32LE(buf, base + 36);  // offsetLow(32)
			const w10 = readU32LE(buf, base + 40);  // storedLineCode(8) + finalMatSig(24)
			const w11 = readU32LE(buf, base + 44);  // homePawnCount(8) + ratingTypes(6) + result(2) + ECO(16)

			const nComments   = (w0 >>> 28) & 0xF;
			const whiteId     = w0 & 0x0FFFFFFF;
			const nVariations = (w1 >>> 28) & 0xF;
			const blackId     = w1 & 0x0FFFFFFF;
			const nNags       = (w2 >>> 28) & 0xF;
			const eventId     = w2 & 0x0FFFFFFF;
			const siteId      = w3 >>> 0;
			const chess960    = (w4 >>> 31) === 1;
			const roundId     = w4 & 0x7FFFFFFF;
			const whiteElo    = (w5 >>> 20) & 0xFFF;
			const date        = w5 & 0xFFFFF;
			const blackElo    = (w6 >>> 20) & 0xFFF;
			const eventDate   = w6 & 0xFFFFF;
			const numHalfMoves = (w7 >>> 22) & 0x3FF;
			const flags       = w7 & 0x3FFFFF;

			// Offset: 47-bit value split across w8 (high 15 bits) and w9 (low 32 bits)
			const offsetHigh  = w8 & 0x7FFF;
			const gameOffset  = offsetHigh * 0x100000000 + (w9 >>> 0);
			const gameLength  = (w8 >>> 15) & 0x1FFFF;

			const storedLineCode = (w10 >>> 24) & 0xFF;
			const finalMatSig    = w10 & 0xFFFFFF;

			const high16       = (w11 >>> 16) & 0xFFFF;
			const homePawnCount = (high16 >>> 8) & 0xFF;
			const whiteEloType  = (high16 >>> 5) & 0x7;
			const blackEloType  = (high16 >>> 2) & 0x7;
			const result        = high16 & 0x3;
			const eco           = w11 & 0xFFFF;

			const homePawnData = new Uint8Array(9);
			homePawnData[0] = homePawnCount;
			for (let j = 0; j < 8; j++) homePawnData[j + 1] = buf[base + 48 + j];

			entries[i] = {
				whiteId, blackId, eventId, siteId, roundId,
				whiteElo, blackElo, whiteEloType, blackEloType,
				date, eventDate,
				result, eco,
				flags,
				deleted: (flags & FLAG_DELETE) !== 0,
				nComments, nVariations, nNags,
				numHalfMoves,
				chess960,
				gameOffset, gameLength,
				storedLineCode, finalMatSig, homePawnData,
			};
		}

		return entries;
	},

	readNamebase(buf: Buffer): string[][] {
		// 5 types: PLAYER(0), EVENT(1), SITE(2), ROUND(3), DB_INFO(4)
		const names: string[][] = [[], [], [], [], []];

		let pos = 0;
		while (pos < buf.length) {
			// Read LEB128 varint: value = (stringLength << 3) | nameType
			let varint = 0;
			let shift = 0;
			let byte: number;
			do {
				if (pos >= buf.length) return names;
				byte = buf[pos++];
				varint |= (byte & 0x7F) << shift;
				shift += 7;
			} while (byte & 0x80);

			const nameType = varint & 0x07;
			const strLen = varint >>> 3;

			if (pos + strLen > buf.length) break;

			const str = buf.toString("utf8", pos, pos + strLen);
			pos += strLen;

			if (nameType < names.length) {
				names[nameType].push(str);
			}
		}

		return names;
	},

	gameFileExt(): string {
		return ".sg5";
	},

	encodeIndexEntry(e: IndexEntry): Buffer {
		const buf = Buffer.alloc(56, 0);

		function writeU32LE(off: number, val: number) { buf.writeUInt32LE(val >>> 0, off); }
		function pack(a: number, aSz: number, b: number): number {
			return (((a << (32 - aSz)) >>> 0) | (b >>> 0)) >>> 0;
		}

		writeU32LE(0,  pack(encodeAnnotationCount(e.nComments),   4, e.whiteId));
		writeU32LE(4,  pack(encodeAnnotationCount(e.nVariations),  4, e.blackId));
		writeU32LE(8,  pack(encodeAnnotationCount(e.nNags),        4, e.eventId));
		writeU32LE(12, e.siteId >>> 0);
		writeU32LE(16, pack(e.chess960 ? 1 : 0,                   1, e.roundId));
		writeU32LE(20, pack(e.whiteElo,                           12, e.date));
		writeU32LE(24, pack(e.blackElo,                           12, e.eventDate));
		writeU32LE(28, pack(e.numHalfMoves,                       10, e.flags & 0x3FFFFF));

		const offsetHigh = Math.floor(e.gameOffset / 0x100000000) & 0x7FFF;
		writeU32LE(32, pack(e.gameLength,                         17, offsetHigh));
		writeU32LE(36, e.gameOffset >>> 0);

		writeU32LE(40, pack(e.storedLineCode,                      8, e.finalMatSig));

		const rtypes = ((e.whiteEloType & 0x7) << 5) | ((e.blackEloType & 0x7) << 2) | (e.result & 0x3);
		writeU32LE(44, pack((e.homePawnData[0] << 8) | rtypes,   16, e.eco));

		for (let i = 0; i < 8; i++) buf[48 + i] = e.homePawnData[i + 1] ?? 0;

		return buf;
	},

	writeIndex(entries: IndexEntry[]): Buffer {
		return Buffer.concat(entries.map(e => this.encodeIndexEntry(e)));
	},

	writeNamebase(names: string[][]): Buffer {
		// SCID5 namebase: LEB128((strLen << 3) | nameType) + utf8 string
		const parts: Buffer[] = [];
		for (let type = 0; type < 4; type++) {
			for (const name of (names[type] ?? [])) {
				let v = (name.length << 3) | type;
				const leb: number[] = [];
				do {
					let b = v & 0x7F;
					v >>>= 7;
					if (v !== 0) b |= 0x80;
					leb.push(b);
				} while (v !== 0);
				parts.push(Buffer.from(leb));
				parts.push(Buffer.from(name, "utf8"));
			}
		}
		return Buffer.concat(parts);
	},
};

