"use strict";

const $ = (id) => document.getElementById(id);
let currentAccountId = null;
let currentStream = "generic";
let composerState = {};

function esc(v) {
  const d = document.createElement("div");
  d.textContent = v ?? "";
  return d.innerHTML;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function accountQuery() {
  return currentAccountId ? `?account=${encodeURIComponent(currentAccountId)}` : "";
}

// --- Comptes -----------------------------------------------------------------
async function loadAccounts() {
  try {
    const data = await api("/api/accounts");
    const accounts = data.accounts || [];
    if (!currentAccountId) currentAccountId = data.defaultId || (accounts[0] && accounts[0].id) || null;
    $("accountSelect").innerHTML = accounts
      .map((a) => `<option value="${esc(a.id)}">${esc(a.label)}</option>`)
      .join("");
    if (currentAccountId) $("accountSelect").value = currentAccountId;
    renderAccountsView(accounts);
  } catch {
    /* ignore */
  }
}

function renderAccountsView(accounts) {
  const list = $("accountsList");
  if (!list) return;
  list.innerHTML = accounts
    .map((a) => {
      const tags = [
        a.redditUsername ? `u/${esc(a.redditUsername)}` : "pseudo non défini",
        a.hasProxy ? "proxy ✓" : "sans proxy",
        a.hasCredentials ? "identifiants ✓" : "sans identifiants",
      ]
        .map((t) => `<span class="chip">${t}</span>`)
        .join("");
      const del = a.removable
        ? `<button class="btn-link-danger" data-del="${esc(a.id)}">Supprimer</button>`
        : '<span class="muted-p" style="margin:0">env</span>';
      return `<div class="account-card${a.id === currentAccountId ? " is-current" : ""}">
        <div class="account-card-top">
          <strong>${esc(a.label)}</strong>
          <button class="btn btn-ghost btn-sm" data-use="${esc(a.id)}">Utiliser</button>
        </div>
        <div class="reco-meta">${tags}</div>
        <div class="account-card-foot">${del}</div>
      </div>`;
    })
    .join("");
}

$("accountsList").addEventListener("click", async (e) => {
  const use = e.target.closest("[data-use]");
  const del = e.target.closest("[data-del]");
  if (use) {
    currentAccountId = use.getAttribute("data-use");
    $("accountSelect").value = currentAccountId;
    renderAccountsView((await api("/api/accounts")).accounts || []);
  } else if (del) {
    if (confirm("Supprimer ce compte ?")) {
      await api(`/api/accounts/${encodeURIComponent(del.getAttribute("data-del"))}`, { method: "DELETE" }).catch((err) => alert(err.message));
      currentAccountId = null;
      loadAccounts();
    }
  }
});

async function addAccount() {
  const label = $("acLabel").value.trim();
  if (!label) {
    $("acError").textContent = "Nom du marché requis.";
    $("acError").hidden = false;
    return;
  }
  $("acSave").disabled = true;
  try {
    await api("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        redditUsername: $("acReddit").value.trim(),
        proxyServer: $("acProxyServer").value.trim(),
        proxyUsername: $("acProxyUser").value.trim(),
        proxyPassword: $("acProxyPass").value,
        username: $("acUser").value.trim(),
        password: $("acPass").value,
        totpSecret: $("acTotp").value.trim(),
      }),
    });
    ["acLabel", "acReddit", "acProxyServer", "acProxyUser", "acProxyPass", "acUser", "acPass", "acTotp"].forEach((id) => ($(id).value = ""));
    $("acError").hidden = true;
    loadAccounts();
  } catch (e) {
    $("acError").textContent = e.message;
    $("acError").hidden = false;
  } finally {
    $("acSave").disabled = false;
  }
}

// --- Onglets -----------------------------------------------------------------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.getAttribute("data-tab");
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.hidden = p.id !== `tab-${target}`;
    });
    if (target === "drafts") loadDrafts();
    if (target === "accounts") loadAccounts();
  });
});

// --- Recommandations ---------------------------------------------------------
// Bascule de flux (Générique / Dayuse).
document.querySelectorAll(".seg").forEach((seg) => {
  seg.addEventListener("click", () => {
    currentStream = seg.getAttribute("data-stream");
    document.querySelectorAll(".seg").forEach((s) => s.classList.toggle("is-active", s === seg));
    $("streamHint").textContent =
      currentStream === "dayuse"
        ? "Dayuse : threads liés au day-use, spa, layover, daycation, télétravail… (plan de recherche Dayuse)."
        : "Générique : fils actifs, non polémiques, à valeur ajoutée — pour une présence humaine de qualité.";
    $("recoList").innerHTML = "";
    $("recoStatus").textContent = "";
  });
});

async function loadReco() {
  $("loadReco").disabled = true;
  $("recoStatus").textContent = "Analyse Reddit en cours… (~20-40 s)";
  $("recoList").innerHTML = "";
  try {
    const sep = accountQuery() ? "&" : "?";
    const data = await api(`/api/recommendations${accountQuery()}${sep}stream=${currentStream}`);
    const recos = data.recommendations || [];
    $("recoStatus").textContent = recos.length
      ? `${recos.length} threads recommandés.`
      : "Aucun thread ne correspond pour l'instant — réessaie plus tard.";
    $("recoList").innerHTML = recos.map(recoCard).join("");
  } catch (e) {
    $("recoStatus").textContent = `Erreur : ${e.message}`;
  } finally {
    $("loadReco").disabled = false;
  }
}

function recoCard(r) {
  const chips = (r.reasons || []).map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  return `<div class="reco">
    <div class="reco-main">
      <a class="reco-title" href="${esc(r.permalink)}" target="_blank">${esc(r.title)}</a>
      <div class="reco-meta">r/${esc(r.subreddit)} · ${r.ageHours}h · ${r.commentsCount} comm. · ${r.score} pts ${chips}</div>
    </div>
    <button class="btn btn-primary btn-sm" data-prepare='${esc(JSON.stringify({ url: r.permalink, title: r.title, subreddit: r.subreddit }))}'>Préparer une réponse</button>
  </div>`;
}

$("recoList").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-prepare]");
  if (btn) openComposer(JSON.parse(btn.getAttribute("data-prepare")));
});

// --- Composeur ---------------------------------------------------------------
function openComposer(ctx) {
  composerState = ctx || {};
  $("composerUrl").value = composerState.url || "";
  $("composerText").value = "";
  $("composerError").hidden = true;
  updateComposerCount();
  $("composerContext").innerHTML = composerState.title
    ? `<div class="reco-title">${esc(composerState.title)}</div><div class="reco-meta">r/${esc(composerState.subreddit || "")}</div>`
    : `<div class="muted-p">Réponse manuelle — colle l'URL du post/commentaire ci-dessous.</div>`;
  $("composer").hidden = false;
}
function closeComposer() {
  $("composer").hidden = true;
}
function updateComposerCount() {
  const n = $("composerText").value.length;
  $("composerCount").textContent = `${n} caractère${n > 1 ? "s" : ""}`;
}

async function aiDraft() {
  $("aiDraft").disabled = true;
  $("aiDraft").textContent = "Génération…";
  $("composerError").hidden = true;
  try {
    const data = await api("/api/draft-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: composerState.title || "(post Reddit)",
        subreddit: composerState.subreddit || "AskReddit",
        body: composerState.body || "",
      }),
    });
    $("composerText").value = data.text || "";
    updateComposerCount();
  } catch (e) {
    showComposerError(e.message);
  } finally {
    $("aiDraft").disabled = false;
    $("aiDraft").textContent = "✨ Brouillon IA";
  }
}

async function saveDraft() {
  const url = $("composerUrl").value.trim();
  const text = $("composerText").value.trim();
  if (!url || !text) {
    showComposerError("URL et texte requis.");
    return;
  }
  $("composerSave").disabled = true;
  try {
    let subreddit = composerState.subreddit;
    if (!subreddit) {
      const m = url.match(/\/r\/([^/]+)\//);
      subreddit = m ? m[1] : "reddit";
    }
    await api("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: currentAccountId,
        targetUrl: url,
        title: composerState.title || "Réponse manuelle",
        subreddit,
        text,
        source: composerState.title ? "generic" : "manual",
      }),
    });
    closeComposer();
    // Bascule sur l'onglet Brouillons.
    document.querySelector('.tab[data-tab="drafts"]').click();
  } catch (e) {
    showComposerError(e.message);
  } finally {
    $("composerSave").disabled = false;
  }
}

function showComposerError(msg) {
  $("composerError").textContent = msg;
  $("composerError").hidden = false;
}

// --- Brouillons --------------------------------------------------------------
async function loadDrafts() {
  try {
    const all = await api("/api/drafts");
    const items = all.filter((d) => !currentAccountId || d.accountId === currentAccountId);
    $("draftsList").innerHTML = items.length
      ? items.map(draftRow).join("")
      : '<p class="muted-p">Aucun brouillon pour ce compte.</p>';
  } catch {
    /* ignore */
  }
}

function draftRow(d) {
  const badge = d.status === "posted"
    ? '<span class="badge badge--ok">publié</span>'
    : '<span class="badge badge--pending">à publier</span>';
  return `<div class="draft" data-id="${esc(d.id)}" data-url="${esc(d.targetUrl)}">
    <div class="draft-head">
      <a class="reco-title" href="${esc(d.targetUrl)}" target="_blank">${esc(d.title)}</a>
      <div class="reco-meta">r/${esc(d.subreddit)} · ${esc(d.accountLabel)} ${badge}</div>
    </div>
    <div class="draft-text">${esc(d.text)}</div>
    <div class="draft-actions">
      ${d.status === "posted" ? "" : '<button class="btn btn-primary btn-sm" data-act="publish">Publier sur Reddit</button>'}
      <button class="btn btn-ghost btn-sm" data-act="copy">Copier</button>
      <a class="btn btn-ghost btn-sm" href="${esc(d.targetUrl)}" target="_blank">Ouvrir le post</a>
      ${d.status === "posted" ? "" : '<button class="btn btn-ghost btn-sm" data-act="posted">Marquer publié (manuel)</button>'}
      <button class="btn-link-danger" data-act="delete">Supprimer</button>
    </div>
  </div>`;
}

$("draftsList").addEventListener("click", async (e) => {
  const actEl = e.target.closest("[data-act]");
  if (!actEl) return;
  const row = e.target.closest(".draft");
  const id = row.getAttribute("data-id");
  const act = actEl.getAttribute("data-act");
  if (act === "publish") {
    const url = row.getAttribute("data-url");
    const text = row.querySelector(".draft-text").textContent;
    actEl.disabled = true;
    actEl.textContent = "Publication…";
    try {
      await api("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, text, accountId: currentAccountId }),
      });
      await api(`/api/drafts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "posted" }),
      }).catch(() => {});
      loadDrafts();
    } catch (err) {
      alert(`Échec de publication : ${err.message}\n\nSi c'est un souci de connexion, reconnecte le compte puis réessaie — ou utilise « Copier » + « Ouvrir le post » pour publier à la main.`);
      actEl.disabled = false;
      actEl.textContent = "Publier sur Reddit";
    }
  } else if (act === "copy") {
    const text = row.querySelector(".draft-text").textContent;
    navigator.clipboard.writeText(text).then(() => {
      actEl.textContent = "Copié ✓";
      setTimeout(() => (actEl.textContent = "Copier"), 1500);
    });
  } else if (act === "posted") {
    await api(`/api/drafts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "posted" }),
    }).catch(() => {});
    loadDrafts();
  } else if (act === "delete") {
    if (confirm("Supprimer ce brouillon ?")) {
      await api(`/api/drafts/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
      loadDrafts();
    }
  }
});

// --- Publié ------------------------------------------------------------------
async function loadPublished() {
  const user = $("pubUser").value.trim();
  $("publishedList").innerHTML = '<p class="muted-p">Chargement…</p>';
  try {
    const sep = accountQuery() ? "&" : "?";
    const q = user ? `${sep}user=${encodeURIComponent(user)}` : "";
    const data = await api(`/api/published${accountQuery()}${q}`);
    const items = data.activity || [];
    $("publishedList").innerHTML = items.length
      ? items
          .map((a) => {
            const tag = a.kind === "post" ? "post" : "commentaire";
            const head = a.title ? `<div class="reco-title">${esc(a.title)}</div>` : "";
            return `<div class="draft">
              <div class="reco-meta">${tag} · r/${esc(a.subreddit)} · ${a.score} pts</div>
              ${head}
              ${a.body ? `<div class="draft-text">${esc(a.body)}</div>` : ""}
              <div class="draft-actions"><a class="btn btn-ghost btn-sm" href="${esc(a.permalink)}" target="_blank">Voir sur Reddit</a></div>
            </div>`;
          })
          .join("")
      : '<p class="muted-p">Aucune activité publique trouvée (compte neuf, contenu filtré, ou pseudo erroné).</p>';
  } catch (e) {
    $("publishedList").innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

// --- Évènements --------------------------------------------------------------
$("accountSelect").addEventListener("change", () => {
  currentAccountId = $("accountSelect").value;
  $("recoList").innerHTML = "";
  $("recoStatus").textContent = "";
  loadDrafts();
});
$("loadReco").addEventListener("click", loadReco);
$("newManual").addEventListener("click", () => openComposer(null));
$("composerClose").addEventListener("click", closeComposer);
$("composerCancel").addEventListener("click", closeComposer);
$("aiDraft").addEventListener("click", aiDraft);
$("composerSave").addEventListener("click", saveDraft);
$("composerText").addEventListener("input", updateComposerCount);
$("refreshDrafts").addEventListener("click", loadDrafts);
$("loadPublished").addEventListener("click", loadPublished);
$("acSave").addEventListener("click", addAccount);

// --- Init --------------------------------------------------------------------
loadAccounts();
