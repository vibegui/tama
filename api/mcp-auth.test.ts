import { expect, test } from "bun:test";
import { mcpAuthRejection } from "./app.ts";
import type { Env } from "./env.ts";

const req = (auth?: string) =>
	new Request("https://pet.example/api/mcp", {
		method: "POST",
		headers: auth ? { authorization: auth } : {},
	});
const env = (e: Partial<Env>) => e as Env;

test("no auth configured: open", () => {
	expect(mcpAuthRejection(req(), env({}))).toBeNull();
});

test("bearer set: right token passes, wrong/missing rejected", () => {
	const e = env({ MCP_BEARER_TOKEN: "s3cret" });
	expect(mcpAuthRejection(req("Bearer s3cret"), e)).toBeNull();
	expect(mcpAuthRejection(req("Bearer nope"), e)?.status).toBe(401);
	expect(mcpAuthRejection(req(), e)?.status).toBe(401);
});

test("only VIBEBOOK_OWNERS set: not open (seal must decide)", () => {
	const e = env({ VIBEBOOK_OWNERS: "a@b.com" });
	expect(mcpAuthRejection(req(), e)?.status).toBe(401);
	expect(mcpAuthRejection(req("Bearer anything"), e)?.status).toBe(401);
});
