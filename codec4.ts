import { IndexEntry, ScidCodec, NAME_PLAYER, NAME_EVENT, NAME_SITE, NAME_ROUND } from "./types";

const HEADER_SIZE = 182;
const RECORD_SIZE = 47;

/**
 * SCID4 codec: reads .si4 index and .sn4 namebase files.
 * All multi-byte integers are big-endian.
 */
export const codec4: ScidCodec = {
	readIndex(buf: Buffer): IndexEntry[] {
		if (buf.length < HEADER_SIZE) return [];

		// Header: 8 bytes magic, 2 bytes version, 3 bytes base type,
		// 3 bytes numGames, 4 bytes autoLoad, 162 bytes description
		const numGames =
			(buf[13] << 16) | (buf[14] << 8) | buf[15];

		const dataStart = HEADER_SIZE;
		const available = Math.floor((buf.length - dataStart) / RECORD_SIZE);
		const count = Math.min(numGames, available);
		const entries: IndexEntry[] = new Array(count);

		for (let i = 0; i < count; i++) {
			const base = dataStart + i * RECORD_SIZE;

			// Bytes 0-3: gameOffset (32-bit BE)
			const gameOffset = buf.readUInt32BE(base);

			// Bytes 4-6: gameLength(17) + customFlags(6) + spare(1)
			const b4 = buf[base + 4];
			const b5 = buf[base + 5];
			const b6 = buf[base + 6];
			const gameLength = (b4 << 9) | (b5 << 1) | (b6 >> 7);

			// Bytes 7-8: flags (16 bits) — skip for now
			// const flags = (buf[base + 7] << 8) | buf[base + 8];

			// Bytes 9-13: name IDs
			const b9 = buf[base + 9];
			const whiteIdHigh = (b9 >> 4) & 0x0F;
			const blackIdHigh = b9 & 0x0F;
			const whiteIdLow = (buf[base + 10] << 8) | buf[base + 11];
			const blackIdLow = (buf[base + 12] << 8) | buf[base + 13];
			const whiteId = (whiteIdHigh << 16) | whiteIdLow;
			const blackId = (blackIdHigh << 16) | blackIdLow;

			const b14 = buf[base + 14];
			const eventIdHigh = (b14 >> 5) & 0x07;
			const siteIdHigh = (b14 >> 2) & 0x07;
			const roundIdHigh = b14 & 0x03;
			const eventIdLow = (buf[base + 15] << 8) | buf[base + 16];
			const siteIdLow = (buf[base + 17] << 8) | buf[base + 18];
			const roundIdLow = (buf[base + 19] << 8) | buf[base + 20];
			const eventId = (eventIdHigh << 16) | eventIdLow;
			const siteId = (siteIdHigh << 16) | siteIdLow;
			const roundId = (roundIdHigh << 16) | roundIdLow;

			// Byte 22: nagCount(4) + result(4)
			const b22 = buf[base + 22];
			const result = b22 & 0x0F;

			// Bytes 23-24: ECO code (16 bits)
			const eco = (buf[base + 23] << 8) | buf[base + 24];

			// Bytes 25-27: date (20 bits) + eventDate high (4 bits)
			const b25 = buf[base + 25];
			const b26 = buf[base + 26];
			const b27 = buf[base + 27];
			const date = (b25 << 12) | (b26 << 4) | (b27 >> 4);

			// Bytes 29-30: whiteElo(12) + whiteEloType(4)
			const whiteElo = (buf[base + 29] << 4) | (buf[base + 30] >> 4);

			// Bytes 31-32: blackElo(12) + blackEloType(4)
			const blackElo = (buf[base + 31] << 4) | (buf[base + 32] >> 4);

			entries[i] = {
				whiteId, blackId, eventId, siteId, roundId,
				whiteElo, blackElo, date, result, eco,
				gameOffset, gameLength,
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
};
