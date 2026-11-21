# prompts/ e skills/

Cada arquivo aqui vira um prompt no chat (MCP prompt) do seu tama, sem mexer em código.

- `prompts/<nome>.md` — um prompt simples.
- `skills/<nome>/SKILL.md` — uma skill (mesmo formato das skills do Claude).

Frontmatter opcional: `name`, `title`, `description`. O corpo é o texto do prompt.
O build (`bun run dev`, `bun run build`, `bun run deploy`) junta tudo em
`api/prompts/skills.gen.ts`.
