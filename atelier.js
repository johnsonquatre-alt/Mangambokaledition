/* =====================================================
   ATELIER — espace de l'équipe
   Créer un manga, ajouter des chapitres, envoyer les pages,
   relire en brouillon, publier.
   Tout le texte affiché passe par textContent.
===================================================== */
(function () {
    "use strict";

    const root = document.getElementById("atelierRoot");
    const intro = document.getElementById("atelierIntro");
    const backTop = document.getElementById("backTop");

    const MAX_WIDTH = 1400;           // largeur maximale d'une page (px) : assez net, léger à charger
    const MAX_HEIGHT = 12000;         // au-delà, certains téléphones ne savent pas traiter l'image
    const MAX_FILE = 25 * 1024 * 1024;

    const state = { view: "list", mangaId: null, numero: null, mangas: [], chapters: [], pageLang: "fr", illusId: null, illus: [] };
    const TYPES = [["manga", "Manga"], ["novel", "Light novel"]];
    const typeLabel = t => (t === "novel" ? "Light novel" : "Manga");
    const LANGS = [["fr", "Français"], ["en", "English"], ["pt", "Português"], ["sw", "Kiswahili"], ["ln", "Lingála"]];
    const langName = code => (LANGS.find(l => l[0] === code) || [code, code])[1];
    // Toutes les images d'un chapitre (français + autres langues), pour les supprimer ensemble
    const allRefs = c => c.pages.map(p => p.ref).concat(
        ...Object.keys(c.pagesLangues || {}).map(k => c.pagesLangues[k].map(p => p.ref)));
    const refsByLang = o => {
        const out = {};
        Object.keys(o || {}).forEach(k => { if (o[k].length) out[k] = o[k].map(p => p.ref); });
        return out;
    };
    let token = 0;

    /* ---------- Outils ---------- */
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const icon = cls => el("i", "fa-solid " + cls);
    const toast = t => Mbokal.toast(t);
    const slugify = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

    class UserError extends Error {}

    function errMsg(ex) {
        if (ex instanceof UserError) return ex.message;
        const m = String(ex && ex.message || "").toLowerCase();
        if (m.includes("row-level") || m.includes("permission") || m.includes("not authorized")) return "Action refusée : ton compte ne fait pas partie de l'équipe.";
        if (m.includes("duplicate") || m.includes("already exists")) return "Cet élément existe déjà.";
        return "L'opération a échoué. Vérifie ta connexion et réessaie.";
    }

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

    function input(label, id, opts) {
        opts = opts || {};
        const frag = document.createDocumentFragment();
        const l = el("label", null, label);
        l.htmlFor = id;
        const i = el("input");
        i.id = id; i.type = opts.type || "text"; i.value = opts.value === undefined ? "" : opts.value;
        i.autocomplete = "off";
        if (opts.required !== false) i.required = true;
        if (opts.max) i.maxLength = opts.max;
        if (opts.min) i.min = opts.min;
        if (opts.readonly) i.readOnly = true;
        frag.append(l, i);
        return { frag, i };
    }

    function textarea(label, id, value, max) {
        const frag = document.createDocumentFragment();
        const l = el("label", null, label);
        l.htmlFor = id;
        const t = el("textarea");
        t.id = id; t.value = value || ""; t.rows = 4; t.maxLength = max;
        t.style.cssText = "width:100%;padding:13px;margin-bottom:15px;border-radius:12px;border:1px solid rgba(0,255,136,0.25);background:#080808;color:#fff;font:inherit;font-size:14px;line-height:1.6;resize:vertical;";
        frag.append(l, t);
        return { frag, t };
    }

    function select(label, id, options, value) {
        const frag = document.createDocumentFragment();
        const l = el("label", null, label);
        l.htmlFor = id;
        const s = el("select");
        s.id = id;
        options.forEach(([v, t]) => { const o = el("option", null, t); o.value = v; s.append(o); });
        s.value = value;
        frag.append(l, s);
        return { frag, s };
    }

    function button(cls, text, onClick, type) {
        const b = el("button", cls, text);
        b.type = type || "button";
        if (onClick) b.addEventListener("click", onClick);
        return b;
    }

    const SENS = [["rtl", "Droite → gauche (manga)"], ["ltr", "Gauche → droite (webtoon, BD)"]];

    /* ---------- Préparation d'une image avant l'envoi ---------- */
    async function prepare(file, maxWidth) {
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw new UserError("format non accepté (PNG, JPG ou WebP).");
        if (file.size > MAX_FILE) throw new UserError("fichier trop lourd (25 Mo maximum).");
        let bmp;
        try { bmp = await createImageBitmap(file); }
        catch (e) { throw new UserError("image illisible."); }
        const w = Math.min(bmp.width, maxWidth || MAX_WIDTH);
        const h = Math.round(bmp.height * w / bmp.width);
        if (h > MAX_HEIGHT) { if (bmp.close) bmp.close(); throw new UserError("image trop haute : découpe-la en plusieurs pages."); }
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(bmp, 0, 0, w, h);
        if (bmp.close) bmp.close();
        const webp = await new Promise(r => c.toBlob(r, "image/webp", 0.85));
        if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp" };
        const jpg = await new Promise(r => c.toBlob(r, "image/jpeg", 0.88));
        if (!jpg) throw new UserError("conversion impossible sur ce navigateur.");
        return { blob: jpg, ext: "jpg" };
    }

    /* ---------- Navigation ---------- */
    function go(view, mangaId, numero) {
        if (view !== "chapter" || numero !== state.numero) state.pageLang = "fr";
        state.view = view; state.mangaId = mangaId || null; state.numero = numero || null;
        if (view === "illustration") state.illusId = mangaId || null;      // pour cette vue, le 2e argument est l'illustration
        render();
        window.scrollTo(0, 0);
    }

    function setBack() {
        if (state.view === "list") { backTop.onclick = null; backTop.href = "compte.html"; backTop.lastChild.textContent = " Mon compte"; return; }
        backTop.href = "#";
        const toList = state.view === "manga" || state.view === "illustration";
        backTop.lastChild.textContent = state.view === "manga" ? " Toutes les œuvres" : state.view === "illustration" ? " Retour à l'atelier" : " Retour à l'œuvre";
        backTop.onclick = e => { e.preventDefault(); toList ? go("list") : go("manga", state.mangaId); };
    }

    /* ---------- Accès refusé ---------- */
    function gate(message, linkHref, linkLabel) {
        intro.textContent = "Espace réservé à l'équipe.";
        const { s, box } = section("fa-lock", "ACCÈS");
        box.append(el("p", "empty-note", message));
        if (linkHref) {
            const a = el("a", "btn-main", linkLabel);
            a.href = linkHref;
            a.style.cssText = "display:block;text-align:center;margin-top:14px;";
            box.append(a);
        }
        return s;
    }

    /* ---------- Liste des mangas ---------- */
    async function listView() {
        intro.textContent = "Choisis un manga ou crée-en un nouveau.";
        state.mangas = await Catalog.admin.mangas();
        const frag = document.createDocumentFragment();

        const { s, box } = section("fa-book-open", "MANGAS");
        if (!state.mangas.length) {
            box.append(el("p", "empty-note", "Aucun manga pour l'instant. Crée le premier ci-dessous."));
        } else {
            const ul = el("ul", "row-list");
            state.mangas.forEach(m => {
                const li = el("li");
                const text = el("div", "row-text");
                text.append(el("strong", null, m.titre), el("span", null, typeLabel(m.type) + " • " + (m.genres || "Sans genre")));
                const open = button("row-action", "Ouvrir", () => go("manga", m.id));
                open.setAttribute("aria-label", "Ouvrir " + m.titre);
                li.append(text, open);
                ul.append(li);
            });
            box.append(ul);
        }
        frag.append(s);

        const nw = section("fa-plus", "NOUVELLE ŒUVRE");
        const form = el("form", "at-form");
        const t = input("Titre", "nm-titre", { max: 80 });
        const ty = select("Type", "nm-type", TYPES, "manga");
        const g = input("Genres (ex. Action • Fantastique)", "nm-genres", { max: 80, required: false });
        const sn = select("Sens de lecture", "nm-sens", SENS, "rtl");
        const err = el("p", "auth-error");
        err.setAttribute("role", "alert");
        const send = el("button", "btn-main", "Créer l'œuvre");
        send.type = "submit";
        form.append(t.frag, ty.frag, g.frag, sn.frag, err, send);
        form.addEventListener("submit", async e => {
            e.preventDefault();
            err.textContent = "";
            const id = slugify(t.i.value);
            if (!/^[a-z0-9-]{2,40}$/.test(id)) { err.textContent = "Choisis un titre d'au moins 2 lettres ou chiffres."; return; }
            if (state.mangas.some(m => m.id === id)) { err.textContent = "Une œuvre avec ce titre existe déjà."; return; }
            send.disabled = true;
            try {
                await Catalog.admin.saveManga({ id, titre: t.i.value.trim(), genres: g.i.value.trim(), sens: sn.s.value, type: ty.s.value, description: "" });
                go("manga", id);
            } catch (ex) { err.textContent = errMsg(ex); send.disabled = false; }
        });
        nw.box.append(form);
        frag.append(nw.s);

        /* Illustrations */
        try { state.illus = await Catalog.admin.illustrations(); } catch (e) { state.illus = []; }
        const il = section("fa-images", "ILLUSTRATIONS");
        if (!state.illus.length) {
            il.box.append(el("p", "empty-note", "Aucune illustration pour l'instant."));
        } else {
            const ul = el("ul", "row-list");
            state.illus.forEach(i => {
                const li = el("li");
                const text = el("div", "row-text");
                const line = el("span");
                line.append(el("span", "badge-state" + (i.statut === "publie" ? " pub" : ""), i.statut === "publie" ? "Publiée" : "Brouillon"));
                text.append(el("strong", null, i.titre), line);
                const open = button("row-action", "Modifier", () => go("illustration", i.id));
                open.setAttribute("aria-label", "Modifier " + i.titre);
                li.append(text, open);
                ul.append(li);
            });
            il.box.append(ul);
        }
        const addIl = button("btn-soft", "Ajouter une illustration", () => go("illustration"));
        addIl.style.marginTop = "14px";
        il.box.append(addIl);
        frag.append(il.s);

        if (Mbokal.mode === "local") frag.append(demoNote());
        return frag;
    }

    function demoNote() {
        return el("p", "auth-note", "Mode démo : tes mangas, chapitres et images restent sur cet appareil et ne sont pas visibles par les autres lecteurs. Ils seront partagés une fois la base de données en ligne branchée.");
    }

    /* ---------- Un manga ---------- */
    async function mangaView() {
        const [mangas, chapters] = await Promise.all([Catalog.admin.mangas(), Catalog.admin.chapters(state.mangaId)]);
        state.mangas = mangas; state.chapters = chapters;
        const m = mangas.find(x => x.id === state.mangaId);
        if (!m) { go("list"); return document.createDocumentFragment(); }
        intro.textContent = m.titre;
        const frag = document.createDocumentFragment();

        /* Infos + couverture */
        const info = section("fa-circle-info", "INFOS");
        const cb = el("div", "cover-box");
        const thumb = el("div", "cover-thumb");
        if (m.couverture && m.couverture.url) thumb.style.backgroundImage = "url(\"" + m.couverture.url.replace(/"/g, "%22") + "\")";
        const pick = el("label", "btn-soft file-pick");
        pick.append("Changer la couverture");
        const file = el("input");
        file.type = "file"; file.accept = "image/png,image/jpeg,image/webp";
        file.setAttribute("aria-label", "Choisir une image de couverture");
        pick.append(file);
        cb.append(thumb, pick);
        file.addEventListener("change", async () => {
            if (!file.files[0]) return;
            try {
                toast("Envoi de la couverture…");
                const { blob, ext } = await prepare(file.files[0], 800);
                const ref = await Catalog.admin.upload(m.id, blob, ext);
                await Catalog.admin.saveManga({ id: m.id, titre: m.titre, genres: m.genres, sens: m.sens, couverture: ref });
                if (m.couverture) Catalog.admin.removeFiles([m.couverture.ref]).catch(() => {});
                toast("Couverture enregistrée");
                render();
            } catch (ex) { toast("Couverture : " + errMsg(ex)); }
        });
        info.box.append(cb);

        const form = el("form", "at-form");
        const t = input("Titre", "mg-titre", { value: m.titre, max: 80 });
        const g = input("Genres", "mg-genres", { value: m.genres, max: 80, required: false });
        const sn = select("Sens de lecture", "mg-sens", SENS, m.sens);
        const ds = textarea("Résumé (affiché sur la fiche)", "mg-desc", m.description, 1200);
        const typeNote = el("p", "at-hint", "Type : " + typeLabel(m.type));
        const err = el("p", "auth-error");
        err.setAttribute("role", "alert");
        const save = el("button", "btn-main", "Enregistrer");
        save.type = "submit";
        form.append(t.frag, typeNote, g.frag);
        if (m.type !== "novel") form.append(sn.frag);
        form.append(ds.frag, err, save);
        form.addEventListener("submit", async e => {
            e.preventDefault();
            err.textContent = "";
            save.disabled = true;
            try {
                await Catalog.admin.saveManga({ id: m.id, titre: t.i.value.trim(), genres: g.i.value.trim(), sens: sn.s.value, type: m.type, description: ds.t.value.trim(), couverture: m.couverture && m.couverture.ref });
                toast("Manga enregistré");
                intro.textContent = t.i.value.trim();
            } catch (ex) { err.textContent = errMsg(ex); }
            save.disabled = false;
        });
        info.box.append(form);
        frag.append(info.s);

        /* Chapitres */
        const chs = section("fa-layer-group", "CHAPITRES");
        if (!chapters.length) {
            chs.box.append(el("p", "empty-note", "Aucun chapitre. Crée le premier ci-dessous."));
        } else {
            const ul = el("ul", "row-list");
            chapters.forEach(c => {
                const li = el("li");
                const text = el("div", "row-text");
                const line = el("span");
                const badge = el("span", "badge-state" + (c.statut === "publie" ? " pub" : ""), c.statut === "publie" ? "Publié" : "Brouillon");
                const others = Object.keys(c.pagesLangues || {}).filter(k => c.pagesLangues[k].length).map(k => k.toUpperCase());
                if (m.type === "novel") {
                    const w = window.MbokalTexte ? MbokalTexte.words(c.texte) : 0;
                    line.append(badge, " " + w + (w > 1 ? " mots" : " mot"));
                } else {
                    line.append(badge, " " + c.pages.length + (c.pages.length > 1 ? " pages" : " page") + (others.length ? " · FR + " + others.join(", ") : ""));
                }
                text.append(el("strong", null, "Chapitre " + c.numero + " — " + c.titre), line);
                const edit = button("row-action", "Modifier", () => go("chapter", m.id, c.numero));
                edit.setAttribute("aria-label", "Modifier le chapitre " + c.numero);
                li.append(text, edit);
                ul.append(li);
            });
            chs.box.append(ul);
        }

        const nf = el("form", "at-form");
        nf.style.marginTop = "18px";
        const next = chapters.length ? Math.max.apply(null, chapters.map(c => c.numero)) + 1 : 1;
        const n = input("Numéro du chapitre", "nc-num", { type: "number", value: next, min: 1 });
        const nt = input("Titre du chapitre", "nc-titre", { max: 80 });
        const nerr = el("p", "auth-error");
        nerr.setAttribute("role", "alert");
        const nsend = el("button", "btn-soft", "Créer le chapitre");
        nsend.type = "submit";
        nf.append(n.frag, nt.frag, nerr, nsend);
        nf.addEventListener("submit", async e => {
            e.preventDefault();
            nerr.textContent = "";
            const num = parseInt(n.i.value, 10);
            if (!(num > 0)) { nerr.textContent = "Le numéro doit être un nombre positif."; return; }
            if (chapters.some(c => c.numero === num)) { nerr.textContent = "Le chapitre " + num + " existe déjà."; return; }
            nsend.disabled = true;
            try {
                await Catalog.admin.saveChapter({ manga_id: m.id, numero: num, titre: nt.i.value.trim(), pages: [], statut: "brouillon" });
                go("chapter", m.id, num);
            } catch (ex) { nerr.textContent = errMsg(ex); nsend.disabled = false; }
        });
        chs.box.append(nf);
        frag.append(chs.s);

        /* Suppression du manga */
        const dz = section("fa-triangle-exclamation", "SUPPRIMER");
        dz.box.append(el("p", "empty-note", "Supprime le manga, tous ses chapitres et toutes leurs images. Impossible à annuler."));
        const del = el("button", "btn-danger", "Supprimer ce manga");
        del.type = "button";
        del.style.marginTop = "12px";
        del.addEventListener("click", async () => {
            if (!confirm("Supprimer « " + m.titre + " » et tous ses chapitres ? Cette action est définitive.")) return;
            del.disabled = true;
            try {
                for (const c of chapters) {
                    await Catalog.admin.removeFiles(allRefs(c));
                    await Catalog.admin.deleteChapter(m.id, c.numero);
                }
                if (m.couverture) await Catalog.admin.removeFiles([m.couverture.ref]);
                await Catalog.admin.deleteManga(m.id);
                toast("Manga supprimé");
                go("list");
            } catch (ex) { toast(errMsg(ex)); del.disabled = false; }
        });
        dz.box.append(del);
        if (await Mbokal.isAdmin()) frag.append(dz.s);        // supprimer un manga entier : administrateurs seulement
        return frag;
    }

    /* ---------- Un chapitre ---------- */
    async function chapterView() {
        const [mangas, chapters] = await Promise.all([Catalog.admin.mangas(), Catalog.admin.chapters(state.mangaId)]);
        const m = mangas.find(x => x.id === state.mangaId);
        const ch = chapters.find(c => c.numero === state.numero);
        if (!m || !ch) { go("manga", state.mangaId); return document.createDocumentFragment(); }
        intro.textContent = m.titre + " · chapitre " + ch.numero;
        const frag = document.createDocumentFragment();

        if (m.type === "novel") return novelChapterView(m, ch, frag);

        ch.pagesLangues = ch.pagesLangues || {};
        const cur = state.pageLang;                                   // version en cours d'édition
        const pages = cur === "fr" ? ch.pages : (ch.pagesLangues[cur] = ch.pagesLangues[cur] || []);

        const persist = () => Catalog.admin.saveChapter({
            manga_id: m.id, numero: ch.numero, titre: ch.titre, pages: ch.pages.map(p => p.ref), statut: ch.statut,
            pages_langues: refsByLang(ch.pagesLangues)
        });

        /* Titre + statut */
        const head = section("fa-pen", "CHAPITRE " + ch.numero);
        const state1 = el("p", "profile-mail");
        const extra = Object.keys(ch.pagesLangues).filter(k => ch.pagesLangues[k].length).map(k => k.toUpperCase() + " " + ch.pagesLangues[k].length);
        state1.append(el("span", "badge-state" + (ch.statut === "publie" ? " pub" : ""), ch.statut === "publie" ? "Publié" : "Brouillon"),
            " FR " + ch.pages.length + (extra.length ? " · " + extra.join(" · ") : ""));
        head.box.append(state1);
        const tf = el("div", "at-form");
        const t = input("Titre", "ch-titre", { value: ch.titre, max: 80 });
        tf.append(t.frag);
        t.i.addEventListener("change", async () => {
            const v = t.i.value.trim();
            if (!v) { t.i.value = ch.titre; return; }
            const old = ch.titre; ch.titre = v;
            try { await persist(); toast("Titre enregistré"); } catch (ex) { ch.titre = old; t.i.value = old; toast(errMsg(ex)); }
        });
        head.box.append(tf);
        frag.append(head.s);

        /* Pages */
        const pg = section("fa-images", "PAGES");

        // Une version des pages par langue : le lecteur affiche celle de sa langue, sinon le français
        const tabs = el("div", "auth-tabs wrap");
        tabs.setAttribute("role", "tablist");
        LANGS.forEach(([code, name]) => {
            const n = code === "fr" ? ch.pages.length : (ch.pagesLangues[code] || []).length;
            const tb = el("button", null, name + " · " + n);
            tb.type = "button";
            tb.setAttribute("role", "tab");
            tb.setAttribute("aria-selected", String(code === cur));
            tb.addEventListener("click", () => { state.pageLang = code; render(); });
            tabs.append(tb);
        });
        pg.box.append(tabs);
        if (cur === "fr") {
            pg.box.append(el("p", "at-hint", "Version française : c'est la version principale, affichée par défaut. Ordre de lecture = ordre de la grille. Les images sont réduites à 1400 px de large et converties automatiquement."));
        } else {
            pg.box.append(el("p", "at-hint", "Version " + langName(cur) + " : si elle est vide, les lecteurs de cette langue voient la version française."));
            if (pages.length && pages.length !== ch.pages.length) {
                const warn = el("p", "auth-info", "Cette version a " + pages.length + " page(s), la version française en a " + ch.pages.length + ". Vérifie qu'il n'en manque pas.");
                pg.box.append(warn);
            }
        }
        const progress = el("p", "at-progress");
        progress.setAttribute("role", "status");

        const pick = el("label", "btn-main file-pick");
        pick.append(pages.length ? "Ajouter des pages" : "Choisir les pages");
        const files = el("input");
        files.type = "file"; files.multiple = true; files.accept = "image/png,image/jpeg,image/webp";
        files.setAttribute("aria-label", "Choisir des images de pages");
        pick.append(files);
        pg.box.append(pick, progress);

        files.addEventListener("change", async () => {
            const list = Array.from(files.files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            if (!list.length) return;
            files.disabled = true;
            const problems = [];
            let added = 0;
            for (let i = 0; i < list.length; i++) {
                progress.textContent = "Envoi " + (i + 1) + " / " + list.length + "…";
                try {
                    const { blob, ext } = await prepare(list[i]);
                    const ref = await Catalog.admin.upload(m.id, blob, ext);
                    pages.push({ ref, url: await Catalog.admin.urlOf(ref) });
                    added++;
                } catch (ex) { problems.push(list[i].name + " : " + errMsg(ex)); }
            }
            if (added) { try { await persist(); } catch (ex) { problems.push("Enregistrement : " + errMsg(ex)); } }
            if (problems.length) alert("Certaines pages n'ont pas été ajoutées :\n\n" + problems.join("\n"));
            else toast(added + (added > 1 ? " pages ajoutées" : " page ajoutée"));
            render();
        });

        if (pages.length) {
            const grid = el("ul", "page-grid");
            pages.forEach((p, i) => {
                const li = el("li");
                const img = el("img");
                img.src = p.url || ""; img.alt = "Page " + (i + 1); img.loading = "lazy";
                const tools = el("div", "page-tools");
                const move = async d => {
                    const j = i + d;
                    [pages[i], pages[j]] = [pages[j], pages[i]];
                    try { await persist(); render(); } catch (ex) { [pages[i], pages[j]] = [pages[j], pages[i]]; toast(errMsg(ex)); }
                };
                const up = button("", "↑", () => move(-1)); up.setAttribute("aria-label", "Monter la page " + (i + 1)); up.disabled = i === 0;
                const down = button("", "↓", () => move(1)); down.setAttribute("aria-label", "Descendre la page " + (i + 1)); down.disabled = i === pages.length - 1;
                const rm = button("del", "✕", async () => {
                    if (!confirm("Retirer la page " + (i + 1) + " ?")) return;
                    const removed = pages.splice(i, 1)[0];
                    try { await persist(); Catalog.admin.removeFiles([removed.ref]).catch(() => {}); render(); }
                    catch (ex) { pages.splice(i, 0, removed); toast(errMsg(ex)); }
                });
                rm.setAttribute("aria-label", "Retirer la page " + (i + 1));
                tools.append(up, down, rm);
                li.append(img, el("span", "page-no", String(i + 1)), tools);
                grid.append(li);
            });
            pg.box.append(grid);
        } else {
            pg.box.append(el("p", "empty-note", "Aucune page. Tu peux en choisir plusieurs d'un coup : elles sont classées par nom de fichier (01, 02, 03…)."));
        }
        frag.append(pg.s);

        /* Publication */
        const pub = section("fa-paper-plane", "PUBLICATION");
        pub.box.append(el("p", "empty-note", ch.statut === "publie"
            ? "Ce chapitre est visible par tous les lecteurs."
            : "Ce chapitre est un brouillon : seule l'équipe peut le lire, avec l'aperçu."));
        const acts = el("div", "at-actions");
        if (pages.length) {
            const prev = el("a", "btn-soft", cur === "fr" ? "Aperçu" : "Aperçu en " + langName(cur));
            prev.href = "lecteur.html?manga=" + encodeURIComponent(m.id) + "&chapitre=" + ch.numero + "&apercu=1&pl=" + cur;
            prev.target = "_blank"; prev.rel = "noopener";
            prev.style.display = "block";
            acts.append(prev);
        }
        const toggle = button("btn-main", ch.statut === "publie" ? "Repasser en brouillon" : "Publier le chapitre", async () => {
            if (ch.statut !== "publie" && !ch.pages.length) { toast("Ajoute au moins une page à la version française avant de publier."); return; }
            if (ch.statut !== "publie" && !confirm("Publier le chapitre " + ch.numero + " ? Tous les lecteurs pourront le lire.")) return;
            const old = ch.statut;
            ch.statut = old === "publie" ? "brouillon" : "publie";
            try { await persist(); toast(ch.statut === "publie" ? "Chapitre publié" : "Chapitre repassé en brouillon"); render(); }
            catch (ex) { ch.statut = old; toast(errMsg(ex)); }
        });
        acts.append(toggle);
        pub.box.append(acts);
        frag.append(pub.s);

        /* Suppression */
        const dz = section("fa-triangle-exclamation", "SUPPRIMER");
        const del = el("button", "btn-danger", "Supprimer ce chapitre");
        del.type = "button";
        del.addEventListener("click", async () => {
            if (!confirm("Supprimer le chapitre " + ch.numero + " et toutes ses pages (toutes langues) ? Cette action est définitive.")) return;
            del.disabled = true;
            try {
                await Catalog.admin.removeFiles(allRefs(ch));
                await Catalog.admin.deleteChapter(m.id, ch.numero);
                toast("Chapitre supprimé");
                go("manga", m.id);
            } catch (ex) { toast(errMsg(ex)); del.disabled = false; }
        });
        dz.box.append(del);
        frag.append(dz.s);
        return frag;
    }


    /* ---------- Un chapitre de light novel : éditeur de texte ---------- */
    function novelChapterView(m, ch, frag) {
        const persist = () => Catalog.admin.saveChapter({
            manga_id: m.id, numero: ch.numero, titre: ch.titre, pages: [], statut: ch.statut, pages_langues: {}, texte: ch.texte
        });
        const words = () => (window.MbokalTexte ? MbokalTexte.words(ch.texte) : 0);

        const head = section("fa-pen", "CHAPITRE " + ch.numero);
        const state1 = el("p", "profile-mail");
        const wordsLabel = el("span", null, "");
        state1.append(el("span", "badge-state" + (ch.statut === "publie" ? " pub" : ""), ch.statut === "publie" ? "Publié" : "Brouillon"), " ", wordsLabel);
        head.box.append(state1);
        const tf = el("div", "at-form");
        const t = input("Titre", "ch-titre", { value: ch.titre, max: 80 });
        tf.append(t.frag);
        t.i.addEventListener("change", async () => {
            const v = t.i.value.trim();
            if (!v) { t.i.value = ch.titre; return; }
            const old = ch.titre; ch.titre = v;
            try { await persist(); toast("Titre enregistré"); } catch (ex) { ch.titre = old; t.i.value = old; toast(errMsg(ex)); }
        });
        head.box.append(tf);
        frag.append(head.s);

        /* Texte */
        const tx = section("fa-feather-pointed", "TEXTE");
        tx.box.append(el("p", "at-hint", "Une ligne vide = nouveau paragraphe. # Titre = intertitre. **gras**, *italique*. --- = séparation de scène."));
        const area = el("textarea");
        area.value = ch.texte;
        area.maxLength = 200000;
        area.rows = 16;
        area.setAttribute("aria-label", "Texte du chapitre");
        area.style.cssText = "width:100%;min-height:50vh;padding:14px;border-radius:12px;border:1px solid rgba(0,255,136,0.25);background:#080808;color:#fff;font:inherit;font-size:15px;line-height:1.7;resize:vertical;";
        const status = el("p", "at-saved", "");
        status.setAttribute("role", "status");
        const paintWords = () => { const w = words(); wordsLabel.textContent = w + (w > 1 ? " mots" : " mot"); };
        paintWords();

        let timer = null, saving = false, dirty = false;
        const save = async () => {
            if (saving) { dirty = true; return; }
            saving = true; dirty = false;
            try { await persist(); status.textContent = "Enregistré"; }
            catch (ex) { status.textContent = "Non enregistré : " + errMsg(ex); }
            saving = false;
            if (dirty) save();
        };
        area.addEventListener("input", () => {
            ch.texte = area.value;
            paintWords();
            status.textContent = "Modifications non enregistrées…";
            clearTimeout(timer);
            timer = setTimeout(save, 1800);              // enregistrement automatique
            if (preview.style.display !== "none") MbokalTexte.render(preview, ch.texte);
        });
        const saveBtn = button("btn-main", "Enregistrer maintenant", () => { clearTimeout(timer); save(); });
        saveBtn.style.marginTop = "12px";

        const preview = el("div", "novel-text");
        preview.style.cssText = "display:none;margin-top:14px;padding:16px;border-radius:12px;border:1px dashed rgba(0,255,136,0.3);font-family:Georgia,serif;line-height:1.8;";
        const prevBtn = button("btn-soft", "Voir la mise en forme", () => {
            const open = preview.style.display === "none";
            preview.style.display = open ? "block" : "none";
            if (open) MbokalTexte.render(preview, ch.texte);
            prevBtn.textContent = open ? "Masquer la mise en forme" : "Voir la mise en forme";
        });
        prevBtn.style.marginTop = "10px";
        tx.box.append(area, status, saveBtn, prevBtn, preview);
        frag.append(tx.s);

        /* Publication */
        const pub = section("fa-paper-plane", "PUBLICATION");
        pub.box.append(el("p", "empty-note", ch.statut === "publie"
            ? "Ce chapitre est visible par tous les lecteurs."
            : "Ce chapitre est un brouillon : seule l'équipe peut le lire, avec l'aperçu."));
        const acts = el("div", "at-actions");
        if (ch.texte.trim()) {
            const prev = el("a", "btn-soft", "Aperçu");
            prev.href = "lecteur.html?manga=" + encodeURIComponent(m.id) + "&chapitre=" + ch.numero + "&apercu=1";
            prev.target = "_blank"; prev.rel = "noopener";
            prev.style.display = "block";
            acts.append(prev);
        }
        acts.append(button("btn-main", ch.statut === "publie" ? "Repasser en brouillon" : "Publier le chapitre", async () => {
            clearTimeout(timer);
            if (ch.statut !== "publie" && !ch.texte.trim()) { toast("Écris du texte avant de publier."); return; }
            if (ch.statut !== "publie" && !confirm("Publier le chapitre " + ch.numero + " ? Tous les lecteurs pourront le lire.")) return;
            const old = ch.statut;
            ch.statut = old === "publie" ? "brouillon" : "publie";
            try { await persist(); toast(ch.statut === "publie" ? "Chapitre publié" : "Chapitre repassé en brouillon"); render(); }
            catch (ex) { ch.statut = old; toast(errMsg(ex)); }
        }));
        pub.box.append(acts);
        frag.append(pub.s);

        const dz = section("fa-triangle-exclamation", "SUPPRIMER");
        const del = el("button", "btn-danger", "Supprimer ce chapitre");
        del.type = "button";
        del.addEventListener("click", async () => {
            if (!confirm("Supprimer le chapitre " + ch.numero + " et son texte ? Cette action est définitive.")) return;
            del.disabled = true;
            try { await Catalog.admin.deleteChapter(m.id, ch.numero); toast("Chapitre supprimé"); go("manga", m.id); }
            catch (ex) { toast(errMsg(ex)); del.disabled = false; }
        });
        dz.box.append(del);
        frag.append(dz.s);
        return frag;
    }

    /* ---------- Une illustration ---------- */
    async function illustrationView() {
        const [mangas, all] = await Promise.all([Catalog.admin.mangas(), Catalog.admin.illustrations()]);
        const cur = state.illusId ? all.find(x => x.id === state.illusId) : null;
        if (state.illusId && !cur) { go("list"); return document.createDocumentFragment(); }
        intro.textContent = cur ? cur.titre : "Nouvelle illustration";
        const frag = document.createDocumentFragment();

        const box = section("fa-image", cur ? "MODIFIER L'ILLUSTRATION" : "NOUVELLE ILLUSTRATION");
        let picked = null;                      // image choisie, pas encore envoyée
        const thumb = el("img");
        thumb.alt = "";
        thumb.style.cssText = "display:" + (cur ? "block" : "none") + ";width:100%;max-height:360px;object-fit:contain;border-radius:12px;margin-bottom:14px;background:#050c08;";
        if (cur) thumb.src = cur.image.url || "";
        const pick = el("label", "btn-soft file-pick");
        pick.append(cur ? "Remplacer l'image" : "Choisir l'image");
        const file = el("input");
        file.type = "file"; file.accept = "image/png,image/jpeg,image/webp";
        file.setAttribute("aria-label", "Choisir une image");
        pick.append(file);
        file.addEventListener("change", () => {
            picked = file.files[0] || null;
            if (picked) { thumb.src = URL.createObjectURL(picked); thumb.style.display = "block"; }
        });
        box.box.append(thumb, pick);

        const form = el("form", "at-form");
        form.style.marginTop = "16px";
        const t = input("Titre", "il-titre", { value: cur ? cur.titre : "", max: 80 });
        const ds = textarea("Description (facultatif)", "il-desc", cur ? cur.description : "", 500);
        const mg = select("Lié à une œuvre (facultatif)", "il-manga", [["", "Aucune"]].concat(mangas.map(x => [x.id, x.titre])), cur && cur.manga_id ? cur.manga_id : "");
        const err = el("p", "auth-error");
        err.setAttribute("role", "alert");
        const save = el("button", "btn-main", "Enregistrer");
        save.type = "submit";
        form.append(t.frag, ds.frag, mg.frag, err, save);

        async function store(statut) {
            err.textContent = "";
            if (!cur && !picked) { err.textContent = "Choisis une image."; return; }
            save.disabled = true;
            let uploaded = null;
            try {
                let ref = cur ? cur.image.ref : null;
                if (picked) {
                    const { blob, ext } = await prepare(picked, 1600);
                    uploaded = await Catalog.admin.upload("illustrations", blob, ext);
                    ref = uploaded;
                }
                await Catalog.admin.saveIllustration({
                    id: cur ? cur.id : undefined, titre: t.i.value.trim(), description: ds.t.value.trim(),
                    image: ref, manga_id: mg.s.value || null, statut
                });
                if (picked && cur) Catalog.admin.removeFiles([cur.image.ref]).catch(() => {});   // l'ancienne image
                toast(statut === "publie" ? "Illustration publiée" : "Illustration enregistrée");
                go("list");
            } catch (ex) {
                if (uploaded) Catalog.admin.removeFiles([uploaded]).catch(() => {});
                err.textContent = errMsg(ex);
                save.disabled = false;
            }
        }
        form.addEventListener("submit", e => { e.preventDefault(); store(cur ? cur.statut : "brouillon"); });
        box.box.append(form);
        frag.append(box.s);

        const pub = section("fa-paper-plane", "PUBLICATION");
        pub.box.append(el("p", "empty-note", cur && cur.statut === "publie"
            ? "Cette illustration est visible dans la galerie."
            : "Brouillon : seule l'équipe la voit. Publie-la pour l'afficher dans la galerie."));
        const toggle = button("btn-main", cur && cur.statut === "publie" ? "Repasser en brouillon" : "Publier dans la galerie", () => {
            if (!t.i.value.trim()) { err.textContent = "Donne un titre à l'illustration."; return; }
            store(cur && cur.statut === "publie" ? "brouillon" : "publie");
        });
        pub.box.append(toggle);
        frag.append(pub.s);

        if (cur) {
            const dz = section("fa-triangle-exclamation", "SUPPRIMER");
            const del = el("button", "btn-danger", "Supprimer cette illustration");
            del.type = "button";
            del.addEventListener("click", async () => {
                if (!confirm("Supprimer « " + cur.titre + " » ? Cette action est définitive.")) return;
                del.disabled = true;
                try {
                    await Catalog.admin.deleteIllustration(cur.id);
                    Catalog.admin.removeFiles([cur.image.ref]).catch(() => {});
                    toast("Illustration supprimée");
                    go("list");
                } catch (ex) { toast(errMsg(ex)); del.disabled = false; }
            });
            dz.box.append(del);
            frag.append(dz.s);
        }
        return frag;
    }

    /* ---------- Rendu ---------- */
    async function render() {
        const mine = ++token;
        await Mbokal.ready;
        try { await Catalog.ready; } catch (e) { /* on continue */ }

        let frag;
        try {
            const user = Mbokal.user();
            if (!user) frag = gate("Connecte-toi avec ton compte d'équipe pour accéder à l'atelier.", "compte.html", "Se connecter");
            else if (!(await Catalog.admin.isTeam())) frag = gate("Ton compte n'est pas encore dans l'équipe. Demande à un administrateur de t'ajouter, puis reviens ici.");
            else {
                setBack();
                frag = state.view === "manga" ? await mangaView()
                    : state.view === "chapter" ? await chapterView()
                    : state.view === "illustration" ? await illustrationView()
                    : await listView();
                if (state.view === "list" && frag.nodeType) { /* déjà un fragment */ }
            }
        } catch (ex) {
            frag = gate("Impossible de charger l'atelier. Vérifie ta connexion puis recharge la page.");
        }
        if (mine !== token) return;                       // un rendu plus récent a pris le relais
        const wrap = document.createDocumentFragment();
        wrap.append(frag);
        root.replaceChildren(wrap);
    }

    Mbokal.onChange(() => { state.view = "list"; render(); });
    render();
})();
