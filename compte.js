/* =====================================================
   PAGE COMPTE : connexion, profil, historique, favoris
===================================================== */
(function () {
    "use strict";

    const root = document.getElementById("accountRoot");
    const intro = document.getElementById("accountIntro");
    let tab = "login";
    let info = "";
    let token = 0;

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const icon = cls => el("i", "fa-solid " + cls);
    const findManga = id => (window.MANGAS || []).find(m => m.id === id);

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

    function field(label, type, name, autocomplete) {
        const wrap = document.createDocumentFragment();
        const l = el("label", null, label);
        l.htmlFor = "f-" + name;
        const i = el("input");
        i.id = "f-" + name; i.name = name; i.type = type; i.required = true;
        i.autocomplete = autocomplete;
        if (type === "email") i.inputMode = "email";
        wrap.append(l, i);
        return wrap;
    }

    /* ---------- Connexion / inscription ---------- */
    function authView() {
        const signup = tab === "signup";
        const { s, box } = section(signup ? "fa-user-plus" : "fa-right-to-bracket", signup ? "CRÉER UN COMPTE" : "CONNEXION");

        const tabs = el("div", "auth-tabs");
        tabs.setAttribute("role", "tablist");
        [["login", "Connexion"], ["signup", "Créer un compte"]].forEach(([key, label]) => {
            const b = el("button", null, label);
            b.type = "button";
            b.setAttribute("role", "tab");
            b.setAttribute("aria-selected", String(tab === key));
            b.addEventListener("click", () => { tab = key; info = ""; render(); });
            tabs.append(b);
        });

        const form = el("form", "auth-form");
        form.noValidate = false;
        if (info) { const p = el("p", "auth-info", info); p.setAttribute("role", "status"); form.append(p); }
        if (signup) form.append(field("Pseudo", "text", "pseudo", "nickname"));
        form.append(field("Adresse e-mail", "email", "email", "email"));
        form.append(field("Mot de passe", "password", "password", signup ? "new-password" : "current-password"));

        const err = el("p", "auth-error");
        err.setAttribute("role", "alert");
        const submit = el("button", "btn-main", signup ? "Créer mon compte" : "Se connecter");
        submit.type = "submit";
        form.append(err, submit);

        form.addEventListener("submit", async e => {
            e.preventDefault();
            err.textContent = "";
            submit.disabled = true;
            const v = name => (form.elements[name] ? form.elements[name].value : "");
            try {
                if (signup) {
                    const r = await Mbokal.signUp(v("email"), v("password"), v("pseudo"));
                    if (r && r.confirm) {
                        tab = "login";
                        info = "Compte créé. Ouvre l'e-mail de confirmation, puis connecte-toi.";
                        render();
                        return;
                    }
                } else {
                    await Mbokal.signIn(v("email"), v("password"));
                }
                info = "";
                render();
            } catch (ex) {
                err.textContent = ex.message;
                submit.disabled = false;
            }
        });

        box.append(tabs, form);
        if (Mbokal.mode === "local") {
            box.append(el("p", "auth-note", "Mode démo : ton compte reste sur cet appareil. La synchronisation entre appareils arrivera avec la base de données en ligne."));
        } else {
            box.append(el("p", "auth-note", "Tes favoris et ta progression ajoutés avant la connexion seront conservés."));
        }
        return s;
    }

    /* ---------- Espace connecté ---------- */
    function profileView(user) {
        const { s, box } = section("fa-user", "MON PROFIL");
        const nm = el("p", "profile-name", user.pseudo), ml = el("p", "profile-mail", user.email);
        nm.setAttribute("translate", "no"); ml.setAttribute("translate", "no");
        box.append(nm, ml);
        const out = el("button", "btn-soft", "Se déconnecter");
        out.type = "button";
        out.addEventListener("click", async () => { await Mbokal.signOut(); info = ""; tab = "login"; render(); });
        box.append(out);
        return s;
    }

    function historyView(progress) {
        const { s, box } = section("fa-clock-rotate-left", "CONTINUER LA LECTURE");
        const entries = Object.keys(progress)
            .map(id => ({ id, e: progress[id], m: findManga(id) }))
            .filter(x => x.m)
            .sort((a, b) => (b.e.maj || 0) - (a.e.maj || 0));

        if (!entries.length) {
            const p = el("p", "empty-note", "Rien à reprendre pour l'instant. Ouvre un manga : ta progression apparaît ici. ");
            const a = el("a", null, "Voir les mangas");
            a.href = "decouvrir.html";
            p.append(a);
            box.append(p);
            return s;
        }
        const ul = el("ul", "row-list");
        entries.forEach(({ id, e, m }) => {
            const li = el("li");
            const text = el("div", "row-text");
            text.append(el("strong", null, m.titre), el("span", null, "Chapitre " + e.chapitre + " • page " + ((e.page || 0) + 1)));
            const a = el("a", "row-action");
            a.href = "lecteur.html?manga=" + encodeURIComponent(id) + "&chapitre=" + e.chapitre + "&page=" + ((e.page || 0) + 1);
            a.append(icon("fa-play"), " Reprendre");
            li.append(text, a);
            ul.append(li);
        });
        box.append(ul);
        return s;
    }

    function favoritesView(favs) {
        const { s, box } = section("fa-heart", "MES FAVORIS");
        const list = favs.map(id => findManga(id)).filter(Boolean);
        if (!list.length) {
            const p = el("p", "empty-note", "Appuie sur le « + » d'une couverture pour l'ajouter ici. ");
            const a = el("a", null, "Voir les mangas");
            a.href = "decouvrir.html";
            p.append(a);
            box.append(p);
            return s;
        }
        const ul = el("ul", "row-list");
        list.forEach(m => {
            const li = el("li");
            const text = el("div", "row-text");
            text.append(el("strong", null, m.titre), el("span", null, m.genres));
            const read = el("a", "row-action");
            read.href = "lecteur.html?manga=" + encodeURIComponent(m.id);
            read.append(icon("fa-play"), " Lire");
            const rm = el("button", "row-icon");
            rm.type = "button";
            rm.setAttribute("aria-label", "Retirer " + m.titre + " des favoris");
            rm.append(icon("fa-xmark"));
            rm.addEventListener("click", async () => {
                try { await Mbokal.toggleFavorite(m.id); Mbokal.toast("Retiré de tes favoris"); render(); }
                catch (e) { Mbokal.toast("Impossible de modifier les favoris. Réessaie."); }
            });
            li.append(text, read, rm);
            ul.append(li);
        });
        box.append(ul);
        return s;
    }

    function teamView(isAdmin) {
        const { s, box } = section("fa-pen-ruler", "ESPACE ÉQUIPE");
        box.append(el("p", "empty-note", "Publie tes chapitres, ajoute tes pages et relis tes brouillons."));
        const a = el("a", "btn-main", "Ouvrir l'atelier");
        a.href = "atelier.html";
        a.style.cssText = "display:block;text-align:center;margin-top:12px;";
        box.append(a);
        if (isAdmin) {
            const note = el("p", "empty-note", "Administration : équipe, signalements et chiffres.");
            note.style.marginTop = "16px";
            box.append(note);
            const b = el("a", "btn-soft", "Ouvrir l'administration");
            b.href = "admin.html";
            b.style.cssText = "display:block;text-align:center;margin-top:12px;";
            box.append(b);
        }
        return s;
    }

    /* ---------- Rendu ---------- */
    async function render() {
        const mine = ++token;
        await Mbokal.ready;
        if (window.Catalog) { try { await Catalog.ready; } catch (e) { /* catalogue de départ */ } }
        const user = Mbokal.user();
        const frag = document.createDocumentFragment();

        if (!user) {
            intro.textContent = "Connecte-toi pour retrouver tes favoris et ta progression sur tous tes appareils.";
            frag.append(authView());
        } else {
            intro.textContent = "Bonjour " + user.pseudo + ".";
            let progress = {}, favs = [];
            try { [progress, favs] = await Promise.all([Mbokal.progress(), Mbokal.favorites()]); }
            catch (e) { Mbokal.toast("Impossible de charger tes données. Réessaie."); }
            let team = false, adm = false;
            try { team = window.Catalog ? await Catalog.admin.isTeam() : false; } catch (e) { /* pas de lien équipe */ }
            try { adm = await Mbokal.isAdmin(); } catch (e) { /* pas de lien administration */ }
            frag.append(profileView(user), historyView(progress), favoritesView(favs));
            if (team || adm) frag.append(teamView(adm));
        }
        if (mine === token) root.replaceChildren(frag);   // ignore un rendu devenu obsolète
    }

    Mbokal.onChange(() => { render(); });
    render();
})();
