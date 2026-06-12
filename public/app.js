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
    const warn = $("acProxyWarn");
    if (warn) warn.hidden = data.proxyAuto !== false;
    renderAccountsView(accounts);
  } catch {
    /* ignore */
  }
}

const COUNTRY_LABEL = {
  us: "🇺🇸 US",
  fr: "🇫🇷 FR",
  gb: "🇬🇧 UK",
  de: "🇩🇪 DE",
  es: "🇪🇸 ES",
  it: "🇮🇹 IT",
  ca: "🇨🇦 CA",
  nl: "🇳🇱 NL",
  be: "🇧🇪 BE",
};

function renderAccountsView(accounts) {
  const list = $("accountsList");
  if (!list) return;
  list.innerHTML = accounts
    .map((a) => {
      const rot = a.ipRotation > 0 ? ` · IP #${a.ipRotation}` : "";
      const proxyTag = a.proxyCountry
        ? `IP dédiée ${COUNTRY_LABEL[a.proxyCountry] || a.proxyCountry.toUpperCase()} ✓${rot}`
        : a.hasProxy
          ? `proxy ✓${rot}`
          : "sans proxy";
      const tags = [
        a.redditUsername ? `u/${esc(a.redditUsername)}` : "pseudo non défini",
        proxyTag,
        a.hasCredentials ? "identifiants ✓" : "sans identifiants",
      ]
        .map((t) => `<span class="chip">${t}</span>`)
        .join("");
      const proxyBtn = a.hasProxy
        ? `<button class="btn-link" data-proxy="${esc(a.id)}" title="Se connecter en local via l'IP dédiée de ce compte">Connexion locale</button>`
        : "";
      const rotateBtn = a.hasProxy
        ? `<button class="btn-link" data-rotate="${esc(a.id)}" title="Change l'IP résidentielle si l'actuelle est bloquée par Reddit">Changer d'IP</button>`
        : "";
      const del = a.removable
        ? `<button class="btn-link-danger" data-del="${esc(a.id)}">Supprimer</button>`
        : '<span class="muted-p" style="margin:0">env</span>';
      const st = a.state || {};
      let dotCls = "ind--unknown";
      let stateText = "Session non vérifiée";
      if (st.checkedAt) {
        if (st.loggedIn) {
          dotCls = "ind--ok";
          stateText = `Session active${st.user ? ` · u/${esc(st.user)}` : ""}`;
        } else {
          dotCls = "ind--err";
          stateText = "Session expirée — reconnexion locale requise";
        }
      }
      const indicator = `<div class="account-state"><span class="ind ${dotCls}"></span><span>${stateText}</span><button class="btn-link" data-check="${esc(a.id)}">Vérifier</button></div>`;
      return `<div class="account-card${a.id === currentAccountId ? " is-current" : ""}">
        <div class="account-card-top">
          <strong>${esc(a.label)}</strong>
          <button class="btn btn-ghost btn-sm" data-use="${esc(a.id)}">Utiliser</button>
        </div>
        <div class="reco-meta">${tags}</div>
        ${indicator}
        <div class="account-card-foot">${proxyBtn}${rotateBtn}${del}</div>
      </div>`;
    })
    .join("");
}

$("accountsList").addEventListener("click", async (e) => {
  const use = e.target.closest("[data-use]");
  const del = e.target.closest("[data-del]");
  const rotate = e.target.closest("[data-rotate]");
  const proxy = e.target.closest("[data-proxy]");
  const check = e.target.closest("[data-check]");
  if (use) {
    currentAccountId = use.getAttribute("data-use");
    $("accountSelect").value = currentAccountId;
    renderAccountsView((await api("/api/accounts")).accounts || []);
  } else if (check) {
    const id = check.getAttribute("data-check");
    check.disabled = true;
    check.textContent = "Vérification…";
    try {
      await api(`/api/status?account=${encodeURIComponent(id)}`);
    } catch {
      /* l'état est lu juste après via loadAccounts */
    }
    await loadAccounts();
  } else if (proxy) {
    openProxyConfig(proxy.getAttribute("data-proxy"));
  } else if (rotate) {
    const id = rotate.getAttribute("data-rotate");
    rotate.disabled = true;
    rotate.textContent = "Changement…";
    try {
      openLogs();
      const r = await api(`/api/accounts/${encodeURIComponent(id)}/rotate-ip`, { method: "POST" });
      await loadAccounts();
      alert(`Nouvelle IP attribuée (rotation #${r.rotation}). Relance « Se connecter (manuel) » pour tester cette IP.`);
    } catch (err) {
      alert(err.message);
      rotate.disabled = false;
      rotate.textContent = "Changer d'IP";
    }
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
        ...($("acCountry").value ? { proxyCountry: $("acCountry").value } : {}),
        username: $("acUser").value.trim(),
        password: $("acPass").value,
        totpSecret: $("acTotp").value.trim(),
      }),
    });
    ["acLabel", "acReddit", "acUser", "acPass", "acTotp"].forEach((id) => ($(id).value = ""));
    $("acCountry").value = "us";
    $("acError").hidden = true;
    loadAccounts();
  } catch (e) {
    $("acError").textContent = e.message;
    $("acError").hidden = false;
  } finally {
    $("acSave").disabled = false;
  }
}

// --- Connexion locale via l'IP dédiée (config proxy + script de lancement) ----
let proxyCfg = null;

async function openProxyConfig(id) {
  try {
    const cfg = await api(`/api/accounts/${encodeURIComponent(id)}/proxy-config`);
    proxyCfg = cfg;
    $("proxyAccLabel").textContent = cfg.label;
    $("proxyCmd").textContent = buildTerminalCommand(cfg);
    $("proxyServer").textContent = cfg.server;
    $("proxyUser").textContent = cfg.username;
    $("proxyPass").textContent = cfg.password;
    $("proxyModal").hidden = false;
  } catch (e) {
    alert(e.message);
  }
}

/** Commande Terminal (Mac) : profil Chrome persistant par compte + sortie via l'IP Decodo. */
function buildTerminalCommand(cfg) {
  return (
    `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome ` +
    `--user-data-dir="$HOME/.reddit-profiles/${cfg.id}" ` +
    `--proxy-server="${cfg.server}" "https://www.reddit.com"`
  );
}

/** Script .command (Mac) : ouvre un Chrome dédié au compte, sortant par son IP Decodo. */
function buildLaunchScript(cfg) {
  const profile = cfg.id;
  return [
    "#!/bin/bash",
    `# === Connexion Reddit isolée — ${cfg.label} ===`,
    "# Ouvre un Chrome dédié à ce compte, qui sort par son IP résidentielle Decodo.",
    "# Profil séparé = ce compte n'est pas relié aux autres.",
    "#",
    "# Quand Chrome demande les identifiants du PROXY, saisis :",
    `#   Utilisateur : ${cfg.username}`,
    `#   Mot de passe : ${cfg.password}`,
    "",
    'PROFILE="$HOME/.reddit-profiles/' + profile + '"',
    'mkdir -p "$PROFILE"',
    'CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
    'if [ ! -x "$CHROME" ]; then echo "Google Chrome introuvable dans /Applications."; read -n1 -r; exit 1; fi',
    `echo "Compte : ${cfg.label}"`,
    `echo "Proxy  : ${cfg.server}"`,
    `echo "User   : ${cfg.username}"`,
    `echo "Pass   : ${cfg.password}"`,
    'echo "→ Colle ces identifiants quand Chrome demande le proxy, puis connecte-toi à Reddit."',
    `"$CHROME" --user-data-dir="$PROFILE" --proxy-server="${cfg.server}" --no-first-run --no-default-browser-check "https://www.reddit.com/login/"`,
    "",
  ].join("\n");
}

function downloadLaunchScript() {
  if (!proxyCfg) return;
  const blob = new Blob([buildLaunchScript(proxyCfg)], { type: "application/x-sh" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `connexion-${proxyCfg.id}.command`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyValue(id) {
  try {
    await navigator.clipboard.writeText($(id).textContent || "");
  } catch {
    /* ignore */
  }
}

$("proxyClose").addEventListener("click", () => ($("proxyModal").hidden = true));
$("proxyDownload").addEventListener("click", downloadLaunchScript);
$("proxyModal").addEventListener("click", (e) => {
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    copyValue(copy.getAttribute("data-copy"));
    const prev = copy.textContent;
    copy.textContent = "Copié ✓";
    setTimeout(() => (copy.textContent = prev), 1200);
  } else if (e.target === $("proxyModal")) {
    $("proxyModal").hidden = true;
  }
});

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
// --- État de connexion -------------------------------------------------------
async function loadStatus() {
  const el = $("status");
  try {
    const d = await api(`/api/status${accountQuery()}`);
    if (d.switching) {
      el.textContent = "Changement…";
      el.className = "status status--unknown";
    } else if (d.loggedIn) {
      el.textContent = `Connecté : u/${d.user}`;
      el.className = "status status--ok";
      el.title = "";
      $("reconnect").hidden = true;
    } else {
      el.textContent = "Non connecté";
      el.className = "status status--err";
      el.title = d.error || "";
      $("reconnect").hidden = true; // auto-login désactivé (brûlait les comptes)
      $("manualLogin").hidden = false;
    }
    if (d.loggedIn) $("manualLogin").hidden = true;
  } catch {
    el.textContent = "statut indisponible";
    el.className = "status status--err";
  }
}

// --- Logs en direct ----------------------------------------------------------
let logSince = 0;
let logTimer = null;

async function pollLogs() {
  try {
    const d = await api(`/api/logs?since=${logSince}`);
    if (d.lines && d.lines.length) {
      const pre = $("logContent");
      for (const l of d.lines) {
        const time = new Date(l.t).toLocaleTimeString("fr-FR");
        pre.textContent += `${time}  ${l.msg}\n`;
      }
      logSince = d.last;
      pre.scrollTop = pre.scrollHeight;
    }
  } catch {
    /* ignore */
  }
}

function openLogs() {
  $("logDrawer").hidden = false;
  if (!logTimer) {
    pollLogs();
    logTimer = setInterval(pollLogs, 1200);
  }
}
function closeLogs() {
  $("logDrawer").hidden = true;
  if (logTimer) {
    clearInterval(logTimer);
    logTimer = null;
  }
}
function toggleLogs() {
  if ($("logDrawer").hidden) openLogs();
  else closeLogs();
}

async function reconnect() {
  openLogs(); // affiche les logs en direct pendant la reconnexion
  $("reconnect").disabled = true;
  $("reconnect").textContent = "Reconnexion…";
  try {
    const d = await api(`/api/reconnect${accountQuery()}`, { method: "POST" });
    if (!d.ok) {
      const shot = d.screenshotFile ? `\n\nCapture de diagnostic : /screenshots/${d.screenshotFile}` : "";
      alert(
        `Reconnexion échouée : ${d.error || "inconnue"}${shot}\n\n` +
          "Regarde les logs en direct ci-dessous. Si ça persiste (CAPTCHA/anti-bot), recapture une session en local : npm run login.",
      );
    }
  } catch (e) {
    alert(e.message);
  } finally {
    $("reconnect").disabled = false;
    $("reconnect").textContent = "Se reconnecter";
    loadStatus();
  }
}

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

async function loadReco(force) {
  $("loadReco").disabled = true;
  $("refreshReco").disabled = true;
  $("recoStatus").textContent = force
    ? "Re-scan de Reddit en cours… (~20-40 s)"
    : "Chargement…";
  $("recoList").innerHTML = "";
  try {
    const sep = accountQuery() ? "&" : "?";
    const data = await api(`/api/recommendations${accountQuery()}${sep}stream=${currentStream}${force ? "&refresh=1" : ""}`);
    const recos = data.recommendations || [];
    const when = data.generatedAt ? new Date(data.generatedAt).toLocaleString("fr-FR") : "";
    $("recoStatus").textContent = recos.length
      ? `${recos.length} threads · généré le ${when}${data.cached ? " (cache)" : ""}`
      : "Aucun thread ne correspond — clique « Actualiser » (nécessite une session connectée pour le flux Dayuse).";
    $("recoList").innerHTML = recos.map((r, i) => recoCard(r, i)).join("");
    if (recos[0]) autoDraftFirst(recos[0]); // pré-brouillon du 1er thread
  } catch (e) {
    $("recoStatus").textContent = `Erreur : ${e.message}`;
  } finally {
    $("loadReco").disabled = false;
    $("refreshReco").disabled = false;
  }
}

function recoCard(r, i) {
  const chips = (r.reasons || []).map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  const card = `<div class="reco">
    <div class="reco-main">
      <a class="reco-title" href="${esc(r.permalink)}" target="_blank">${esc(r.title)}</a>
      <div class="reco-meta">r/${esc(r.subreddit)} · ${r.ageHours}h · ${r.commentsCount} comm. · ${r.score} pts ${chips}</div>
    </div>
    <button class="btn btn-primary btn-sm" data-prepare='${esc(JSON.stringify({ url: r.permalink, title: r.title, subreddit: r.subreddit }))}'>Préparer une réponse</button>
  </div>`;
  if (i === 0) {
    return card + `<div class="reco-inline" id="recoInline0"><span class="muted-p" style="margin:0">✨ Génération du brouillon…</span></div>`;
  }
  return card;
}

// Pré-brouillon automatique du 1er thread (contexte + IA), avec bouton Publier.
async function autoDraftFirst(r) {
  const box = $("recoInline0");
  if (!box) return;
  try {
    const sep = accountQuery() ? "&" : "?";
    const ctx = await api(`/api/thread-context${accountQuery()}${sep}url=${encodeURIComponent(r.permalink)}`).catch(() => ({}));
    const draft = await api("/api/draft-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: ctx.title || r.title,
        subreddit: ctx.subreddit || r.subreddit,
        body: ctx.body || "",
        comments: ctx.comments || [],
      }),
    });
    renderInlineDraft(box, r, draft.text || "");
  } catch (e) {
    box.innerHTML = `<span class="muted-p" style="margin:0">Brouillon IA indisponible : ${esc(e.message)}</span>`;
  }
}

function renderInlineDraft(box, r, text) {
  box.innerHTML = `<textarea class="inline-text" rows="4"></textarea>
    <div class="draft-actions">
      <button class="btn btn-primary btn-sm" data-inline="publish">Publier sur Reddit</button>
      <button class="btn btn-ghost btn-sm" data-inline="copy">Copier</button>
      <button class="btn btn-ghost btn-sm" data-inline="save">Enregistrer le brouillon</button>
      <a class="btn btn-ghost btn-sm" href="${esc(r.permalink)}" target="_blank">Ouvrir le post</a>
    </div>`;
  box.querySelector(".inline-text").value = text;
  box.querySelector('[data-inline="publish"]').onclick = () => inlinePublish(box, r);
  box.querySelector('[data-inline="copy"]').onclick = (e) => {
    navigator.clipboard.writeText(box.querySelector(".inline-text").value);
    e.target.textContent = "Copié ✓";
    setTimeout(() => (e.target.textContent = "Copier"), 1500);
  };
  box.querySelector('[data-inline="save"]').onclick = () => inlineSave(box, r);
}

async function inlinePublish(box, r) {
  const text = box.querySelector(".inline-text").value.trim();
  const btn = box.querySelector('[data-inline="publish"]');
  btn.disabled = true;
  btn.textContent = "Publication…";
  try {
    await api("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: r.permalink, text, accountId: currentAccountId }),
    });
    box.innerHTML = '<span class="badge badge--ok">publié sur Reddit ✓</span>';
  } catch (e) {
    alert(`Échec de publication : ${e.message}\n\nReconnecte le compte (bouton en haut) puis réessaie, ou utilise « Copier » + « Ouvrir le post ».`);
    btn.disabled = false;
    btn.textContent = "Publier sur Reddit";
  }
}

async function inlineSave(box, r) {
  const text = box.querySelector(".inline-text").value.trim();
  try {
    await api("/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: currentAccountId, targetUrl: r.permalink, title: r.title, subreddit: r.subreddit, text, source: "generic" }),
    });
    box.querySelector('[data-inline="save"]').textContent = "Enregistré ✓";
  } catch (e) {
    alert(e.message);
  }
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
  renderComposerContext();
  $("composer").hidden = false;
  if (composerState.url) fetchComposerContext(composerState.url);
}

async function fetchComposerContext(url) {
  $("composerContext").innerHTML = '<div class="muted-p" style="margin:0">Lecture du thread (titre, corps, commentaires)…</div>';
  try {
    const sep = accountQuery() ? "&" : "?";
    const data = await api(`/api/thread-context${accountQuery()}${sep}url=${encodeURIComponent(url)}`);
    composerState.title = data.title || composerState.title;
    composerState.subreddit = data.subreddit || composerState.subreddit;
    composerState.body = data.body || "";
    composerState.comments = data.comments || [];
    renderComposerContext();
  } catch (e) {
    renderComposerContext(e.message);
  }
}

function renderComposerContext(err) {
  const s = composerState;
  if (!s.title && !s.url) {
    $("composerContext").innerHTML = `<div class="muted-p" style="margin:0">Réponse manuelle — colle l'URL ci-dessous puis « Brouillon IA » (le contexte sera lu automatiquement).</div>`;
    return;
  }
  let html = `<div class="reco-title">${esc(s.title || "(thread)")}</div><div class="reco-meta">r/${esc(s.subreddit || "")}</div>`;
  if (s.body) html += `<div class="ctx-body">${esc(s.body.slice(0, 400))}${s.body.length > 400 ? "…" : ""}</div>`;
  if (s.comments && s.comments.length) html += `<div class="muted-p" style="margin:6px 0 0">✓ ${s.comments.length} commentaires lus (ton/humour)</div>`;
  if (err) html += `<div class="muted-p" style="margin:6px 0 0">Contexte indisponible (${esc(err)}) — réponse basée sur le titre.</div>`;
  $("composerContext").innerHTML = html;
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
    // Si pas encore de contexte mais une URL est saisie, on le lit d'abord.
    const url = $("composerUrl").value.trim();
    if (url && (!composerState.comments || composerState.url !== url)) {
      composerState.url = url;
      await fetchComposerContext(url);
    }
    const data = await api("/api/draft-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: composerState.title || "(post Reddit)",
        subreddit: composerState.subreddit || "AskReddit",
        body: composerState.body || "",
        comments: composerState.comments || [],
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
  loadStatus();
  loadDrafts();
});
$("reconnect").addEventListener("click", reconnect);
let vncStatusPoll = null;
// « Se connecter » = la méthode qui marche : connexion locale (vrai navigateur +
// IP dédiée du compte). L'ancien navigateur distant (noVNC) est abandonné car
// détecté par Reddit et instable en conteneur.
$("manualLogin").addEventListener("click", () => {
  if (!currentAccountId) {
    alert("Choisis d'abord un compte en haut à droite.");
    return;
  }
  openProxyConfig(currentAccountId);
});
function closeVnc() {
  $("vncModal").hidden = true;
  $("vncFrameWrap").innerHTML = ""; // coupe le flux
  if (vncStatusPoll) {
    clearInterval(vncStatusPoll);
    vncStatusPoll = null;
  }
  loadStatus();
}
$("vncClose").addEventListener("click", closeVnc);
$("logsToggle").addEventListener("click", toggleLogs);
$("logClose").addEventListener("click", closeLogs);
$("logClear").addEventListener("click", () => {
  $("logContent").textContent = "";
});
$("loadReco").addEventListener("click", () => loadReco(false));
$("refreshReco").addEventListener("click", () => loadReco(true));
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
loadAccounts().then(() => {
  loadStatus();
  loadReco(false); // charge les recos (cache chaud) sans attendre
});
setInterval(loadStatus, 30000);
