/* =====================================================
   TOP MANGA : classement par vues, lectures, favoris, j'aime
===================================================== */
(function () {
    "use strict";

    const root = document.getElementById("classement");
    const METRICS = [["vues", "Vues", "fa-eye"], ["lus", "Lectures", "fa-book-open"], ["favoris", "Favoris", "fa-heart"], ["likes", "J'aime", "fa-thumbs-up"]];
    const PERIODS = [["semaine", "Cette semaine"], ["mois", "Ce mois-ci"], ["tout", "Depuis toujours"]];
    const TYPES = [["all", "Tout"], ["manga", "Manga"], ["novel", "Light novels"]];
    const state = { metric: "vues", period: "semaine", type: "all" };
    let token = 0;

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const compact = n => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

    function tabs(items, current, onPick, small) {
        const bar = el("div", "rank-tabs" + (small ? " small" : ""));
        bar.setAttribute("role", "tablist");
        items.forEach(([key, label]) => {
            const b = el("button", null, label);
            b.type = "button";
            b.setAttribute("role", "tab");
            b.setAttribute("aria-selected", String(key === current));
            b.addEventListener("click", () => onPick(key));
            bar.append(b);
        });
        return bar;
    }

    async function render() {
        const mine = ++token;
        await Mbokal.ready;
        try { await Catalog.ready; } catch (e) { /* catalogue de départ */ }
        const timed = state.metric === "vues" || state.metric === "lus";
        const frag = document.createDocumentFragment();

        const section = el("section", "content-section");
        const box = el("div", "page-box");
        box.append(tabs(METRICS.map(m => [m[0], m[1]]), state.metric, k => { state.metric = k; render(); }));
        box.append(tabs(TYPES, state.type, k => { state.type = k; render(); }, true));
        if (timed) box.append(tabs(PERIODS, state.period, k => { state.period = k; render(); }, true));

        let rows = [];
        try { rows = await Mbokal.stats.top(timed ? state.period : "tout"); }
        catch (ex) { box.append(el("p", "empty-note", ex.message)); }
        if (mine !== token) return;

        const key = state.metric;
        rows.sort((a, b) => (b[key] - a[key]) || (b.vues - a.vues) || a.titre.localeCompare(b.titre));
        if (rows.length && rows.every(r => !r[key])) {
            box.append(el("p", "empty-note", "Pas encore de chiffres. Lis un manga pour lancer le classement."));
        }

        const ul = el("ul", "rank-list");
        rows.forEach((r, i) => {
            const m = (window.MANGAS || []).find(x => x.id === r.manga_id);
            if (!m || !m.chapitres.some(c => !c.brouillon)) return;     // seulement les œuvres lisibles
            if (state.type !== "all" && (m.type || "manga") !== state.type) return;
            const li = el("li", "rank-item");
            const a = el("a");
            a.href = "manga.html?id=" + encodeURIComponent(r.manga_id);
            a.setAttribute("aria-label", m.titre);
            const cover = el("div", "rank-cover");
            if (m.couverture) cover.style.backgroundImage = "url(\"" + m.couverture.replace(/"/g, "%22") + "\")";
            const text = el("div", "rank-text");
            text.append(el("strong", null, m.titre));
            const mini = el("div", "rank-mini");
            METRICS.forEach(([k, label, ic]) => {
                if (k === key) return;
                const s = el("span");
                s.setAttribute("aria-label", label + " : " + r[k]);
                s.append(el("i", "fa-solid " + ic), document.createTextNode(compact(r[k])));
                mini.append(s);
            });
            text.append(mini);
            const val = el("span", "rank-value", compact(r[key]));
            val.setAttribute("aria-label", METRICS.find(x => x[0] === key)[1] + " : " + r[key]);
            a.append(el("span", "rank-no", String(ul.children.length + 1)), cover, text, val);
            li.append(a);
            ul.append(li);
        });
        box.append(ul);
        if (Mbokal.mode === "local") {
            box.append(el("p", "rank-note", "Mode démo : les chiffres ne comptent que les lectures de cet appareil."));
        }
        section.append(box);
        frag.append(section);
        root.replaceChildren(frag);
    }

    render();
    Mbokal.onChange(() => { render(); });
})();
