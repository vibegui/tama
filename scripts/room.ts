// One command: a deco chat room to take care of your pet, with this tama's
// MCP connected and its apps (pet, timetable, timeline) pinned in the sidebar.
//
//   bun run room -- --url https://tama-beto.you.workers.dev [--title "Beto"] [--invite a@b.com] [--dry-run]
//   bun run room -- --room <id> --url ...   # use an existing room instead of creating one
//
// Needs the vibebook CLI logged in (`npm i -g vibebook.dev && vibebook login`).
// The MCP accepts the room through the vibebook seal: put the email of everyone
// who uses the room in VIBEBOOK_OWNERS (wrangler.toml).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const dry = argv.includes("--dry-run");
const root = join(import.meta.dir, "..");
const pet = JSON.parse(readFileSync(join(root, "config/pet.json"), "utf8"));

const base = opt("url")
	?.replace(/\/+$/, "")
	.replace(/\/api\/mcp$/, "");
const mcp = `${base}/api/mcp`;
const title = opt("title") ?? `${pet.name ?? "tama"}`;
const invite = argv.flatMap((a, i) => (argv[i - 1] === "--invite" ? [a] : []));
const APPS = [
	["app_pet", "Pet"],
	["app_timetable", "Remédios"],
	["app_timeline", "Linha do tempo"],
] as const;

// biome-ignore lint/suspicious/noExplicitAny: CLI JSON
function call(tool: string, args: Record<string, unknown>): any {
	if (dry) {
		console.log(`  $ vibebook call ${tool} '${JSON.stringify(args)}'`);
		return {};
	}
	const tmp = join(import.meta.dir, `.room-${tool}.json`);
	writeFileSync(tmp, JSON.stringify(args));
	const p = Bun.spawnSync(["vibebook", "call", tool, "-d", `@${tmp}`], {
		stdout: "pipe",
		stderr: "pipe",
	});
	Bun.spawnSync(["rm", "-f", tmp]);
	const out = p.stdout.toString() + p.stderr.toString();
	// The CLI wraps results in untrusted-data marker lines: keep the JSON line.
	const line = out.split("\n").find((l) => l.trim().startsWith("{"));
	const json = line ? JSON.parse(line) : null;
	if (p.exitCode !== 0 || !json || json.ok === false)
		throw new Error(`vibebook ${tool} failed:\n${out}`);
	return json;
}

async function main() {
	if (!base?.startsWith("https://"))
		throw new Error(
			"pass --url <your tama worker URL> (bun run setup prints it)",
		);
	console.log(`tama room: ${title} -> ${mcp}${dry ? " [dry run]" : ""}`);

	// 1. Room
	let room = opt("room");
	if (!room) {
		const r = call("create_room", { title, invite });
		room = r.room_id ?? r.id ?? r.room?.id;
		if (!dry && !room) throw new Error(`no room id in ${JSON.stringify(r)}`);
	}
	room ??= "<room>";

	// 2. Connect the MCP for the whole room (each member passes the seal)
	call("connect_mcp", { room_id: room, url: mcp, scope: "room", title });
	const conns = dry ? [] : call("connections", { room_id: room }).connections;
	const conn =
		// biome-ignore lint/suspicious/noExplicitAny: CLI JSON
		(conns as any[]).find((c) => (c.url ?? "").replace(/\/+$/, "") === mcp)
			?.id ?? "<connection>";
	if (!dry && conn === "<connection>")
		throw new Error(`connected, but ${mcp} is not in connections`);

	// 3. Pin the apps
	for (const [tool, label] of APPS)
		call("pin", {
			room_id: room,
			kind: "app",
			ref: `${conn}/${tool}`,
			title: label,
		});

	// 4. Room doc
	call("update_doc", {
		room_id: room,
		markdown: `# ${title}

Sala pra cuidar do ${pet.name ?? "pet"}. O tama (${base}) está conectado: os apps Pet, Remédios e Linha do tempo ficam fixados na barra lateral.

- Peça ao seu Claude pra registrar doses, sintomas, exames e visitas ao vet.
- Prompts e skills do repo aparecem no chat (pasta \`skills/\` e \`prompts/\`).
`,
	});

	console.log(`
Room ready: https://chat.decocms.com/b/${room}
Apps pinned: ${APPS.map((a) => a[1]).join(", ")}`);
}

main().catch((e) => {
	console.error(String(e.message ?? e));
	process.exit(1);
});
