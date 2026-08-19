import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const path = resolve(process.cwd(), process.argv[2] || "catalog.json");
const catalog = JSON.parse(await readFile(path, "utf8"));
const errors = [];

if (catalog.schemaVersion !== 2) errors.push("schemaVersion must be 2");
if (!catalog.patch || !catalog.updatedAt) errors.push("patch and updatedAt are required");
if (!Array.isArray(catalog.decks) || catalog.decks.length < 5) errors.push("five decks required");
if (!Array.isArray(catalog.augments) || catalog.augments.length < 100) {
    errors.push("100 visible augments required");
}

for (const deck of catalog.decks || []) {
    const occupied = new Set();
    if (!deck.id || !deck.title || !Array.isArray(deck.units)) errors.push(`invalid deck ${deck.id}`);
    if (!/^02[0-9a-f]{30}TFTSet17$/i.test(deck.teamCode || "")) {
        errors.push(`${deck.title}: invalid or missing Set 17 team code`);
    }
    for (const unit of deck.units || []) {
        const coordinate = `${unit.row}:${unit.column}`;
        if (unit.row < 0 || unit.row > 3 || unit.column < 0 || unit.column > 6) {
            errors.push(`${deck.title}: coordinate ${coordinate} is outside 4x7 board`);
        }
        if (occupied.has(coordinate)) errors.push(`${deck.title}: duplicate coordinate ${coordinate}`);
        occupied.add(coordinate);
        if ((unit.items || []).length > 3) errors.push(`${deck.title}: more than three items`);
    }
}

for (const augment of catalog.augments || []) {
    if (!augment.id || !augment.name || !["S", "A", "B", "C"].includes(augment.tier)) {
        errors.push(`invalid augment ${augment.id || augment.name}`);
    }
    if (augment.pickRate !== null && !Number.isFinite(augment.pickRate)) {
        errors.push(`${augment.name}: invalid pickRate`);
    }
}

if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exit(1);
}

console.log(
    `Valid catalog: ${catalog.decks.length} decks (${catalog.decks.filter((deck) => deck.teamCode).length} team codes), ` +
    `${catalog.augments.length} augments, ${catalog.patch}`
);
