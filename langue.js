/* =====================================================
   LANGUE — choix de la langue + traduction automatique
   Langues : fr (langue d'origine), en, pt, sw, ln

   Fonctionnement :
   1. Le visiteur choisit sa langue (fenêtre à la 1re visite, puis
      bouton de langue dans l'en-tête). Le choix est mémorisé.
   2. Si ce n'est pas le français, tous les textes de la page sont
      traduits, dans cet ordre :
        a) le fichier traductions.js (écrit par nous, gratuit, hors ligne) ;
        b) la mémoire de l'appareil ;
        c) seulement si config.js a traductionServeur: true : la base
           (fonction SQL "traduire") puis le service de traduction.
   3. Les textes ajoutés plus tard (commentaires, cartes) sont traduits
      au fil de l'eau.

   Ce qui n'est jamais traduit : éléments marqués translate="no",
   titres des mangas, noms des personnages, nom du site.
===================================================== */
(function () {
    "use strict";

    const root = document.documentElement;
    if (root.getAttribute("translate") === "no") return;   // pages d'outils (atelier)

    const LANGS = [
        { code: "fr", name: "Français", short: "FR" },
        { code: "en", name: "English", short: "EN" },
        { code: "pt", name: "Português", short: "PT" },
        { code: "sw", name: "Kiswahili", short: "SW" },
        { code: "ln", name: "Lingála", short: "LN" }
    ];
    const byCode = c => LANGS.find(l => l.code === c);

    const PREF = "mbokal:lang";
    const store = {
        get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage bloqué */ } }
    };
    const warned = {
        get() { try { return sessionStorage.getItem("mbokal:lg-warned"); } catch (e) { return null; } },
        set() { try { sessionStorage.setItem("mbokal:lg-warned", "1"); } catch (e) { /* ignore */ } }
    };

    /* ---------- Langue choisie ---------- */
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl && byCode(fromUrl)) store.set(PREF, fromUrl);

    let saved = store.get(PREF);
    if (!byCode(saved)) saved = null;
    const lang = saved || "fr";                 // langue dans laquelle CETTE page est affichée

    function suggestion() {
        const n = (navigator.language || "fr").toLowerCase();
        return ["en", "pt", "sw", "ln"].find(c => n.indexOf(c) === 0) || "fr";
    }

    /* ---------- Petits outils ---------- */
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };

    function toast(text) {
        document.querySelectorAll(".lg-toast").forEach(n => n.remove());
        const t = el("div", "lg-toast", text);
        t.setAttribute("role", "status");
        t.setAttribute("translate", "no");
        document.body.append(t);
        setTimeout(() => t.remove(), 5000);
    }

    /* ---------- Choix de la langue ---------- */
    function choose(code) {
        store.set(PREF, code);
        saved = code;
        closeSheet();
        if (code === lang) return;               // déjà affichée dans cette langue
        const url = new URL(location.href);
        url.searchParams.delete("lang");
        history.replaceState(null, "", url);
        location.reload();                        // repart de la page d'origine : simple et fiable
    }

    let sheet = null;
    function closeSheet() {
        if (sheet) sheet.hidden = true;
        document.body.style.overflow = "";
    }

    function openSheet(welcome) {
        if (sheet) sheet.remove();
        sheet = el("div", "lg-sheet");
        const back = el("div", "lg-backdrop");
        const box = el("section", "lg-box");
        box.setAttribute("role", "dialog");
        box.setAttribute("aria-modal", "true");
        box.setAttribute("aria-labelledby", "lgTitle");

        const head = el("div", "lg-head");
        const title = el("h2", null, welcome ? "Choisis ta langue · Choose your language" : "Langue · Language");
        title.id = "lgTitle";
        title.setAttribute("translate", "no");
        head.append(title);
        if (!welcome) {
            const x = el("button", "lg-close", "✕");
            x.type = "button";
            x.setAttribute("aria-label", "Fermer");
            x.addEventListener("click", closeSheet);
            head.append(x);
            back.addEventListener("click", closeSheet);
        }

        const list = el("div", "lg-list");
        const suggest = welcome ? suggestion() : null;
        LANGS.forEach(l => {
            const b = el("button", "lg-choice");
            b.type = "button";
            b.dataset.lang = l.code;
            b.setAttribute("translate", "no");
            b.lang = l.code;
            const on = welcome ? l.code === suggest : l.code === lang;
            if (on) b.classList.add("on");
            b.setAttribute("aria-pressed", String(!welcome && l.code === lang));
            b.append(el("span", null, l.name), el("i", "fa-solid fa-check"));
            b.addEventListener("click", () => choose(l.code));
            list.append(b);
        });

        const note = el("p", "lg-note");
        if (welcome) {
            note.setAttribute("translate", "no");
            note.textContent = "Traduction automatique · Automatic translation";
        } else {
            note.textContent = "Traduction automatique. Les titres des mangas et les noms des personnages ne sont pas traduits.";
        }

        box.append(head, list, note);
        sheet.append(back, box);
        document.body.append(sheet);
        document.body.style.overflow = "hidden";
        const first = list.querySelector(".on") || list.firstChild;
        if (first) first.focus();
        sheet.addEventListener("keydown", e => { if (e.key === "Escape" && !welcome) closeSheet(); });
    }

    function wireHeader() {
        document.querySelectorAll("a.language").forEach(a => {
            a.setAttribute("translate", "no");
            a.setAttribute("aria-haspopup", "dialog");
            const t = Array.from(a.childNodes).reverse().find(n => n.nodeType === 3 && /\S/.test(n.nodeValue));
            if (t) t.nodeValue = " " + byCode(lang).short;
            a.addEventListener("click", e => { e.preventDefault(); openSheet(false); });
        });
        // Page Menu : liste des langues
        document.querySelectorAll(".language-choice[data-lang]").forEach(b => {
            b.setAttribute("translate", "no");
            b.classList.toggle("active-language", b.dataset.lang === lang);
            b.addEventListener("click", () => choose(b.dataset.lang));
        });
    }

    /* =====================================================
       TRADUCTION
    ===================================================== */
    const PROTEGES = new Set([
        "manga mbokal edition", "manga mbokal", "mbokal", "ishi no erito", "mani kongo", "nzango",
        "arai denimu", "kawasa nakada", "dinat haruki", "edition", "édition",
        "arai", "kawasa", "dinat", "alex", "alex hachiko", "virung", "manga mbokal visual", "manga mbokal news", "fr"
    ]);
    const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "CODE", "PRE", "SVG", "OPTION", "SELECT"]);
    const ATTRS = ["placeholder", "aria-label", "alt", "title"];
    const NO_TRANSLATE = '[translate="no"],.notranslate,[contenteditable="true"]';

    const MAX_N = 15;          // textes par envoi
    const MAX_CHARS = 3000;    // caractères par envoi

    const norm = s => s.replace(/\s+/g, " ").trim();
    const hasLetter = s => /\p{L}/u.test(s);

    function isProtected(key) {
        const k = key.toLowerCase();
        if (PROTEGES.has(k)) return true;
        return !!(window.MANGAS && window.MANGAS.some(m => m.titre && m.titre.toLowerCase() === k));
    }

    /* ----- Fichier de traductions (traductions.js) ----- */
    const LI = { en: 0, pt: 1, sw: 2, ln: 3 }[lang];
    const exact = new Map();             // texte (minuscules) -> [en, pt, sw, ln]
    const templates = [];                // modèles avec {0} (texte) et {#0} (nombre)
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    function compile(key, vals) {
        const re = /\{(#?)(\d+)\}/g;
        let last = 0, src = "^", literal = "", m;
        const order = [];
        while ((m = re.exec(key))) {
            const lit = key.slice(last, m.index);
            src += esc(lit); literal += lit;
            src += m[1] ? "(\\d+(?:[.,]\\d+)?)" : "([\\s\\S]+?)";
            order.push(Number(m[2]));
            last = re.lastIndex;
        }
        const tail = key.slice(last);
        src += esc(tail) + "$"; literal += tail;
        return { re: new RegExp(src, "i"), size: literal.length, words: hasLetter(literal), tr: vals[LI], order };
    }

    (function buildDictionary() {
        const D = window.MBOKAL_TRADUCTIONS;
        if (!D || LI === undefined) return;
        Object.keys(D).forEach(k => {
            const v = D[k];
            if (!Array.isArray(v) || !v[LI]) return;
            const nk = norm(k);
            if (/\{#?\d+\}/.test(nk)) templates.push(compile(nk, v));
            else exact.set(nk.toLowerCase(), v[LI]);
        });
        templates.sort((a, b) => b.size - a.size);       // les modèles les plus précis d'abord
    })();

    // MAJUSCULES dans la source -> majuscules dans la traduction
    const matchCase = (src, tr) => (src.length > 1 && src === src.toUpperCase() && src !== src.toLowerCase() ? tr.toLocaleUpperCase() : tr);

    function fromDictionary(key, depth) {
        depth = depth || 0;
        const hit = exact.get(key.toLowerCase());
        if (hit) return matchCase(key, hit);
        if (depth > 3) return null;
        for (const t of templates) {
            const m = t.re.exec(key);
            if (!m || !t.tr) continue;
            const caps = [];
            let any = false;
            for (let i = 1; i < m.length; i++) {
                const sub = fromDictionary(m[i], depth + 1);     // les morceaux sont traduits aussi s'ils sont connus
                if (sub !== null) any = true;
                caps[t.order[i - 1]] = sub !== null ? sub : m[i];
            }
            if (!any && !t.words) continue;                      // modèle sans mots (ex. « {0} • {1} ») : il faut au moins un morceau connu
            return matchCase(key, t.tr.replace(/\{(\d+)\}/g, (_, n) => (caps[Number(n)] !== undefined ? caps[Number(n)] : "")));
        }
        return null;
    }

    const wanted = new Set();            // textes sans traduction connue (pour le relevé des manquants)
    const useServer = !!(window.MBOKAL_CONFIG && window.MBOKAL_CONFIG.traductionServeur) || !!window.__MBOKAL_TRANSPORT__;

    // Pour les fenêtres qui ne sont pas dans la page (confirm, alert)
    function t(text) {
        if (lang === "fr") return text;
        const key = norm(String(text));
        return fromDictionary(key) || mem.get(key) || text;
    }
    window.MbokalLang = { t, lang, manquants: () => Array.from(wanted).filter(k => !mem.has(k)) };

    const mem = new Map();               // texte français -> traduction (langue courante)
    const failed = new Set();            // textes qu'on n'a pas pu traduire (pas de nouvel essai)
    const applied = new WeakMap();       // nœud texte -> valeur posée par nous
    const appliedAttr = new WeakMap();   // élément -> { attribut: valeur posée par nous }
    let fatal = false, errors = 0, inflight = 0, nullBatches = 0;

    /* ----- Mémoire de l'appareil ----- */
    const CACHE_KEY = "mbokal:tr:" + lang;
    function loadCache() {
        try { const o = JSON.parse(store.get(CACHE_KEY) || "{}"); Object.keys(o).forEach(k => mem.set(k, o[k])); }
        catch (e) { /* cache illisible : on repart de zéro */ }
    }
    let saveTimer = null;
    function saveCache() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const o = {};
            mem.forEach((v, k) => { o[k] = v; });
            const s = JSON.stringify(o);
            if (s.length < 700000) store.set(CACHE_KEY, s);   // au-delà : on ne garde pas (limite du navigateur)
        }, 500);
    }

    /* ----- Transport : appel à la base ----- */
    async function defaultTransport(l, texts) {
        const M = window.Mbokal;
        if (!M) { const e = new Error("indisponible"); e.code = "indisponible"; throw e; }
        await M.ready;
        if (M.mode !== "cloud") { const e = new Error("indisponible"); e.code = M.mode === "local" ? "local" : "indisponible"; throw e; }
        const r = await M._sb().rpc("traduire", { p_langue: l, p_textes: texts });
        if (r.error) throw r.error;
        return r.data;
    }
    const transport = window.__MBOKAL_TRANSPORT__ || defaultTransport;   // (crochet de test)

    function isFatal(err) {
        const code = String(err && err.code || "");
        const msg = String(err && err.message || "").toLowerCase();
        return ["indisponible", "local", "PGRST202", "PGRST301", "PGRST302", "42883", "401", "403", "404"].indexOf(code) !== -1
            || msg.indexOf("failed to fetch") !== -1 || msg.indexOf("networkerror") !== -1 || msg.indexOf("load failed") !== -1;
    }

    function warn(code) {
        if (warned.get()) return;
        warned.set();
        toast(code === "local"
            ? "La traduction automatique nécessite la version en ligne du site. Le texte reste en français."
            : "Traduction momentanément indisponible. Le texte reste en français.");
    }

    /* ----- Repérer les textes à traduire ----- */
    function eligibleText(n) {
        const p = n.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName)) return false;
        if (p.closest(NO_TRANSLATE)) return false;
        const v = n.nodeValue;
        return v.trim().length >= 2 && hasLetter(v);
    }

    function textItem(n) {
        if (!eligibleText(n)) return null;
        if (applied.get(n) === n.nodeValue) return null;            // déjà posé par nous
        const key = norm(n.nodeValue);
        return key ? { kind: "text", node: n, key } : null;
    }

    function attrItems(e, out) {
        if (e.closest(NO_TRANSLATE) || SKIP_TAGS.has(e.tagName)) return;
        ATTRS.forEach(a => {
            const raw = e.getAttribute(a);
            if (!raw || !hasLetter(raw)) return;
            const mine = appliedAttr.get(e);
            if (mine && mine[a] === raw) return;
            out.push({ kind: "attr", el: e, attr: a, key: norm(raw), raw });
        });
    }

    function collect(rootNode) {
        const out = [];
        if (rootNode.nodeType === 3) { const it = textItem(rootNode); if (it) out.push(it); return out; }
        const w = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) { const it = textItem(n); if (it) out.push(it); }
        if (rootNode.nodeType === 1) {
            attrItems(rootNode, out);
            rootNode.querySelectorAll("[placeholder],[aria-label],[alt],[title]").forEach(e => attrItems(e, out));
        }
        return out;
    }

    /* ----- Poser une traduction ----- */
    function apply(it, tr) {
        if (it.kind === "text") {
            const n = it.node;
            if (!n.isConnected || norm(n.nodeValue) !== it.key) return;       // le texte a changé entre-temps
            const m = n.nodeValue.match(/^(\s*)[\s\S]*?(\s*)$/);
            const v = m[1] + tr + m[2];
            n.nodeValue = v;
            applied.set(n, v);
        } else {
            const e = it.el;
            if (e.getAttribute(it.attr) !== it.raw) return;
            e.setAttribute(it.attr, tr);
            const mine = appliedAttr.get(e) || {};
            mine[it.attr] = tr;
            appliedAttr.set(e, mine);
        }
    }

    /* ----- Envoi par lots ----- */
    function busy(delta) {
        inflight += delta;
        root.classList.toggle("lg-busy", inflight > 0);
    }

    async function runBatch(keys, waiting) {
        if (fatal) return;
        try {
            const data = await transport(lang, keys);
            let got = 0;
            keys.forEach((k, i) => {
                const tr = Array.isArray(data) ? data[i] : null;
                if (typeof tr === "string" && tr) {
                    got++;
                    mem.set(k, tr);
                    (waiting.get(k) || []).forEach(it => apply(it, tr));
                } else {
                    failed.add(k);
                }
            });
            if (got) saveCache();
            else if (++nullBatches >= 2 && mem.size === 0) { fatal = true; warn(); }   // clé absente ou limite du jour atteinte
        } catch (err) {
            if (isFatal(err)) { fatal = true; warn(err.code); return; }
            if (++errors >= 8) { fatal = true; warn(); return; }
            if (keys.length > 1) {                       // délai dépassé, texte trop long... on coupe en deux
                const mid = keys.length >> 1;
                await runBatch(keys.slice(0, mid), waiting);
                await runBatch(keys.slice(mid), waiting);
            } else {
                failed.add(keys[0]);
            }
        }
    }

    async function process(items) {
        const waiting = new Map();
        items.forEach(it => {
            if (isProtected(it.key)) return;
            const fromFile = fromDictionary(it.key);
            if (fromFile !== null) { apply(it, fromFile); return; }          // a) fichier de traductions
            const known = mem.get(it.key);
            if (known) { apply(it, known); return; }                         // b) mémoire de l'appareil
            wanted.add(it.key);
            if (!useServer || failed.has(it.key)) return;                    // c) serveur : seulement si activé
            if (!waiting.has(it.key)) waiting.set(it.key, []);
            waiting.get(it.key).push(it);
        });
        const keys = Array.from(waiting.keys());
        if (!keys.length || fatal) return;

        const batches = [];
        let cur = [], chars = 0;
        keys.forEach(k => {
            if (cur.length >= MAX_N || (cur.length && chars + k.length > MAX_CHARS)) { batches.push(cur); cur = []; chars = 0; }
            cur.push(k); chars += k.length;
        });
        if (cur.length) batches.push(cur);

        busy(1);
        let next = 0;
        const worker = async () => { while (next < batches.length && !fatal) await runBatch(batches[next++], waiting); };
        await Promise.all([worker(), worker()]);
        busy(-1);
    }

    /* ----- Contenu ajouté après coup ----- */
    function watch() {
        const queue = new Set();
        let timer = null;
        const flush = () => {
            const items = [];
            queue.forEach(n => { if (n.isConnected) collect(n).forEach(it => items.push(it)); });
            queue.clear();
            if (items.length) process(items);
        };
        new MutationObserver(muts => {
            muts.forEach(m => {
                if (m.type === "characterData") queue.add(m.target);
                else m.addedNodes.forEach(n => queue.add(n));
            });
            clearTimeout(timer);
            timer = setTimeout(flush, 120);
        }).observe(root, { childList: true, subtree: true, characterData: true });
    }

    function startTranslation() {
        root.lang = lang;                                         // lecteurs d'écran : bonne prononciation
        const meta = document.createElement("meta");              // évite que le navigateur propose sa propre traduction
        meta.name = "google"; meta.content = "notranslate";
        document.head.append(meta);
        const spin = el("div", "lg-spin");
        spin.setAttribute("aria-hidden", "true");
        document.body.append(spin);
        loadCache();
        process(collect(root));
        watch();
    }

    /* ---------- Démarrage ---------- */
    function start() {
        wireHeader();
        if (!saved) openSheet(true);                              // première visite : on demande la langue
        if (lang !== "fr") startTranslation();
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
