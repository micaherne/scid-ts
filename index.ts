import * as fs from "fs";
import { codec4 } from "./codec4";
import { codec5 } from "./codec5";
import { parseGameData } from "./game";
import {
	ScidCodec, IndexEntry, ScidGameHeaders, ScidMove, ScidGame,
	NAME_PLAYER, NAME_EVENT, NAME_SITE, NAME_ROUND,
	decodeDate, decodeEco, resultToString,
} from "./types";

export type { ScidGameHeaders, ScidMove, ScidGame } from "./types";

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
