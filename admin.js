/* =====================================================
   ADMINISTRATION : chiffres, équipe, signalements
   Réservé aux comptes dont le rôle est « admin ».
   Tout le texte affiché passe par textContent.
===================================================== */
(function () {
    "use strict";

    const root = document.getElementById("adminRoot");
    const intro = document.getElementById("adminIntro");
    let token = 0;

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const icon = cls => el("i", "fa-solid " + cls);
    const toast = t => Mbokal.toast(t);

    function section(iconClass, title) {
        const s = el("section", "content-section");
        const bar = el("div", "identity-bar");
        const h = el("h2");
        h.append(icon(iconClass), " " + title);
        bar.append(h);
        const box = el("div", "page-box");
        s.append(bar, box);
        return { s, box };
    }

    function gate(text, href, label) {
        const { s, box } = section("fa-lock", "ACCÈS");
        box.append(el("p", "empty-note", text));
        if (href) {
            const a = el("a", "btn-main", label);
            a.href = href;
            a.style.cssText = "display:block;text-align:center;margin-top:14px;";
            box.append(a);
        }
        return s;
    }

    const titleOf = id => { const m = (window.MANGAS || []).find(x => x.id === id); return m ? m.titre : id; };
    const when = v => { const d = new Date(v); return isNaN(d) ? "" : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); };

    /* ---------- Chiffres ---------- */
    async function statsView() {
        const { s, box } = section("fa-chart-simple", "CHIFFRES (TOUT LE TEMPS)");
        let rows = [];
        try { rows = await Mbokal.stats.top("tout"); } catch (ex) { box.append(el("p", "empty-note", ex.message)); return s; }
        rows.sort((a, b) => b.vues - a.vues);
        const wrap = el("div", "adm-scroll");
        const table = el("table", "adm-table");
        const thead = el("thead"), hr = el("tr");
        ["Manga", "Vues", "Lus", "♥", "👍", "👎"].forEach(h => hr.append(el("th", null, h)));
        thead.append(hr);
        const tb = el("tbody");
        rows.forEach(r => {
            const tr = el("tr");
            [titleOf(r.manga_id), r.vues, r.lus, r.favoris, r.likes, r.dislikes].forEach(v => tr.append(el("td", null, String(v))));
            tb.append(tr);
        });
        table.append(thead, tb);
        wrap.append(table);
        box.append(wrap);
        return s;
    }

    /* ---------- Équipe ---------- */
    async function teamView(me) {
        const { s, box } = section("fa-users", "ÉQUIPE");
        let members = [];
        try { members = await Mbokal.admin.team(); } catch (ex) { box.append(el("p", "empty-note", ex.message)); return s; }

        const ul = el("ul", "row-list");
        members.forEach(u => {
            const li = el("li");
            li.style.flexWrap = "wrap";
            const text = el("div", "row-text");
            text.append(el("strong", null, u.pseudo || u.email), el("span", null, u.email + " · " + (u.role === "admin" ? "Administrateur" : "Artiste")));
            li.append(text);
            const acts = el("div", "adm-row-actions");
            acts.style.width = "100%";
            const toggle = el("button", null, u.role === "admin" ? "Passer artiste" : "Passer admin");
            toggle.type = "button";
            toggle.addEventListener("click", async () => {
                try { await Mbokal.admin.addMember(u.email, u.role === "admin" ? "artiste" : "admin"); toast("Rôle modifié"); render(); }
                catch (ex) { toast(ex.message); }
            });
            const rm = el("button", "danger", "Retirer");
            rm.type = "button";
            rm.addEventListener("click", async () => {
                if (!confirm("Retirer " + (u.pseudo || u.email) + " de l'équipe ?")) return;
                try { await Mbokal.admin.removeMember(u.user_id); toast("Membre retiré"); render(); }
                catch (ex) { toast(ex.message); }
            });
            acts.append(toggle, rm);
            li.append(acts);
            ul.append(li);
        });
        box.append(ul);

        const form = el("form", "at-form");
        form.style.marginTop = "18px";
        const l1 = el("label", null, "Ajouter un membre (e-mail de son compte)");
        l1.htmlFor = "tm-mail";
        const mail = el("input");
        mail.id = "tm-mail"; mail.type = "email"; mail.required = true; mail.autocomplete = "off";
        const l2 = el("label", null, "Rôle");
        l2.htmlFor = "tm-role";
        const role = el("select");
        role.id = "tm-role";
        [["artiste", "Artiste (publie des chapitres)"], ["admin", "Administrateur (tous les droits)"]].forEach(([v, t]) => { const o = el("option", null, t); o.value = v; role.append(o); });
        const err = el("p", "auth-error");
        err.setAttribute("role", "alert");
        const send = el("button", "btn-soft", "Ajouter à l'équipe");
        send.type = "submit";
        form.append(l1, mail, l2, role, err, send);
        form.addEventListener("submit", async e => {
            e.preventDefault();
            err.textContent = "";
            send.disabled = true;
            try { await Mbokal.admin.addMember(mail.value.trim(), role.value); toast("Membre ajouté"); render(); }
            catch (ex) { err.textContent = ex.message; send.disabled = false; }
        });
        box.append(form);
        return s;
    }

    /* ---------- Signalements ---------- */
    async function reportsView() {
        const { s, box } = section("fa-flag", "COMMENTAIRES SIGNALÉS");
        let rows = [];
        try { rows = await Mbokal.admin.reports(); } catch (ex) { box.append(el("p", "empty-note", ex.message)); return s; }
        if (!rows.length) { box.append(el("p", "empty-note", "Aucun signalement pour l'instant.")); return s; }
        rows.forEach(r => {
            const item = el("div", "adm-report");
            const meta = el("div", "adm-meta");
            meta.textContent = r.pseudo + " · " + titleOf(r.manga_id) + " · chapitre " + r.chapitre + " · " + r.nb + " signalement" + (r.nb > 1 ? "s" : "") + (r.masque ? " · MASQUÉ" : "");
            item.append(meta, el("p", null, r.texte));
            const acts = el("div", "adm-row-actions");
            const act = (label, action, danger, ok) => {
                const b = el("button", danger ? "danger" : null, label);
                b.type = "button";
                b.addEventListener("click", async () => {
                    if (action === "supprimer" && !confirm("Supprimer ce commentaire (et ses réponses) ?")) return;
                    try { await Mbokal.admin.moderate(r.comment_id, action); toast(ok); render(); }
                    catch (ex) { toast(ex.message); }
                });
                return b;
            };
            acts.append(
                r.masque ? act("Réafficher", "afficher", false, "Commentaire réaffiché") : act("Masquer", "masquer", false, "Commentaire masqué"),
                act("Supprimer", "supprimer", true, "Commentaire supprimé"),
                act("Ignorer le signalement", "ignorer", false, "Signalement ignoré"));
            item.append(acts);
            box.append(item);
        });
        return s;
    }

    /* ---------- Rendu ---------- */
    async function render() {
        const mine = ++token;
        await Mbokal.ready;
        try { await Catalog.ready; } catch (e) { /* catalogue de départ */ }
        let frag = document.createDocumentFragment();
        const user = Mbokal.user();
        if (!user) {
            intro.textContent = "Espace réservé aux administrateurs.";
            frag.append(gate("Connecte-toi avec ton compte administrateur.", "compte.html", "Se connecter"));
        } else if (!(await Mbokal.isAdmin())) {
            intro.textContent = "Espace réservé aux administrateurs.";
            frag.append(gate("Ton compte n'est pas administrateur. Un administrateur peut te donner ce rôle."));
        } else {
            intro.textContent = "Chiffres, équipe et modération.";
            const parts = await Promise.all([statsView(), reportsView(), teamView(user)]);
            parts.forEach(p => frag.append(p));
            if (Mbokal.mode === "local") frag.append(el("p", "auth-note", "Mode démo : les chiffres et les signalements viennent de cet appareil. La gestion de l'équipe demande la base en ligne."));
        }
        if (mine === token) root.replaceChildren(frag);
    }

    Mbokal.onChange(() => { render(); });
    render();
})();
