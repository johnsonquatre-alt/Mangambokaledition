/* =====================================================
   LECTEUR — MANGA MBOKAL EDITION
   URL : lecteur.html?manga=ishi-no-erito&chapitre=1&page=3

   Le stockage (réglages + progression) passe par "Store".
   Aujourd'hui : localStorage (cet appareil seulement).
   Plus tard : remplacer ces 2 fonctions par des appels
   à la base de données du compte (Supabase / Firebase).
===================================================== */
(function () {
    "use strict";

    /* ---------- Stockage ---------- */
    const Store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem("mbokal:" + key);
                return raw ? JSON.parse(raw) : fallback;
            } catch (e) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem("mbokal:" + key, JSON.stringify(value)); }
            catch (e) { /* stockage plein ou bloqué : on continue sans */ }
        }
    };

    /* ---------- Éléments ---------- */
    const $ = id => document.getElementById(id);
    const stage = $("stage"), slider = $("slider"), counter = $("counter");
    const prevChapterBtn = $("prevChapter"), nextChapterBtn = $("nextChapter");

    /* ---------- État ---------- */
    const params = new URLSearchParams(location.search);
    const settings = Object.assign({ mode: "vertical", dir: null, pageLang: "auto", fontSize: 1, theme: "dark" }, Store.get("reader", {}));

    /* ---------- Langue des pages ---------- */
    const SITE_LANGS = { fr: "Français", en: "English", pt: "Português", sw: "Kiswahili", ln: "Lingála" };
    const forcedLang = SITE_LANGS[params.get("pl")] ? params.get("pl") : null;     // aperçu de l'atelier

    function siteLang() {
        try { const v = localStorage.getItem("mbokal:lang"); return SITE_LANGS[v] ? v : "fr"; }
        catch (e) { return "fr"; }
    }
    // Auto = la langue du site ; sinon le choix du lecteur
    function wantedLang() {
        if (forcedLang) return forcedLang;
        return SITE_LANGS[settings.pageLang] ? settings.pageLang : siteLang();
    }
    function hasVersion(c, l) {
        if (l === "fr") return !!(c.pages && c.pages.length);
        return !!(c.pagesLangues && c.pagesLangues[l] && c.pagesLangues[l].length);
    }

    let counts = {};   // { numeroChapitre: nombre de commentaires }

    const state = {
        manga: null,
        chapIndex: 0,
        pages: [],     // liste des sources (null = page de test)
        page: 0,       // index de la page courante (== pages.length : écran de fin)
        observer: null
    };

    /* ---------- Utilitaires ---------- */
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };

    const isRtl = () => (settings.dir || state.manga.sens || "ltr") === "rtl";
    const chapter = () => state.manga.chapitres[state.chapIndex];
    const isNovel = () => !!(state.manga && state.manga.type === "novel");       // light novel : texte au lieu d'images
    const paged = () => settings.mode === "page" && !isNovel();
    const isReadable = c => c && c.disponible && (c.pages.length || c.placeholder || c.texte);
    // Light novel : la « page » est un pourcentage de lecture (0 à 100)
    const total = () => (isNovel() ? 100 : state.pages.length);
    const NOVEL_SIZES = [15, 17, 19, 22];

    function pagesOf(c) {
        const l = wantedLang();
        if (l !== "fr" && hasVersion(c, l)) return c.pagesLangues[l].slice();    // version dans la langue du lecteur
        if (c.pages && c.pages.length) return c.pages.slice();                   // sinon : français
        return Array(c.placeholder || 0).fill(null);
    }

    /* ---------- Compteurs (vues et lectures) ---------- */
    const counted = new Set();
    function track(type) {
        if (!state.manga || !window.Mbokal || params.get("apercu")) return;       // l'aperçu de l'équipe ne compte pas
        const c = chapter();
        if (!c || c.brouillon) return;
        const key = state.manga.id + ":" + c.numero + ":" + type;
        if (counted.has(key)) return;
        counted.add(key);
        Mbokal.stats.event(state.manga.id, c.numero, type);
    }

    /* ---------- Progression ---------- */
    function saveProgress() {
        if (!state.manga || !total() || chapter().brouillon) return;
        const all = Store.get("progress", {});
        const entry = all[state.manga.id] || { lus: [] };
        const n = chapter().numero;
        entry.chapitre = n;
        entry.page = Math.min(state.page, total() - 1);
        entry.maj = Date.now();
        const finished = isNovel() ? state.page >= 96 : state.page >= total() - 1;
        if (finished) track("lu");
        if (finished && entry.lus.indexOf(n) === -1) entry.lus.push(n);
        all[state.manga.id] = entry;
        Store.set("progress", all);
        queueSync(state.manga.id, entry);
    }

    // Envoi vers le compte (si connecté), sans spammer à chaque page
    let pending = null, syncTimer = null;
    function flushSync() {
        clearTimeout(syncTimer);
        if (pending && window.Mbokal) { Mbokal.saveProgress(pending.id, pending.entry); }
        pending = null;
    }
    function queueSync(id, entry) {
        pending = { id: id, entry: Object.assign({}, entry) };
        clearTimeout(syncTimer);
        syncTimer = setTimeout(flushSync, 1500);
    }
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushSync();
    });

    /* ---------- Écran vide / erreur ---------- */
    function showEmpty(title, text, linkHref, linkLabel) {
        teardown();
        stage.className = "stage vertical";
        stage.textContent = "";
        const box = el("div", "empty");
        box.append(el("h2", null, title), el("p", null, text));
        const a = el("a", null, linkLabel);
        a.href = linkHref;
        box.append(a);
        stage.append(box);
        $("mangaTitle").textContent = state.manga ? state.manga.titre : "Lecteur";
        $("chapterTitle").textContent = "";
        slider.max = 1; slider.value = 1; counter.textContent = "–";
        slider.disabled = true;
        updateChapterButtons();
        document.body.classList.remove("ui-hidden");
    }

    /* ---------- Création d'une page ---------- */
    function makePage(i) {
        const src = state.pages[i];
        const fig = el("figure", "page");
        fig.dataset.index = i;
        fig.style.margin = "0";

        if (!src) {
            const ph = el("div", "placeholder");
            ph.append(el("b", null, String(i + 1)), el("small", null, state.manga.titre + " — page de test"));
            fig.append(ph);
            return fig;
        }

        const img = new Image();
        img.alt = "Page " + (i + 1) + " sur " + total();
        img.decoding = "async";
        if (settings.mode === "vertical" && i > 1) img.loading = "lazy";
        img.addEventListener("error", () => {
            fig.textContent = "";
            const err = el("div", "page-error");
            err.append(el("span", null, "Cette page n'a pas pu se charger."));
            const retry = el("button", null, "Réessayer");
            retry.type = "button";
            retry.addEventListener("click", () => { fig.replaceWith(makePage(i)); });
            err.append(retry);
            fig.append(err);
        });
        img.src = src;
        fig.append(img);
        return fig;
    }

    function makeEndCard() {
        const c = chapter();
        const next = state.manga.chapitres[state.chapIndex + 1];
        const box = el("div", "end-card");
        box.dataset.index = total();
        box.append(el("h2", null, "Fin du chapitre " + c.numero));

        // Avis sur le manga : 👍 / 👎 (demande un compte)
        if (window.Mbokal) {
            const row = el("div", "rate-row");
            const up = el("button", "rate-btn"), down = el("button", "rate-btn");
            up.type = down.type = "button";
            up.setAttribute("aria-label", "J'aime ce manga");
            down.setAttribute("aria-label", "Je n'aime pas ce manga");
            up.append(el("i", "fa-solid fa-thumbs-up"));
            down.append(el("i", "fa-solid fa-thumbs-down"));
            let mine = 0;
            const paint = () => { up.setAttribute("aria-pressed", String(mine === 1)); down.setAttribute("aria-pressed", String(mine === -1)); };
            const vote = async v => {
                try { const next = mine === v ? 0 : v; await Mbokal.stats.rate(state.manga.id, next); mine = next; paint(); }
                catch (ex) { Mbokal.toast(ex.message); }
            };
            up.addEventListener("click", () => vote(1));
            down.addEventListener("click", () => vote(-1));
            paint();
            Mbokal.stats.myRating(state.manga.id).then(v => { mine = v; paint(); });
            row.append(up, down);
            box.append(el("p", null, "Ce manga te plaît ?"), row);
        }

        if (next && isReadable(next)) {
            box.append(el("p", null, "Chapitre " + next.numero + " — " + next.titre));
            const go = el("button", "primary", "Lire la suite");
            go.type = "button";
            go.addEventListener("click", () => loadChapter(state.chapIndex + 1, 0));
            box.append(go);
        } else {
            box.append(el("p", null, "Le prochain chapitre arrive bientôt."));
        }
        const nTalk = counts[c.numero] || 0;
        const talk = el("button", null, nTalk ? "Voir les commentaires (" + nTalk + ")" : "Voir les commentaires");
        talk.type = "button";
        talk.addEventListener("click", openComments);
        box.append(talk);
        const sheet = el("a", null, "Fiche du manga");
        sheet.href = "manga.html?id=" + encodeURIComponent(state.manga.id);
        box.append(sheet);
        const back = el("a", null, "Tous les mangas");
        back.href = "decouvrir.html";
        box.append(back);
        return box;
    }

    /* ---------- Rendu ---------- */
    function teardown() {
        if (state.observer) { state.observer.disconnect(); state.observer = null; }
        stage.removeEventListener("scroll", onNovelScroll);
    }

    /* ---------- Light novel : lecture du texte ---------- */
    let novelTimer = null;
    function applyNovelStyle() {
        stage.dataset.theme = settings.theme || "dark";
        stage.style.setProperty("--novel-size", (NOVEL_SIZES[settings.fontSize] || 17) + "px");
    }
    function scrollToPercent(p) {
        const max = stage.scrollHeight - stage.clientHeight;
        stage.scrollTop = max > 0 ? (p / 100) * max : 0;
    }
    function onNovelScroll() {
        const max = stage.scrollHeight - stage.clientHeight;
        state.page = max > 0 ? Math.min(100, Math.round((stage.scrollTop / max) * 100)) : 100;
        updateUi();
        clearTimeout(novelTimer);
        novelTimer = setTimeout(saveProgress, 500);
    }
    function renderNovel() {
        stage.textContent = "";
        stage.className = "stage vertical novel";
        applyNovelStyle();
        const article = el("article", "novel-text");
        if (window.MbokalTexte) MbokalTexte.render(article, chapter().texte);
        else article.textContent = chapter().texte;
        stage.append(article, makeEndCard());
        const start = state.page;
        stage.addEventListener("scroll", onNovelScroll);
        requestAnimationFrame(() => { scrollToPercent(start); onNovelScroll(); });
        updateUi();
    }

    function render() {
        teardown();
        if (isNovel()) { renderNovel(); return; }
        stage.textContent = "";
        const vertical = settings.mode === "vertical";
        stage.className = "stage " + (vertical ? "vertical" : "paged");

        if (vertical) {
            const frag = document.createDocumentFragment();
            for (let i = 0; i < total(); i++) frag.append(makePage(i));
            frag.append(makeEndCard());
            stage.append(frag);
            observePages();
            scrollToPage(state.page, false);
        } else {
            showPaged();
        }
        updateUi();
    }

    function showPaged() {
        stage.textContent = "";
        if (state.page >= total()) {
            stage.append(makeEndCard());
        } else {
            stage.append(makePage(state.page));
            preload(state.page + 1);
            preload(state.page - 1);
        }
    }

    function preload(i) {
        if (i < 0 || i >= total() || !state.pages[i]) return;
        new Image().src = state.pages[i];
    }

    function observePages() {
        // La page qui croise le centre de l'écran devient la page courante
        state.observer = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    state.page = Number(e.target.dataset.index);
                    updateUi();
                    saveProgress();
                }
            });
        }, { root: stage, rootMargin: "-50% 0px -50% 0px", threshold: 0 });
        stage.querySelectorAll("[data-index]").forEach(n => state.observer.observe(n));
    }

    function scrollToPage(i, smooth) {
        const target = stage.querySelector('[data-index="' + i + '"]');
        if (target) stage.scrollTo({ top: target.offsetTop, behavior: smooth ? "smooth" : "auto" });
    }

    /* ---------- Navigation entre pages ---------- */
    function goTo(i) {
        i = Math.max(0, Math.min(i, total()));
        state.page = i;
        if (settings.mode === "vertical") {
            scrollToPage(i, true);
        } else {
            showPaged();
            updateUi();
            saveProgress();
        }
    }

    function step(delta) {
        // En page par page : delta > 0 = page suivante dans la lecture
        if (paged() && state.page >= total() && delta > 0) {
            if (hasNext()) loadChapter(state.chapIndex + 1, 0);
            return;
        }
        if (paged() && state.page <= 0 && delta < 0) {
            if (hasPrev()) loadChapter(state.chapIndex - 1, "fin");
            return;
        }
        goTo(state.page + delta);
    }

    /* ---------- Chapitres ---------- */
    const hasNext = () => isReadable(state.manga.chapitres[state.chapIndex + 1]);
    const hasPrev = () => isReadable(state.manga.chapitres[state.chapIndex - 1]);

    function updateChapterButtons() {
        if (!state.manga) { prevChapterBtn.disabled = nextChapterBtn.disabled = true; return; }
        prevChapterBtn.disabled = !hasPrev();
        nextChapterBtn.disabled = !hasNext();
    }

    function loadChapter(index, startPage) {
        const c = state.manga.chapitres[index];
        if (!c) return;
        state.chapIndex = index;

        const url = new URL(location.href);
        url.searchParams.set("chapitre", c.numero);
        url.searchParams.delete("page");
        history.replaceState(null, "", url);

        if (!isReadable(c)) {
            showEmpty("Chapitre " + c.numero + " bientôt disponible",
                "L'équipe finalise ce chapitre. Revenez vite !",
                "decouvrir.html", "Voir les autres mangas");
            return;
        }

        slider.disabled = false;
        state.pages = pagesOf(c);
        state.page = startPage === "fin" ? total() - 1 : Math.min(startPage || 0, total());
        $("mangaTitle").textContent = state.manga.titre;
        $("chapterTitle").textContent = (c.brouillon ? "Brouillon · " : "") + "Chapitre " + c.numero + " — " + c.titre;
        document.title = state.manga.titre + " · Chapitre " + c.numero;
        updateChapterButtons();
        paintBadge();
        render();
        track("vue");
        saveProgress();
        stage.focus({ preventScroll: true });
    }

    /* ---------- Compteur de commentaires ---------- */
    function paintBadge() {
        const badge = $("commentBadge");
        const n = state.manga && isReadable(chapter()) ? (counts[chapter().numero] || 0) : 0;
        badge.hidden = n === 0;
        badge.textContent = n > 99 ? "99+" : String(n);
        $("openComments").setAttribute("aria-label",
            n ? "Commentaires du chapitre (" + n + ")" : "Commentaires du chapitre");
    }

    async function loadCounts() {
        if (!window.Mbokal) return;
        counts = await Mbokal.comments.counts(state.manga.id);
        paintBadge();
    }

    // Appelé par le panneau quand quelqu'un publie ou supprime
    function changeCount(delta) {
        const n = chapter().numero;
        counts[n] = Math.max(0, (counts[n] || 0) + delta);
        paintBadge();
    }

    /* ---------- Interface ---------- */
    function updateUi() {
        if (isNovel()) {
            slider.max = 100;
            slider.value = Math.round(state.page);
            slider.dir = "ltr";
            counter.textContent = Math.round(state.page) + " %";
            return;
        }
        const n = total();
        slider.max = Math.max(n, 1);
        slider.value = Math.min(state.page + 1, n);
        slider.dir = paged() && isRtl() ? "rtl" : "ltr";
        counter.textContent = (Math.min(state.page + 1, n)) + " / " + n;
    }

    function toggleUi() { document.body.classList.toggle("ui-hidden"); }

    function buildPageLang() {
        const box = $("pageLangBox"), group = $("pageLangChoice"), hint = $("pageLangHint");
        const c = state.manga && state.manga.chapitres[state.chapIndex];
        const langs = c ? Object.keys(SITE_LANGS).filter(l => hasVersion(c, l)) : [];
        box.hidden = isNovel() || !langs.some(l => l !== "fr");              // rien à choisir s'il n'y a que le français
        if (box.hidden) return;

        const cur = SITE_LANGS[settings.pageLang] ? settings.pageLang : "auto";
        group.textContent = "";
        const add = (value, label, fixed) => {
            const b = el("button", null, label);
            b.type = "button";
            b.dataset.pl = value;
            if (fixed) b.setAttribute("translate", "no");        // les noms de langues ne se traduisent pas
            b.setAttribute("aria-pressed", String(value === cur));
            group.append(b);
        };
        add("auto", "Auto", false);
        langs.forEach(l => add(l, SITE_LANGS[l], true));

        const wanted = wantedLang();
        hint.textContent = "Auto : la langue des pages suit la langue du site."
            + (hasVersion(c, wanted) ? "" : " Ce chapitre n'existe pas encore en " + SITE_LANGS[wanted] + " : la version française est affichée.");
    }

    // Change de version sans quitter la page
    function refreshPages() {
        if (!state.manga || !isReadable(chapter())) return;
        state.pages = pagesOf(chapter());
        state.page = Math.min(state.page, total());
        render();
        buildPageLang();
    }

    function applySettingsUi() {
        buildPageLang();
        $("mangaSettings").hidden = isNovel();
        $("novelBox").hidden = !isNovel();
        document.querySelectorAll("#sizeChoice button").forEach(b =>
            b.setAttribute("aria-pressed", String(Number(b.dataset.size) === settings.fontSize)));
        document.querySelectorAll("#themeChoice button").forEach(b =>
            b.setAttribute("aria-pressed", String(b.dataset.theme === (settings.theme || "dark"))));
        document.querySelectorAll("#modeChoice button").forEach(b =>
            b.setAttribute("aria-pressed", String(b.dataset.mode === settings.mode)));
        const dir = isRtl() ? "rtl" : "ltr";
        document.querySelectorAll("#dirChoice button").forEach(b =>
            b.setAttribute("aria-pressed", String(b.dataset.dir === dir)));
        const off = settings.mode === "vertical";
        document.querySelector("#dirChoice").classList.toggle("is-off", off);
        document.querySelector("#dirChoice").previousElementSibling.classList.toggle("is-off", off);
    }

    function openSheet(id) {
        const sheet = $(id);
        sheet.hidden = false;
        const first = sheet.querySelector("button");
        if (first) first.focus();
    }
    function closeSheets() { document.querySelectorAll(".sheet").forEach(s => { s.hidden = true; }); }

    function buildChapterList() {
        const list = $("chapterList");
        list.textContent = "";
        const prog = Store.get("progress", {})[state.manga.id] || { lus: [] };
        state.manga.chapitres.forEach((c, i) => {
            const li = el("li");
            const b = el("button");
            b.type = "button";
            if (i === state.chapIndex) b.classList.add("current");
            const ok = isReadable(c);
            b.disabled = !ok;
            b.append(el("span", "num", String(c.numero)), el("span", "name", c.titre));
            const label = !ok ? "Bientôt" : prog.lus.indexOf(c.numero) !== -1 ? "Lu" : i === state.chapIndex ? "En cours" : "";
            b.append(el("span", "state", label));
            if (ok && counts[c.numero]) b.append(el("span", "talk", "💬 " + counts[c.numero]));
            b.addEventListener("click", () => { closeSheets(); loadChapter(i, 0); });
            li.append(b);
            list.append(li);
        });
    }

    /* ---------- Événements ---------- */
    $("openChapters").addEventListener("click", () => { buildChapterList(); openSheet("chaptersSheet"); });
    function openComments() {
        if (!state.manga || !isReadable(chapter())) return;
        $("commentsHeading").textContent = "Commentaires · chapitre " + chapter().numero;
        if (window.MbokalComments) {
            MbokalComments.mount($("commentsRoot"), { mangaId: state.manga.id, chapitre: chapter().numero, onCount: changeCount });
        }
        openSheet("commentsSheet");
    }
    $("openComments").addEventListener("click", openComments);
    $("openSettings").addEventListener("click", () => { applySettingsUi(); openSheet("settingsSheet"); });
    document.querySelectorAll("[data-close]").forEach(n => n.addEventListener("click", closeSheets));

    $("modeChoice").addEventListener("click", e => {
        const b = e.target.closest("button[data-mode]");
        if (!b || b.dataset.mode === settings.mode) return;
        settings.mode = b.dataset.mode;
        Store.set("reader", settings);
        applySettingsUi();
        if (state.manga && isReadable(chapter())) render();
    });

    $("pageLangChoice").addEventListener("click", e => {
        const b = e.target.closest("button[data-pl]");
        if (!b) return;
        settings.pageLang = b.dataset.pl;
        Store.set("reader", settings);
        refreshPages();
    });

    // Taille et thème du texte (light novels) : on garde la position de lecture
    function restyleNovel(change) {
        const keep = state.page;
        change();
        Store.set("reader", settings);
        applyNovelStyle();
        applySettingsUi();
        requestAnimationFrame(() => scrollToPercent(keep));
    }
    $("sizeChoice").addEventListener("click", e => {
        const b = e.target.closest("button[data-size]");
        if (b) restyleNovel(() => { settings.fontSize = Number(b.dataset.size); });
    });
    $("themeChoice").addEventListener("click", e => {
        const b = e.target.closest("button[data-theme]");
        if (b) restyleNovel(() => { settings.theme = b.dataset.theme; });
    });

    $("dirChoice").addEventListener("click", e => {
        const b = e.target.closest("button[data-dir]");
        if (!b) return;
        settings.dir = b.dataset.dir;
        Store.set("reader", settings);
        applySettingsUi();
        updateUi();
    });

    prevChapterBtn.addEventListener("click", () => loadChapter(state.chapIndex - 1, 0));
    nextChapterBtn.addEventListener("click", () => loadChapter(state.chapIndex + 1, 0));

    slider.addEventListener("input", () => {
        if (isNovel()) { scrollToPercent(Number(slider.value)); return; }
        const v = Number(slider.value) - 1;
        counter.textContent = (v + 1) + " / " + total();
        goTo(v);
    });

    // Toucher / cliquer : zones gauche-droite en page par page, afficher/masquer sinon
    let startX = null, startY = null, swiped = false;

    stage.addEventListener("pointerdown", e => { startX = e.clientX; startY = e.clientY; swiped = false; });

    stage.addEventListener("pointerup", e => {
        if (startX === null || !paged()) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            swiped = true;
            // RTL : glisser vers la droite = page suivante
            const forward = isRtl() ? dx > 0 : dx < 0;
            step(forward ? 1 : -1);
        }
        startX = null;
    });

    stage.addEventListener("click", e => {
        if (e.target.closest("a, button")) return;
        if (swiped) { swiped = false; return; }
        if (paged()) {
            const ratio = e.clientX / window.innerWidth;
            if (ratio < 0.3) { step(isRtl() ? 1 : -1); return; }
            if (ratio > 0.7) { step(isRtl() ? -1 : 1); return; }
        }
        toggleUi();
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") { closeSheets(); return; }
        if (!$("chaptersSheet").hidden || !$("settingsSheet").hidden || !$("commentsSheet").hidden) return;
        if (e.target === slider || /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
        if (paged()) {
            if (e.key === "ArrowRight") { e.preventDefault(); step(isRtl() ? -1 : 1); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); step(isRtl() ? 1 : -1); }
            else if (e.key === " " || e.key === "ArrowDown") { e.preventDefault(); step(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); step(-1); }
        }
    });

    /* ---------- Démarrage ---------- */
    function start() {
        const manga = (window.MANGAS || []).find(m => m.id === params.get("manga"));

        if (!manga) {
            showEmpty("Manga introuvable",
                "Ce lien ne correspond à aucun manga du catalogue.",
                "decouvrir.html", "Voir tous les mangas");
            return;
        }
        state.manga = manga;
        $("backLink").href = "decouvrir.html";

        if (!manga.chapitres.length) {
            showEmpty("Pas encore de chapitre",
                "L'équipe prépare le premier chapitre de " + manga.titre + ".",
                "decouvrir.html", "Voir les autres mangas");
            return;
        }

        // Chapitre demandé, sinon dernier chapitre en cours, sinon le premier
        const prog = Store.get("progress", {})[manga.id];
        let numero = Number(params.get("chapitre")) || (prog && prog.chapitre) || manga.chapitres[0].numero;
        let index = manga.chapitres.findIndex(c => c.numero === numero);
        if (index < 0) index = 0;

        let startPage = 0;
        if (params.get("page")) startPage = Math.max(0, Number(params.get("page")) - 1) || 0;
        else if (!params.get("chapitre") && prog && prog.chapitre === manga.chapitres[index].numero) startPage = prog.page || 0;

        applySettingsUi();
        loadChapter(index, startPage);
        loadCounts();
    }

    // Si connecté : on récupère d'abord la progression du compte (autre appareil)
    (async function boot() {
        try {
            if (window.Mbokal) {
                await Mbokal.ready;
                if (Mbokal.user()) {
                    const remote = await Mbokal.progress();
                    const local = Store.get("progress", {});
                    Object.keys(remote).forEach(id => {
                        if (!local[id] || (remote[id].maj || 0) > (local[id].maj || 0)) {
                            local[id] = Object.assign({ lus: [] }, remote[id]);
                        }
                    });
                    Store.set("progress", local);
                }
            }
        } catch (e) { /* hors ligne : on lit avec la progression de l'appareil */ }
        try {
            if (window.Catalog) {
                // ?apercu=1 : l'équipe relit ses brouillons avant publication
                if (params.get("apercu")) await Catalog.load({ brouillons: true });
                else await Catalog.ready;
            }
        } catch (e) { /* catalogue de départ */ }
        start();
    })();
})();
