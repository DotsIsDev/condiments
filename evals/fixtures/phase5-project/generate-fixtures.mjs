import { mkdir, writeFile } from "node:fs/promises";

await mkdir(new URL("./data/", import.meta.url), { recursive: true });
await writeFile(
  new URL("./data/evaluation-seed.txt", import.meta.url),
  "subtotal > 100|session.expiresAtMs|createRouter|exponential-jitter|midnight-blue|sqlite-outbox\n",
  "utf8",
);
const lines = [];
for (let index = 1; index <= 12000; index += 1) {
  lines.push(`event ${index}: stable historical record`);
}
lines.push("CHECKPOINT CP-FINAL-7K9 status=verified next=deploy");
await writeFile(new URL("./data/history.log", import.meta.url), `${lines.join("\n")}\n`, "utf8");
