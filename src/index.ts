import * as fs from "fs";
import { codec4 } from "./codec4.js";
import { codec5 } from "./codec5.js";
import { parseGameData, parseAnnotatedGameData } from "./game.js";
import {
	ScidCodec, IndexEntry, ScidGameHeaders, ScidMove, ScidGame,
	ScidAnnotatedMove, ScidAnnotatedGame,
	NAME_PLAYER, NAME_EVENT, NAME_SITE, NAME_ROUND,
	decodeDate, decodeEco, resultToString, decodeAnnotationCount,
} from "./types.js";

export type { ScidGameHeaders, ScidMove, ScidGame, ScidAnnotatedMove, ScidAnnotatedGame } from "./types.js";
export {
	FLAG_START, FLAG_PROMOTIONS, FLAG_UNDER_PROMO, FLAG_DELETE,
	FLAG_WHITE_OP, FLAG_BLACK_OP, FLAG_MIDDLEGAME, FLAG_ENDGAME,
	FLAG_NOVELTY, FLAG_PAWN, FLAG_TACTICS, FLAG_KSIDE, FLAG_QSIDE,
	FLAG_BRILLIANCY, FLAG_BLUNDER, FLAG_USER,
	FLAG_CUSTOM1, FLAG_CUSTOM2, FLAG_CUSTOM3, FLAG_CUSTOM4, FLAG_CUSTOM5, FLAG_CUSTOM6,
	decodeAnnotationCount,
} from "./types.js";

export class ScidDatabase {
	private codec: ScidCodec | null = null;
	private names: string[][] = [];
	private entries: IndexEntry[] = [];
	private gameFilePath: string = "";

	/**
	 * Open a SCID database given the path to the index file (.si4 or .si5).
	 * Reads the index and namebase files into memory.
	 */
	open(path: string): void {
		const ext = path.substring(path.lastIndexOf(".")).toLowerCase();
		let basePath: string;

		if (ext === ".si5") {
			this.codec = codec5;
			basePath = path.substring(0, path.length - 4);
		} else if (ext === ".si4") {
			this.codec = codec4;
			basePath = path.substring(0, path.length - 4);
		} else {
			throw new Error(`Unsupported SCID file extension: ${ext}`);
		}

		const indexBuf = fs.readFileSync(path);
		this.entries = this.codec.readIndex(indexBuf);

		const nbExt = ext === ".si5" ? ".sn5" : ".sn4";
		const nbPath = basePath + nbExt;
		const nbBuf = fs.readFileSync(nbPath);
		this.names = this.codec.readNamebase(nbBuf);

		this.gameFilePath = basePath + this.codec.gameFileExt();
	}

	close(): void {
		this.codec = null;
		this.names = [];
		this.entries = [];
		this.gameFilePath = "";
	}

	getGameCount(): number {
		return this.entries.length;
	}

	getHeaders(n: number): ScidGameHeaders {
		const e = this.entries[n];
		if (!e) {
			return {
				white: "?", black: "?", event: "?", site: "?",
				round: "?", date: "????.??.??", result: "*",
				whiteElo: 0, blackElo: 0, eco: "",
				deleted: false, flags: 0,
				nComments: 0, nVariations: 0, nNags: 0,
				numHalfMoves: 0, eventDate: "????.??.??",
				chess960: false, whiteEloType: 0, blackEloType: 0,
			};
		}

		return {
			white: this.resolveName(NAME_PLAYER, e.whiteId),
			black: this.resolveName(NAME_PLAYER, e.blackId),
			event: this.resolveName(NAME_EVENT, e.eventId),
			site: this.resolveName(NAME_SITE, e.siteId),
			round: this.resolveName(NAME_ROUND, e.roundId),
			date: decodeDate(e.date),
			result: resultToString(e.result),
			whiteElo: e.whiteElo,
			blackElo: e.blackElo,
			eco: decodeEco(e.eco),
			deleted: e.deleted,
			flags: e.flags,
			nComments: decodeAnnotationCount(e.nComments),
			nVariations: decodeAnnotationCount(e.nVariations),
			nNags: decodeAnnotationCount(e.nNags),
			numHalfMoves: e.numHalfMoves,
			eventDate: decodeDate(e.eventDate),
			chess960: e.chess960,
			whiteEloType: e.whiteEloType,
			blackEloType: e.blackEloType,
		};
	}

	getMoves(n: number): ScidMove[] {
		const e = this.entries[n];
		if (!e || e.gameLength === 0) return [];

		const fd = fs.openSync(this.gameFilePath, "r");
		try {
			const buf = Buffer.alloc(e.gameLength);
			fs.readSync(fd, buf, 0, e.gameLength, e.gameOffset);
			const parsed = parseGameData(buf, 0, e.gameLength);
			return parsed.moves;
		} finally {
			fs.closeSync(fd);
		}
	}

	getGame(n: number): ScidGame {
		return {
			headers: this.getHeaders(n),
			moves: this.getMoves(n),
		};
	}

	getAnnotatedGame(n: number): ScidAnnotatedGame {
		const e = this.entries[n];
		const headers = this.getHeaders(n);
		if (!e || e.gameLength === 0) return { headers, moves: [], extraTags: [] };

		const fd = fs.openSync(this.gameFilePath, "r");
		try {
			const buf = Buffer.alloc(e.gameLength);
			fs.readSync(fd, buf, 0, e.gameLength, e.gameOffset);
			const parsed = parseAnnotatedGameData(buf, 0, e.gameLength);
			return {
				headers,
				moves: parsed.moves,
				extraTags: parsed.extraTags,
				...(parsed.startFen !== null ? { startFen: parsed.startFen } : {}),
				...(parsed.comment !== null ? { comment: parsed.comment } : {}),
			};
		} finally {
			fs.closeSync(fd);
		}
	}

	/**
	 * Search games by player name, event, site, or ECO.
	 * Returns matching game indices.
	 */
	search(query: string, offset: number, limit: number): { results: number[]; total: number } {
		const lowerQuery = query.toLowerCase();
		const matches: number[] = [];

		for (let i = 0; i < this.entries.length; i++) {
			const e = this.entries[i];
			const white = this.resolveName(NAME_PLAYER, e.whiteId);
			const black = this.resolveName(NAME_PLAYER, e.blackId);
			const event = this.resolveName(NAME_EVENT, e.eventId);
			const site = this.resolveName(NAME_SITE, e.siteId);
			const eco = decodeEco(e.eco);

			if (
				white.toLowerCase().includes(lowerQuery) ||
				black.toLowerCase().includes(lowerQuery) ||
				event.toLowerCase().includes(lowerQuery) ||
				site.toLowerCase().includes(lowerQuery) ||
				eco.toLowerCase().includes(lowerQuery)
			) {
				matches.push(i);
			}
		}

		return {
			results: matches.slice(offset, offset + limit),
			total: matches.length,
		};
	}

	private resolveName(type: number, id: number): string {
		const typeNames = this.names[type];
		if (!typeNames || id >= typeNames.length) return "?";
		return typeNames[id] || "?";
	}
}
