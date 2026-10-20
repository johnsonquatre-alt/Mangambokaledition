/* =====================================================
   GALERIE : illustrations publiées par l'équipe
   Grille, tri (récentes / populaires), visionneuse avec ♥ et vues.
   Tout le texte passe par textContent.
===================================================== */
(function () {
    "use strict";

    const root = document.getElementById("galerie");
    const PAGE = 24;
    const state = { sort: "recent", shown: PAGE, items: [], counts: {}, mine: new Set() };
    let lastFocus = null;

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const compact = n => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
    const likesOf = id => (state.counts[id] && state.counts[id].likes) || 0;
    const viewsOf = id => (state.counts[id] && state.counts[id].vues) || 0;
    const mangaTitle = id => { const m = (window.MANGAS || []).find(x => x.id === id); return m ? m.titre : null; };

    function section(title) {
        const s = el("section", "content-section");
        const bar = el("div", "identity-bar");
        const h = el("h2");
        h.append(el("i", "fa-solid fa-images"), " " + title);
        bar.append(h);
        const box = el("div", "page-box");
        s.append(bar, box);
        return { s, box };
    }

    /* ---------- Liste ---------- */
    function sorted() {
        const list = state.items.slice();
        if (state.sort === "popular") {
            list.sort((a, b) => (likesOf(b.id) - likesOf(a.id)) || (viewsOf(b.id) - viewsOf(a.id)) || (a.created_at < b.created_at ? 1 : -1));
        }
        return list;
    }

    function render() {
        const { s, box } = section("Illustrations");

        const tabs = el("div", "auth-tabs");
        tabs.setAttribute("role", "tablist");
        [["recent", "Récentes"], ["popular", "Populaires"]].forEach(([key, label]) => {
            const b = el("button", null, label);
            b.type = "button";
            b.setAttribute("role", "tab");
            b.setAttribute("aria-selected", String(state.sort === key));
            b.addEventListener("click", () => { state.sort = key; state.shown = PAGE; render(); });
            tabs.append(b);
        });
        box.append(tabs);

        if (!state.items.length) {
            box.append(el("p", "empty-note", "Les premières illustrations arrivent bientôt."));
        } else {
            const grid = el("div", "gal-grid");
            sorted().slice(0, state.shown).forEach(it => {
                const tile = el("button", "gal-tile");
                tile.type = "button";
                tile.setAttribute("aria-label", it.titre);
                const img = el("img");
                img.src = it.url || ""; img.alt = it.titre; img.loading = "lazy";
                const badge = el("span", "gal-badge", "♥ " + compact(likesOf(it.id)));
                tile.append(img, badge);
                tile.addEventListener("click", () => openViewer(it, tile));
                grid.append(tile);
            });
            box.append(grid);
            if (state.items.length > state.shown) {
                const more = el("button", "btn-soft", "Voir plus");
                more.type = "button";
                more.style.marginTop = "14px";
                more.addEventListener("click", () => { state.shown += PAGE; render(); });
                box.append(more);
            }
        }
        root.replaceChildren(s);
    }

    /* ---------- Visionneuse ---------- */
    function closeViewer() {
        const v = document.querySelector(".gal-viewer");
        if (v) v.remove();
        document.body.style.overflow = "";
        if (lastFocus) lastFocus.focus();
    }

    function openViewer(it, from) {
        closeViewer();
        lastFocus = from;
        const v = el("div", "gal-viewer");
        v.setAttribute("role", "dialog");
        v.setAttribute("aria-modal", "true");
        v.setAttribute("aria-label", it.titre);

        const close = el("button", "gal-close", "✕");
        close.type = "button";
        close.setAttribute("aria-label", "Fermer");
        close.addEventListener("click", closeViewer);

        const img = el("img", "gal-full");
        img.src = it.url || ""; img.alt = it.titre;

        const info = el("div", "gal-info");
        info.append(el("h2", null, it.titre));
        const by = el("p", "gal-by", "par " + it.auteur);
        info.append(by);
        if (it.description) info.append(el("p", "gal-desc", it.description));
        const mt = it.manga_id && mangaTitle(it.manga_id);
        if (mt) {
            const a = el("a", "row-action", "Voir la fiche de " + mt);
            a.href = "manga.html?id=" + encodeURIComponent(it.manga_id);
            info.append(a);
        }

        const bar = el("div", "gal-bar");
        const like = el("button", "rate-btn");
        like.type = "button";
        const views = el("span", "gal-views");
        const paint = () => {
            const on = state.mine.has(it.id);
            like.textContent = (on ? "♥ " : "♡ ") + compact(likesOf(it.id));
            like.setAttribute("aria-pressed", String(on));
            like.setAttribute("aria-label", on ? "Retirer mon j'aime" : "J'aime cette illustration");
            views.textContent = "👁 " + compact(viewsOf(it.id));
        };
        paint();
        like.addEventListener("click", async () => {
            const on = !state.mine.has(it.id);
            try {
                await Mbokal.illus.like(it.id, on);
                if (on) state.mine.add(it.id); else state.mine.delete(it.id);
                const c = state.counts[it.id] || (state.counts[it.id] = { vues: 0, likes: 0 });
                c.likes = Math.max(0, c.likes + (on ? 1 : -1));
                paint();
            } catch (ex) { Mbokal.toast(ex.message); }
        });
        bar.append(like, views);
        info.append(bar);

        v.append(close, img, info);
        v.addEventListener("keydown", e => { if (e.key === "Escape") closeViewer(); });
        document.body.append(v);
        document.body.style.overflow = "hidden";
        close.focus();

        // Une vue par appareil et par jour ; on rafraîchit ensuite les chiffres
        Mbokal.illus.view(it.id).then(() => Mbokal.illus.counters([it.id])).then(c => {
            if (c && c[it.id]) { state.counts[it.id] = c[it.id]; if (document.body.contains(v)) paint(); }
        });
    }

    /* ---------- Démarrage ---------- */
    async function start() {
        await Mbokal.ready;
        try { await Catalog.ready; } catch (e) { /* catalogue de départ */ }
        try { state.items = await Catalog.illustrations(); } catch (e) { state.items = []; }
        const ids = state.items.map(i => i.id);
        state.counts = await Mbokal.illus.counters(ids);
        state.mine = new Set(await Mbokal.illus.mine(ids));
        render();
        Mbokal.onChange(async () => {
            state.mine = new Set(await Mbokal.illus.mine(state.items.map(i => i.id)));
            render();
        });
    }

    start();
})();
