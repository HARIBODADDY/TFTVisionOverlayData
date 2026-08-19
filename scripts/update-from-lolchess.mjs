import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(SCRIPT_DIR, "..");
const CATALOG_PATH = resolve(REPO_DIR, "catalog.json");
const DRY_RUN = process.argv.includes("--dry-run");
const MAX_DECKS = clamp(Number(process.env.TFT_MAX_DECKS || 12), 5, 20);
const REQUEST_INTERVAL_MS = clamp(
    Number(process.env.LOLCHESS_REQUEST_INTERVAL_MS || 1800),
    1200,
    10_000
);
const USER_AGENT =
    "Mozilla/5.0 (Linux; Android 15; TB371FC) AppleWebKit/537.36 Chrome/138.0 Safari/537.36";
const CONTACT = "haribodaddy.dev@gmail.com";
const LOLCHESS = "https://lolchess.gg";
const DAK_API = "https://tft.dakgg.io/api/v1";
const TFTACTICS = "https://tftactics.gg";
const DEFAULT_LEVEL_PLAN = { "2-1": 4, "2-5": 5, "3-2": 6, "4-1": 7, "4-5": 8 };
const TEAM_CODE_ALIASES = new Map([["galio", "themightymech"]]);
const TEAM_CODE_IGNORED_UNITS = new Set(["shenprop", "ivernminion"]);

let lastRequestAt = 0;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

function sleep(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchText(url) {
    const wait = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(url, {
            headers: {
                Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
                From: CONTACT,
                "User-Agent": USER_AGENT
            },
            redirect: "follow",
            signal: controller.signal
        });
        lastRequestAt = Date.now();
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
        const body = await response.text();
        if (!body.trim()) throw new Error(`Empty response: ${url}`);
        return body;
    } finally {
        clearTimeout(timeout);
    }
}

function parseNextData(html, pageName) {
    const match = html.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!match) throw new Error(`__NEXT_DATA__ not found on ${pageName}`);
    return JSON.parse(match[1]);
}

function queryData(nextData, queryName) {
    const queries = nextData?.props?.pageProps?.dehydratedState?.queries || [];
    const query = queries.find((candidate) => candidate?.queryKey?.[0] === queryName);
    if (!query?.state?.data) throw new Error(`Missing ${queryName} query data`);
    return query.state.data;
}

function normalizeName(value) {
    return String(value || "")
        .replace(/[^가-힣A-Za-z0-9]/g, "")
        .toLowerCase();
}

function championSlug(value) {
    return String(value || "").replace(/^TFT\d+_/, "").toLowerCase();
}

function jaccard(left, right) {
    const a = new Set(left);
    const b = new Set(right);
    let intersection = 0;
    for (const value of a) if (b.has(value)) intersection += 1;
    const union = a.size + b.size - intersection;
    return union ? intersection / union : 0;
}

function deckTier(averagePlace) {
    if (averagePlace <= 4.1) return "S";
    if (averagePlace <= 4.5) return "A";
    if (averagePlace <= 4.8) return "B";
    return "C";
}

function stripHtml(value) {
    return String(value || "")
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/&middot;|&bull;/gi, "·")
        .replace(/&nbsp;/gi, " ")
        .replace(/&gt;/gi, ">")
        .replace(/&lt;/gi, "<")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
}

function levelPlanFromGuide(guide) {
    const contents = guide?.contents || [];
    const text = contents.map((entry) => stripHtml(entry.content)).join(" ");
    const plan = {};
    const pattern = /(\d-\d)(?:\s*~\s*\d-\d)?\s*(?:▶|>|→)\s*(\d{1,2})\s*레벨/g;
    for (const match of text.matchAll(pattern)) {
        plan[match[1]] = clamp(Number(match[2]), 1, 10);
    }
    return Object.keys(plan).length >= 3 ? plan : { ...DEFAULT_LEVEL_PLAN };
}

function parseTftacticsJsonModule(bundle, moduleId) {
    const marker = `,${moduleId}:function(e){e.exports=JSON.parse('`;
    const start = bundle.indexOf(marker);
    if (start < 0) throw new Error(`TFTactics data module ${moduleId} not found`);
    const valueStart = start + marker.length;
    const valueEnd = bundle.indexOf("')},", valueStart);
    if (valueEnd < 0) throw new Error(`TFTactics data module ${moduleId} is incomplete`);

    const rawLiteral = bundle.slice(valueStart, valueEnd);
    const jsonText = JSON.parse(
        `"${rawLiteral.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`
    );
    return JSON.parse(jsonText);
}

function rosterSignature(values) {
    return values.map(normalizeName).filter(Boolean).sort().join("|");
}

function teamCodeRosterName(championId) {
    const slug = championSlug(championId);
    if (TEAM_CODE_IGNORED_UNITS.has(slug)) return "";
    return TEAM_CODE_ALIASES.get(slug) || slug;
}

function buildTeamCode(championNames, championCodeByName) {
    if (championNames.length < 1 || championNames.length > 10) return "";
    const ids = championNames.map((name) => championCodeByName.get(normalizeName(name)));
    if (ids.some((id) => !/^[0-9a-f]{3}$/i.test(id || ""))) return "";
    const code = `02${ids.join("")}${"000".repeat(10 - ids.length)}TFTSet17`;
    return code.length === 40 ? code : "";
}

async function loadTftacticsTeamCodes(expectedPatch) {
    const pageUrl = `${TFTACTICS}/tierlist/team-comps/`;
    const page = await fetchText(pageUrl);
    if (!page.includes(`Patch ${expectedPatch}`) || !page.includes("Set 17")) {
        throw new Error(`TFTactics patch/set mismatch: expected ${expectedPatch}, Set 17`);
    }
    const scriptMatch = page.match(/<script[^>]+src="([^"]*main\.[^"]+\.chunk\.js)"/i);
    if (!scriptMatch) throw new Error("TFTactics main data bundle not found");

    const bundleUrl = new URL(scriptMatch[1], TFTACTICS).href;
    const bundle = await fetchText(bundleUrl);
    const teamComps = parseTftacticsJsonModule(bundle, 121).filter(
        (comp) => comp?.set?.includes(17) && Array.isArray(comp.characters)
    );
    const champions = parseTftacticsJsonModule(bundle, 2).filter(
        (champion) => champion?.set?.includes(17) && /^[0-9a-f]{3}$/i.test(champion.game_id || "")
    );
    const championCodeByName = new Map(
        champions.map((champion) => [normalizeName(champion.name), champion.game_id])
    );
    const exactCodeByRoster = new Map();
    for (const comp of teamComps) {
        const names = comp.characters.map((unit) => unit.name);
        const code = buildTeamCode(names, championCodeByName);
        if (code) exactCodeByRoster.set(rosterSignature(names), { code, name: comp.name });
    }
    return { championCodeByName, exactCodeByRoster, pageUrl };
}

function stableId(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function selectDeckMatches(metaDecks, guideDecks) {
    const candidates = guideDecks.filter(
        (guide) =>
            guide?.season === "set17" &&
            Array.isArray(guide?.data?.slots) &&
            guide.data.slots.length >= 6 &&
            !guide.name.includes("요약")
    );
    const usedGuideKeys = new Set();
    const selected = [];

    for (const metaDeck of [...metaDecks].sort((a, b) => a.avgPlacement - b.avgPlacement)) {
        const metaRoster = (metaDeck.deck?.champions || []).map((unit) => championSlug(unit.key));
        const normalizedMetaName = normalizeName(metaDeck.deckNameKo);
        const matches = candidates
            .filter((guide) => !usedGuideKeys.has(guide.teamBuilderKey))
            .map((guide) => {
                const guideRoster = guide.data.slots.map((slot) => championSlug(slot.champion));
                const rosterScore = jaccard(metaRoster, guideRoster);
                const nameBonus = normalizeName(guide.name).includes(normalizedMetaName) ? 0.12 : 0;
                return { guide, rosterScore, score: rosterScore + nameBonus };
            })
            .sort((a, b) => b.score - a.score);
        const best = matches[0];
        if (!best || best.rosterScore < 0.58) continue;
        usedGuideKeys.add(best.guide.teamBuilderKey);
        selected.push({ metaDeck, guideDeck: best.guide, matchScore: best.rosterScore });
        if (selected.length >= MAX_DECKS) break;
    }
    return selected;
}

async function checkRobots(origin, paths) {
    const robots = await fetchText(`${origin}/robots.txt`);
    const blocked = robots
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^disallow:/i.test(line))
        .map((line) => line.slice(line.indexOf(":") + 1).trim())
        .filter(Boolean);
    for (const path of paths) {
        if (blocked.some((rule) => path.startsWith(rule))) {
            throw new Error(`${origin}/robots.txt disallows required path: ${path}`);
        }
    }
}

function validateCatalog(catalog) {
    const errors = [];
    if (catalog.schemaVersion !== 2) errors.push("schemaVersion must be 2");
    if (!catalog.patch) errors.push("patch is required");
    if (!Array.isArray(catalog.decks) || catalog.decks.length < 5) {
        errors.push("at least five decks are required");
    }
    for (const deck of catalog.decks || []) {
        if (!deck.id || !deck.title || !Array.isArray(deck.units)) {
            errors.push(`invalid deck: ${deck.title || deck.id || "unknown"}`);
            continue;
        }
        if (!/^02[0-9a-f]{30}TFTSet17$/i.test(deck.teamCode || "")) {
            errors.push(`${deck.title}: invalid or missing Set 17 team code`);
        }
        const occupied = new Set();
        for (const unit of deck.units) {
            if (unit.row < 0 || unit.row > 3 || unit.column < 0 || unit.column > 6) {
                errors.push(`${deck.title}: invalid board coordinate`);
            }
            const coordinate = `${unit.row}:${unit.column}`;
            if (occupied.has(coordinate)) errors.push(`${deck.title}: duplicate ${coordinate}`);
            occupied.add(coordinate);
            if ((unit.items || []).length > 3) errors.push(`${deck.title}: too many items`);
        }
    }
    if (!Array.isArray(catalog.augments) || catalog.augments.length < 100) {
        errors.push("at least 100 visible augments are required");
    }
    for (const augment of catalog.augments || []) {
        if (!augment.name || !["S", "A", "B", "C"].includes(augment.tier)) {
            errors.push(`invalid augment: ${augment.name || augment.id || "unknown"}`);
        }
    }
    if (errors.length) throw new Error(`Catalog validation failed:\n- ${errors.join("\n- ")}`);
}

async function main() {
    const existingCatalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
    await checkRobots(LOLCHESS, ["/decks", "/meta", "/augments/set17/tier", "/builder/guide/"]);
    await checkRobots(TFTACTICS, ["/tierlist/team-comps/", "/static/js/"]);

    const decksPage = parseNextData(
        await fetchText(`${LOLCHESS}/decks?hl=ko-KR`),
        "LoLCHESS meta trends"
    );
    const metaPage = parseNextData(
        await fetchText(`${LOLCHESS}/meta?hl=ko-KR`),
        "LoLCHESS comps"
    );
    const augmentsPage = parseNextData(
        await fetchText(`${LOLCHESS}/augments/set17/tier?hl=ko-KR`),
        "LoLCHESS augment tier"
    );
    const augmentTierResponse = JSON.parse(
        await fetchText(`${DAK_API}/data/augment-tiers?hl=ko&season=set17`)
    );

    const metaDeckData = queryData(decksPage, "meta-decks");
    const guideData = queryData(metaPage, "getGuideDecks");
    const championRefs = queryData(metaPage, "championRefs").champions || [];
    const itemRefs = queryData(metaPage, "itemRefs").items || [];
    const augmentRefs = queryData(augmentsPage, "augmentRefs").augments || [];

    const championByKey = new Map(championRefs.map((champion) => [champion.key, champion]));
    const itemByKey = new Map(itemRefs.map((item) => [item.key, item]));
    const matches = selectDeckMatches(
        metaDeckData.metaDeckList?.metaDecks || [],
        guideData.guideDecks || []
    );
    if (matches.length < 5) throw new Error(`Only ${matches.length} reliable deck matches found`);

    const patchVersion = metaDeckData.patchRevisions?.[0]?.patchVersion || "unknown";
    const tftactics = await loadTftacticsTeamCodes(patchVersion);

    const decks = [];
    for (const { metaDeck, guideDeck, matchScore } of matches) {
        let detailedBuilder = null;
        try {
            const detailUrl = `${LOLCHESS}/builder/guide/${guideDeck.teamBuilderKey}?type=guide&hl=ko-KR`;
            const detailPage = parseNextData(await fetchText(detailUrl), guideDeck.name);
            detailedBuilder = queryData(detailPage, "teamBuilder").teamBuilder;
        } catch (error) {
            console.warn(`Builder detail unavailable for ${guideDeck.name}: ${error.message}`);
        }

        const slots = detailedBuilder?.slots || guideDeck.data.slots;
        const units = slots
            .filter((slot) => Number.isInteger(slot.index) && slot.index >= 0 && slot.index < 28)
            .map((slot) => {
                const champion = championByKey.get(slot.champion);
                const championId = champion?.ingameKey || `TFT17_${slot.champion}`;
                return {
                    championId,
                    name: champion?.name || slot.champion,
                    row: Math.floor(slot.index / 7),
                    column: slot.index % 7,
                    star: clamp(Number(slot.star || 2), 1, 4),
                    items: (slot.items || []).slice(0, 3).map((key) => itemByKey.get(key)?.name || key)
                };
            });
        const championIds = units.map((unit) => unit.championId);
        const roster = units.map((unit) => teamCodeRosterName(unit.championId)).filter(Boolean);
        const exactTftactics = tftactics?.exactCodeByRoster.get(rosterSignature(roster));
        const generatedTeamCode = exactTftactics?.code ||
            buildTeamCode(roster, tftactics?.championCodeByName || new Map());
        const teamCode = generatedTeamCode;
        decks.push({
            id: stableId(`lolchess:${guideDeck.teamBuilderKey}`),
            title: metaDeck.deckNameKo || guideDeck.name,
            tier: deckTier(metaDeck.avgPlacement),
            patch: patchVersion,
            teamCode,
            teamCodeSource: generatedTeamCode
                ? exactTftactics
                    ? `TFTactics.gg ${patchVersion} · ${exactTftactics.name}`
                    : `TFTactics.gg ${patchVersion} 챔피언 코드 · LoLCHESS.GG 덱 구성`
                : "미제공",
            teamCodeSourceUrl: generatedTeamCode ? tftactics?.pageUrl : "",
            teamBuilderKey: guideDeck.teamBuilderKey,
            sourceLabel: "LoLCHESS.GG 공개 메타 · TFT Vision 가공",
            sourceUrl: `${LOLCHESS}/builder/guide/${guideDeck.teamBuilderKey}?type=guide`,
            sourceMatch: round(matchScore, 3),
            averagePlace: round(metaDeck.avgPlacement),
            top4Rate: round(metaDeck.topRate),
            pickRate: round(metaDeck.pickRate),
            levelPlan: levelPlanFromGuide(detailedBuilder?.guide),
            units
        });
    }

    const existingAugmentById = new Map(
        (existingCatalog.augments || []).map((augment) => [augment.id, augment])
    );
    const existingAugmentByName = new Map(
        (existingCatalog.augments || []).map((augment) => [normalizeName(augment.name), augment])
    );
    const tierById = new Map(
        (augmentTierResponse?.data?.augmentTiers || []).map((entry) => [entry.key, entry.tier])
    );
    const augments = augmentRefs
        .filter((augment) => !augment.isHidden)
        .map((augment) => {
            const id = augment.ingameKey || augment.key;
            const existing = existingAugmentById.get(id) || existingAugmentByName.get(normalizeName(augment.name));
            const rawTier = tierById.get(id) || tierById.get(augment.key) || existing?.tier || "C";
            const tier = rawTier === "D" || !["S", "A", "B", "C"].includes(rawTier)
                ? "C"
                : rawTier;
            return {
                id,
                name: augment.name,
                tier,
                sourceLabel: "LoLCHESS.GG 공개 티어 · TFT Vision 가공"
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "ko"));

    const catalog = {
        schemaVersion: 2,
        patch: `${patchVersion} · 세트 17`,
        updatedAt: new Date().toISOString(),
        decks,
        augments
    };
    validateCatalog(catalog);

    const output = `${JSON.stringify(catalog, null, 2)}\n`;
    if (DRY_RUN) {
        const teamCodeCount = decks.filter((deck) => deck.teamCode).length;
        console.log(
            `Dry run passed: ${decks.length} decks (${teamCodeCount} team codes), ` +
            `${augments.length} augments, patch ${catalog.patch}`
        );
        return;
    }
    const temporaryPath = `${CATALOG_PATH}.tmp`;
    await writeFile(temporaryPath, output, "utf8");
    await rename(temporaryPath, CATALOG_PATH);
    console.log(`Updated catalog.json: ${decks.length} decks, ${augments.length} augments`);
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
