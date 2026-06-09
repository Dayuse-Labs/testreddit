"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  status: $("status"),
  switchAccount: $("switchAccount"),
  url: $("url"),
  loadPreview: $("loadPreview"),
  previewError: $("previewError"),
  preview: $("preview"),
  text: $("text"),
  charCount: $("charCount"),
  reviewed: $("reviewed"),
  publish: $("publish"),
  sendAt: $("sendAt"),
  scheduleBtn: $("scheduleBtn"),
  result: $("result"),
  refreshHistory: $("refreshHistory"),
  historyBody: document.querySelector("#history tbody"),
  refreshSchedule: $("refreshSchedule"),
  scheduleBody: document.querySelector("#schedule tbody"),
};

let previewLoaded = false;

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Erreur ${response.status}`);
  }
  return data;
}

// --- Statut de connexion -----------------------------------------------------
async function loadStatus() {
  try {
    const data = await api("/api/status");
    // En mode serveur, le changement de compte se fait via la session injectée.
    els.switchAccount.hidden = Boolean(data.remote);
    if (data.switching) {
      els.status.textContent = "Changement de compte… connecte-toi dans la fenêtre";
      els.status.className = "status status--unknown";
    } else if (data.loggedIn) {
      els.status.textContent = `Connecté : u/${data.user}`;
      els.status.className = "status status--ok";
    } else {
      els.status.textContent = "Non connecté";
      els.status.className = "status status--err";
    }
  } catch {
    els.status.textContent = "Statut indisponible";
    els.status.className = "status status--err";
  }
}

async function switchAccount() {
  if (!confirm("Se déconnecter du compte actuel et ouvrir une fenêtre pour se connecter à un autre compte ?")) {
    return;
  }
  els.switchAccount.disabled = true;
  els.switchAccount.textContent = "Ouverture…";
  try {
    await api("/api/switch-account", { method: "POST" });
    // Sonde le statut jusqu'à reconnexion (la fenêtre de login est ouverte).
    const poll = setInterval(async () => {
      await loadStatus();
      const data = await api("/api/status").catch(() => null);
      if (data && !data.switching) clearInterval(poll);
    }, 3000);
  } catch (error) {
    alert(`Erreur : ${error.message}`);
  } finally {
    els.switchAccount.disabled = false;
    els.switchAccount.textContent = "Changer de compte";
  }
}

// --- Aperçu du fil -----------------------------------------------------------
async function loadPreview() {
  const url = els.url.value.trim();
  els.previewError.hidden = true;
  els.preview.hidden = true;
  previewLoaded = false;
  refreshActionState();

  if (!url) return;

  els.loadPreview.disabled = true;
  els.loadPreview.textContent = "Chargement…";
  try {
    const p = await api("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    let html = `<h3>${escapeHtml(p.post.title)}</h3>`;
    html += `<div class="sub">${escapeHtml(p.subreddit)} · u/${escapeHtml(p.post.author)} · ${p.post.score} pts · réponse à ${p.target.type === "comment" ? "un commentaire" : "le post"}</div>`;
    if (p.post.body) html += `<div class="body">${escapeHtml(p.post.body)}</div>`;
    if (p.comment) {
      html += `<div class="target"><strong>u/${escapeHtml(p.comment.author)}</strong> · ${p.comment.score} pts<br>${escapeHtml(p.comment.body)}</div>`;
    }
    els.preview.innerHTML = html;
    els.preview.hidden = false;
    previewLoaded = true;
  } catch (error) {
    els.previewError.textContent = error.message;
    els.previewError.hidden = false;
  } finally {
    els.loadPreview.disabled = false;
    els.loadPreview.textContent = "Charger l'aperçu";
    refreshActionState();
  }
}

// --- État des boutons d'action ----------------------------------------------
function baseReady() {
  return previewLoaded && els.reviewed.checked && els.text.value.trim().length > 0;
}

function refreshActionState() {
  els.publish.disabled = !baseReady();
  els.scheduleBtn.disabled = !(baseReady() && els.sendAt.value.length > 0);
}

// --- Publication immédiate ---------------------------------------------------
async function publish() {
  const url = els.url.value.trim();
  const text = els.text.value.trim();
  els.result.hidden = true;
  els.publish.disabled = true;
  els.publish.textContent = "Publication…";

  try {
    await api("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, text }),
    });
    showResult(true, "✅ Réponse publiée.");
    resetForm();
    await loadHistory();
  } catch (error) {
    showResult(false, `❌ Échec : ${error.message}`);
    await loadHistory();
  } finally {
    els.publish.textContent = "Publier maintenant";
    refreshActionState();
  }
}

// --- Programmation -----------------------------------------------------------
async function schedule() {
  const url = els.url.value.trim();
  const text = els.text.value.trim();
  const localValue = els.sendAt.value;
  if (!localValue) return;
  const sendAt = new Date(localValue).toISOString();

  els.result.hidden = true;
  els.scheduleBtn.disabled = true;
  els.scheduleBtn.textContent = "Programmation…";

  try {
    await api("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, text, sendAt }),
    });
    showResult(true, `🕒 Envoi programmé pour le ${new Date(sendAt).toLocaleString("fr-FR")}.`);
    resetForm();
    await loadSchedule();
  } catch (error) {
    showResult(false, `❌ Échec : ${error.message}`);
  } finally {
    els.scheduleBtn.textContent = "Programmer l'envoi";
    refreshActionState();
  }
}

function showResult(ok, message) {
  els.result.className = ok ? "result result--ok" : "result result--err";
  els.result.textContent = message;
  els.result.hidden = false;
}

function resetForm() {
  els.text.value = "";
  els.reviewed.checked = false;
  els.sendAt.value = "";
  updateCharCount();
}

// --- Historique --------------------------------------------------------------
async function loadHistory() {
  try {
    const entries = await api("/api/history");
    els.historyBody.innerHTML = entries
      .map((e) => {
        const date = new Date(e.timestamp).toLocaleString("fr-FR");
        const badge =
          e.status === "success"
            ? '<span class="badge badge--ok">publié</span>'
            : '<span class="badge badge--err">échec</span>';
        const shot = e.screenshotFile
          ? `<a href="/screenshots/${encodeURIComponent(e.screenshotFile)}" target="_blank">voir</a>`
          : "—";
        const title = e.error ? ` title="${escapeHtml(e.error)}"` : "";
        return `<tr${title}>
          <td>${escapeHtml(date)}</td>
          <td>${e.type === "comment" ? "commentaire" : "post"}</td>
          <td><a href="${escapeHtml(e.targetUrl)}" target="_blank">lien</a></td>
          <td>${badge}</td>
          <td>${shot}</td>
        </tr>`;
      })
      .join("");
  } catch {
    /* silencieux */
  }
}

// --- Envois programmés -------------------------------------------------------
async function loadSchedule() {
  try {
    const items = await api("/api/schedule");
    els.scheduleBody.innerHTML = items
      .map((item) => {
        const due = new Date(item.sendAt).toLocaleString("fr-FR");
        let badge;
        if (item.status === "pending") badge = '<span class="badge badge--pending">en attente</span>';
        else if (item.status === "sent") badge = '<span class="badge badge--ok">envoyé</span>';
        else badge = '<span class="badge badge--err">échec</span>';

        const target = item.targetUrl || item.url;
        const cancel =
          item.status === "pending"
            ? `<button type="button" class="link-danger" data-cancel="${escapeHtml(item.id)}">annuler</button>`
            : "—";
        const title = item.error ? ` title="${escapeHtml(item.error)}"` : "";
        return `<tr${title}>
          <td>${escapeHtml(due)}</td>
          <td>${item.type === "comment" ? "commentaire" : "post"}</td>
          <td><a href="${escapeHtml(target)}" target="_blank">lien</a></td>
          <td>${badge}</td>
          <td>${cancel}</td>
        </tr>`;
      })
      .join("");
  } catch {
    /* silencieux */
  }
}

async function cancelSchedule(id) {
  try {
    await api(`/api/schedule/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadSchedule();
  } catch (error) {
    alert(`Erreur : ${error.message}`);
  }
}

function updateCharCount() {
  const n = els.text.value.length;
  els.charCount.textContent = `${n} caractère${n > 1 ? "s" : ""}`;
}

// --- Évènements --------------------------------------------------------------
els.switchAccount.addEventListener("click", switchAccount);
els.loadPreview.addEventListener("click", loadPreview);
els.url.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadPreview();
});
els.text.addEventListener("input", () => {
  updateCharCount();
  refreshActionState();
});
els.reviewed.addEventListener("change", refreshActionState);
els.sendAt.addEventListener("input", refreshActionState);
els.publish.addEventListener("click", publish);
els.scheduleBtn.addEventListener("click", schedule);
els.refreshHistory.addEventListener("click", loadHistory);
els.refreshSchedule.addEventListener("click", loadSchedule);
els.scheduleBody.addEventListener("click", (e) => {
  const id = e.target?.getAttribute?.("data-cancel");
  if (id) cancelSchedule(id);
});

// --- Init --------------------------------------------------------------------
loadStatus();
loadHistory();
loadSchedule();
updateCharCount();
// Rafraîchit périodiquement statut et envois programmés.
setInterval(loadStatus, 15000);
setInterval(loadSchedule, 20000);
