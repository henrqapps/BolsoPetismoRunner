// Ranking Online Compartilhado + Fallback Local (localStorage)
// Suporta Firebase Realtime Database via REST com feedback detalhado e fallback local.

const LEADERBOARD_CONFIG = {
    firebaseDatabaseUrl: "https://bolsopetismo-237a2-default-rtdb.firebaseio.com",
    boardKey: "corrida_bolsopetismo_3d_v1"
};

const LOCAL_STORAGE_KEY = "rio_surfers_online_ranking_v1";
const PLAYER_NAME_KEY = "rio_surfers_player_name_v1";

let lastRankingFeedback = "";

function getSavedPlayerName() {
    try {
        return (localStorage.getItem(PLAYER_NAME_KEY) || "").trim();
    } catch (_) {
        return "";
    }
}

function savePlayerName(name) {
    const clean = sanitizePlayerName(name);
    try {
        localStorage.setItem(PLAYER_NAME_KEY, clean);
    } catch (_) {}
    return clean;
}

function sanitizePlayerName(rawName) {
    const cleaned = String(rawName || "")
        .replace(/[<>&"'`]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 18);
    return cleaned || "Jogador Carioca";
}

function loadLocalEntries() {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function saveLocalEntries(entries) {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries.slice(0, 50)));
    } catch (_) {}
}

function normalizeAndSortEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list
        .map((item, idx) => ({
            id: item.id || `entry_${idx}_${item.timestamp || 0}`,
            name: sanitizePlayerName(item.name),
            score: Math.max(0, Math.floor(Number(item.score) || 0)),
            coins: Math.max(0, Math.floor(Number(item.coins) || 0)),
            character: (item.character || "lula").toLowerCase(),
            timestamp: Number(item.timestamp) || Date.now()
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.coins !== a.coins) return b.coins - a.coins;
            return b.timestamp - a.timestamp;
        });
}

function hasFirebaseConfigured() {
    const url = (LEADERBOARD_CONFIG.firebaseDatabaseUrl || "").trim();
    return Boolean(url && /^https?:\/\//i.test(url));
}

function getFirebaseCollectionUrl() {
    const base = LEADERBOARD_CONFIG.firebaseDatabaseUrl.trim().replace(/\/+$/, "");
    return `${base}/leaderboards/${LEADERBOARD_CONFIG.boardKey}.json`;
}

function setRankingStatusMessage(msg, isError = false) {
    lastRankingFeedback = msg || "";
    const statusEls = document.querySelectorAll(".ranking-status-msg");
    statusEls.forEach(el => {
        el.textContent = msg || "";
        el.classList.toggle("error", Boolean(isError));
        el.classList.toggle("hidden", !msg);
    });
}

async function fetchOnlineRanking() {
    const localEntries = loadLocalEntries();

    if (!hasFirebaseConfigured()) {
        return {
            entries: normalizeAndSortEntries(localEntries).slice(0, 10),
            isOnline: false,
            statusMessage: "Modo Local Ativo"
        };
    }

    try {
        const res = await fetch(getFirebaseCollectionUrl(), { cache: "no-store" });
        if (!res.ok) {
            const errText = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status}${errText ? ` (${errText.slice(0, 80)})` : ""}`);
        }
        const data = await res.json();

        const remoteEntries = [];
        if (data && typeof data === "object") {
            Object.entries(data).forEach(([key, val]) => {
                if (val && typeof val === "object") {
                    remoteEntries.push({ id: key, ...val });
                }
            });
        }

        const seen = new Set();
        const merged = [];
        [...remoteEntries, ...localEntries].forEach(entry => {
            const key = `${sanitizePlayerName(entry.name).toLowerCase()}|${Math.floor(Number(entry.score) || 0)}|${Math.floor(Number(entry.coins) || 0)}|${Number(entry.timestamp) || 0}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(entry);
            }
        });

        const sorted = normalizeAndSortEntries(merged);
        saveLocalEntries(sorted);

        return {
            entries: sorted.slice(0, 10),
            isOnline: true,
            statusMessage: "Ranking Online Sincronizado"
        };
    } catch (err) {
        console.warn("Falha ao buscar ranking online:", err);
        return {
            entries: normalizeAndSortEntries(localEntries).slice(0, 10),
            isOnline: false,
            statusMessage: `Erro de conexão com Firebase: ${err.message || err}`
        };
    }
}

async function submitScoreToRanking({ name, score, coins, character }) {
    const cleanName = savePlayerName(name);
    const entry = {
        id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: cleanName,
        score: Math.max(0, Math.floor(Number(score) || 0)),
        coins: Math.max(0, Math.floor(Number(coins) || 0)),
        character: (character || "lula").toLowerCase(),
        timestamp: Date.now()
    };

    const currentLocal = loadLocalEntries();
    currentLocal.push(entry);
    saveLocalEntries(normalizeAndSortEntries(currentLocal));

    let onlineSaved = false;
    let onlineError = "";

    if (hasFirebaseConfigured()) {
        try {
            const res = await fetch(getFirebaseCollectionUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: entry.name,
                    score: entry.score,
                    coins: entry.coins,
                    character: entry.character,
                    timestamp: entry.timestamp
                })
            });
            if (!res.ok) {
                const bodyTxt = await res.text().catch(() => "");
                throw new Error(`HTTP ${res.status}${bodyTxt ? ` - ${bodyTxt.slice(0, 90)}` : ""}`);
            }
            onlineSaved = true;
            setRankingStatusMessage(`Pontuação de ${entry.name} (${entry.score.toLocaleString("pt-BR")} pts) enviada ao ranking online!`, false);
        } catch (err) {
            onlineError = err.message || String(err);
            console.warn("Falha ao enviar pontuação para o Firebase:", err);
            setRankingStatusMessage(`Salvo localmente, mas o Firebase bloqueou/falhou: ${onlineError}`, true);
        }
    } else {
        setRankingStatusMessage("Salvo localmente neste navegador.", false);
    }

    const rankingData = await fetchOnlineRanking();
    return { ...rankingData, onlineSaved, onlineError, entry };
}

function renderRankingList(containerEl, entries, highlightName = "") {
    if (!containerEl) return;
    const normHighlight = sanitizePlayerName(highlightName).toLowerCase();

    if (!entries || entries.length === 0) {
        containerEl.innerHTML = `<div class="ranking-empty">Nenhuma pontuação registrada ainda. Seja o primeiro a correr!</div>`;
        return;
    }

    containerEl.innerHTML = entries.map((item, index) => {
        const pos = index + 1;
        const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : `#${pos}`;
        const charLabel = item.character === "bolsonaro" ? "🇧🇷 Bolsonaro" : "★ Lula";
        const isMe = normHighlight && sanitizePlayerName(item.name).toLowerCase() === normHighlight;

        return `
            <div class="ranking-row ${pos <= 3 ? `top-${pos}` : ""} ${isMe ? "is-me" : ""}">
                <span class="rk-pos">${medal}</span>
                <div class="rk-player">
                    <strong class="rk-name">${escapeHtml(item.name)}</strong>
                    <span class="rk-char">${charLabel}</span>
                </div>
                <div class="rk-metrics">
                    <span class="rk-score">${item.score.toLocaleString("pt-BR")} pts</span>
                    <span class="rk-coins">💵 ${item.coins}</span>
                </div>
            </div>
        `;
    }).join("");
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function syncAllPlayerNameInputs(value) {
    const val = String(value || "");
    const menuInput = document.getElementById("player-name-input");
    const overInput = document.getElementById("gameover-name-input");
    if (menuInput && menuInput.value !== val) menuInput.value = val;
    if (overInput && overInput.value !== val) overInput.value = val;
}

async function refreshRankingUI(highlightName = "") {
    const menuList = document.getElementById("menu-ranking-list");
    const overList = document.getElementById("gameover-ranking-list");
    const badgeEl = document.getElementById("ranking-mode-badge");

    const result = await fetchOnlineRanking();
    if (badgeEl) {
        badgeEl.textContent = result.isOnline ? "ONLINE" : "OFFLINE / LOCAL";
        badgeEl.classList.toggle("online", result.isOnline);
        badgeEl.title = result.statusMessage;
    }

    if (!result.isOnline && result.statusMessage && result.statusMessage.startsWith("Erro")) {
        setRankingStatusMessage(result.statusMessage, true);
    } else if (result.isOnline && !lastRankingFeedback) {
        setRankingStatusMessage("", false);
    }

    renderRankingList(menuList, result.entries, highlightName);
    renderRankingList(overList, result.entries, highlightName);
}

function parseNumericStat(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return 0;
    const digitsOnly = String(el.textContent || "0").replace(/[^0-9]/g, "");
    return Math.max(0, parseInt(digitsOnly || "0", 10) || 0);
}

async function handleSaveGameOverScore(autoSave = false) {
    const saveOverBtn = document.getElementById("save-gameover-score-btn");
    const menuInput = document.getElementById("player-name-input");
    const overInput = document.getElementById("gameover-name-input");

    if (!saveOverBtn) return;
    if (autoSave) return;
    if (saveOverBtn.dataset.saving === "true") return;

    const typedName = ((overInput && overInput.value) || (menuInput && menuInput.value) || "").trim();
    if (!typedName) {
        setRankingStatusMessage("Digite o seu nome antes de salvar no ranking!", true);
        if (overInput) overInput.focus();
        return;
    }
    const rawName = sanitizePlayerName(typedName);
    const finalScoreVal = (typeof window.lastRunScore === "number") ? window.lastRunScore : parseNumericStat("final-score");
    const finalCoinsVal = (typeof window.lastRunCoins === "number") ? window.lastRunCoins : parseNumericStat("final-coins");
    const charUsed = window.selectedChar || "lula";

    saveOverBtn.dataset.saving = "true";
    saveOverBtn.disabled = true;
    saveOverBtn.textContent = "SALVANDO...";

    const result = await submitScoreToRanking({
        name: rawName,
        score: finalScoreVal,
        coins: finalCoinsVal,
        character: charUsed
    });

    saveOverBtn.dataset.saving = "false";
    if (result.onlineSaved) {
        saveOverBtn.dataset.saved = "true";
        saveOverBtn.textContent = "✓ SALVO ONLINE";
    } else {
        saveOverBtn.disabled = false;
        saveOverBtn.dataset.saved = "false";
        saveOverBtn.textContent = "TENTAR SALVAR";
    }

    await refreshRankingUI(rawName);
}

window.handleSaveGameOverScore = handleSaveGameOverScore;

function initLeaderboardUI() {
    const savedName = getSavedPlayerName();
    syncAllPlayerNameInputs(savedName);

    const menuInput = document.getElementById("player-name-input");
    const overInput = document.getElementById("gameover-name-input");
    const saveOverBtn = document.getElementById("save-gameover-score-btn");
    const refreshBtn = document.getElementById("refresh-ranking-btn");

    if (menuInput) {
        menuInput.addEventListener("input", (e) => {
            syncAllPlayerNameInputs(e.target.value);
        });
        menuInput.addEventListener("change", (e) => {
            const clean = savePlayerName(e.target.value);
            syncAllPlayerNameInputs(clean);
        });
    }

    if (overInput) {
        overInput.addEventListener("input", (e) => {
            syncAllPlayerNameInputs(e.target.value);
            if (saveOverBtn && saveOverBtn.dataset.saved === "true") {
                saveOverBtn.disabled = false;
                saveOverBtn.dataset.saved = "false";
                saveOverBtn.textContent = "SALVAR";
            }
        });
    }

    if (saveOverBtn) {
        saveOverBtn.addEventListener("click", () => handleSaveGameOverScore(false));
    }

    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            const curName = (menuInput && menuInput.value) || getSavedPlayerName();
            refreshRankingUI(curName);
        });
    }

    refreshRankingUI(savedName);
}

window.addEventListener("DOMContentLoaded", initLeaderboardUI);
