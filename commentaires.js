/* =====================================================
   COMMENTAIRES D'UN CHAPITRE (avec réponses)
   MbokalComments.mount(conteneur, { mangaId, chapitre, onCount })
   onCount(delta) est appelé quand le nombre de commentaires change
   (+1 publication, -n suppression) pour mettre à jour les compteurs.
   Tout le texte est inséré avec textContent : aucun HTML saisi
   par un lecteur ne peut s'exécuter.
===================================================== */
(function () {
    "use strict";

    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const T = s => (window.MbokalLang ? MbokalLang.t(s) : s);   // pour confirm() : hors de la page
    const icon = (style, name) => el("i", "fa-" + style + " " + name);

    function ago(iso) {
        const s = (Date.now() - Date.parse(iso)) / 1000;
        if (!(s >= 0) || s < 60) return "à l'instant";
        if (s < 3600) return "il y a " + Math.floor(s / 60) + " min";
        if (s < 86400) return "il y a " + Math.floor(s / 3600) + " h";
        if (s < 2592000) return "il y a " + Math.floor(s / 86400) + " j";
        return new Date(iso).toLocaleDateString("fr-FR");
    }

    /* Zone de saisie réutilisée pour un commentaire et pour une réponse */
    function makeForm(o) {
        const max = Mbokal.comments.max;
        const form = el("form", "cm-form");
        const ta = el("textarea");
        ta.rows = o.rows || 3;
        ta.maxLength = max;
        ta.placeholder = o.placeholder;
        ta.setAttribute("aria-label", o.label);
        const err = el("p", "auth-error");
        err.setAttribute("role", "alert");
        const foot = el("div", "cm-foot");
        const count = el("span", "cm-count", "0 / " + max);
        const btns = el("div", "cm-btns");
        if (o.onCancel) {
            const cancel = el("button", "cm-act", "Annuler");
            cancel.type = "button";
            cancel.addEventListener("click", o.onCancel);
            btns.append(cancel);
        }
        const send = el("button", "btn-main cm-send", o.submit);
        send.type = "submit";
        send.disabled = true;
        btns.append(send);
        foot.append(count, btns);
        form.append(ta, err, foot);

        ta.addEventListener("input", () => {
            count.textContent = ta.value.length + " / " + max;
            send.disabled = !ta.value.trim();
        });
        form.addEventListener("submit", async e => {
            e.preventDefault();
            err.textContent = "";
            send.disabled = true;
            try {
                await o.onSubmit(ta.value);
                ta.value = "";
                count.textContent = "0 / " + max;
            } catch (ex) {
                err.textContent = ex.message;
                send.disabled = !ta.value.trim();
            }
        });
        form.focusField = () => ta.focus();
        return form;
    }

    function mount(root, opts) {
        const tok = {};
        root._tok = tok;
        const live = () => root._tok === tok;
        const bump = d => { if (opts.onCount && d) opts.onCount(d); };

        root.textContent = "";
        const formBox = el("div", "cm-form-box");
        const status = el("p", "cm-status");
        status.setAttribute("role", "status");
        const list = el("ul", "cm-list");
        const moreBtn = el("button", "btn-soft cm-more", "Voir plus de commentaires");
        moreBtn.type = "button";
        moreBtn.hidden = true;
        root.append(formBox, status, list, moreBtn);

        if (window.Mbokal && Mbokal.mode === "local") {
            root.append(el("p", "auth-note", "Mode démo : les commentaires restent sur cet appareil."));
        }

        let cursor = null;

        /* ----- Formulaire principal ----- */
        function renderForm() {
            formBox.textContent = "";
            if (!Mbokal.user()) {
                const p = el("p", "cm-login", "Connecte-toi pour commenter. ");
                const a = el("a", null, "Se connecter");
                a.href = "compte.html";
                p.append(a);
                formBox.append(p);
                return;
            }
            formBox.append(makeForm({
                label: "Ton commentaire",
                placeholder: "Ton avis sur ce chapitre (évite les spoilers)",
                submit: "Publier",
                onSubmit: async text => {
                    const c = await Mbokal.comments.add(opts.mangaId, opts.chapitre, text);
                    if (!live()) return;
                    status.textContent = "";
                    list.prepend(item(c, null));
                    bump(+1);
                }
            }));
        }

        /* ----- Un commentaire (ou une réponse si parent est fourni) ----- */
        function item(c, parent) {
            const li = el("li", parent ? "cm-item cm-reply" : "cm-item");
            const head = el("div", "cm-head");
            const who = el("strong", null, c.pseudo);
            who.setAttribute("translate", "no");
            head.append(who, el("span", null, ago(c.created_at)));
            const body = el("p", "cm-text", c.texte);
            const actions = el("div", "cm-actions");

            /* J'aime */
            const like = el("button", "cm-act");
            like.type = "button";
            const paintLike = () => {
                like.textContent = "";
                like.append(icon(c.liked ? "solid" : "regular", "fa-heart"), " " + c.likes);
                like.setAttribute("aria-pressed", String(c.liked));
                like.setAttribute("aria-label", (c.liked ? "Retirer le j'aime" : "J'aime") + ", " + c.likes + " au total");
                like.classList.toggle("on", c.liked);
            };
            paintLike();
            like.addEventListener("click", async () => {
                const was = c.liked;
                c.liked = !was; c.likes += was ? -1 : 1; paintLike();
                try { await Mbokal.comments.toggleLike(c.id, c.liked); }
                catch (ex) { c.liked = was; c.likes += was ? 1 : -1; paintLike(); Mbokal.toast(ex.message); }
            });
            actions.append(like);

            /* Réponses : seulement sur un commentaire principal */
            let repliesUl = null, toggle = null, replyForm = null;
            let loaded = false, expanded = false;

            const paintToggle = () => {
                if (!toggle) return;
                toggle.hidden = c.reponses === 0;
                toggle.textContent = "";
                toggle.append(icon("solid", expanded ? "fa-chevron-up" : "fa-chevron-down"),
                    expanded ? " Masquer les réponses" : " " + c.reponses + (c.reponses > 1 ? " réponses" : " réponse"));
                toggle.setAttribute("aria-expanded", String(expanded));
            };

            const showReplies = async () => {
                if (!loaded) {
                    toggle.disabled = true;
                    try {
                        const rs = await Mbokal.comments.replies(c.id);
                        rs.forEach(r => repliesUl.append(item(r, c)));
                        loaded = true;
                    } catch (ex) { Mbokal.toast(ex.message); toggle.disabled = false; return; }
                    toggle.disabled = false;
                }
                expanded = true;
                repliesUl.hidden = false;
                paintToggle();
            };

            if (!parent) {
                repliesUl = el("ul", "cm-replies");
                repliesUl.hidden = true;
                toggle = el("button", "cm-act cm-toggle");
                toggle.type = "button";
                toggle.addEventListener("click", () => {
                    if (expanded) { expanded = false; repliesUl.hidden = true; paintToggle(); }
                    else showReplies();
                });

                const reply = el("button", "cm-act");
                reply.type = "button";
                reply.append(icon("regular", "fa-comment-dots"), " Répondre");
                reply.addEventListener("click", () => {
                    if (!Mbokal.user()) { Mbokal.toast("Connecte-toi pour répondre."); return; }
                    if (replyForm) { replyForm.remove(); replyForm = null; return; }
                    replyForm = makeForm({
                        rows: 2,
                        label: "Ta réponse à " + c.pseudo,
                        placeholder: "Répondre à " + c.pseudo,
                        submit: "Répondre",
                        onCancel: () => { replyForm.remove(); replyForm = null; },
                        onSubmit: async text => {
                            await showReplies();                       // charge les réponses existantes avant d'ajouter
                            const r = await Mbokal.comments.add(opts.mangaId, opts.chapitre, text, c.id);
                            if (!live()) return;
                            repliesUl.append(item(r, c));
                            c.reponses += 1;
                            paintToggle();
                            bump(+1);
                            replyForm.remove(); replyForm = null;
                        }
                    });
                    li.insertBefore(replyForm, repliesUl);
                    replyForm.focusField();
                });
                actions.append(reply);
            }

            /* Supprimer (les siens) ou signaler (ceux des autres) */
            if (c.mine) {
                const del = el("button", "cm-act");
                del.type = "button";
                del.append(icon("regular", "fa-trash-can"), " Supprimer");
                del.addEventListener("click", async () => {
                    const msg = !parent && c.reponses ? "Supprimer ton commentaire et ses " + c.reponses + " réponse(s) ?" : "Supprimer ton commentaire ?";
                    if (!confirm(T(msg))) return;
                    try {
                        await Mbokal.comments.remove(c.id);
                        li.remove();
                        if (parent) { parent.reponses -= 1; bump(-1); if (parent._paint) parent._paint(); }
                        else { bump(-(1 + c.reponses)); }
                        if (!list.children.length) status.textContent = "Aucun commentaire pour ce chapitre.";
                    } catch (ex) { Mbokal.toast(ex.message); }
                });
                actions.append(del);
            } else {
                const rep = el("button", "cm-act");
                rep.type = "button";
                rep.append(icon("regular", "fa-flag"), " Signaler");
                rep.addEventListener("click", async () => {
                    if (!confirm(T("Signaler ce commentaire à l'équipe ?"))) return;
                    try {
                        await Mbokal.comments.report(c.id, "autre");
                        rep.disabled = true;
                        rep.textContent = "Signalé";
                        Mbokal.toast("Merci, l'équipe va regarder ce commentaire.");
                    } catch (ex) { Mbokal.toast(ex.message); }
                });
                actions.append(rep);
            }

            c._paint = paintToggle;     // permet à une réponse supprimée de mettre à jour son parent
            li.append(head, body, actions);
            if (!parent) { paintToggle(); li.append(toggle, repliesUl); }
            return li;
        }

        /* ----- Chargement ----- */
        async function load(more) {
            moreBtn.disabled = true;
            if (!more) { list.textContent = ""; cursor = null; status.textContent = "Chargement…"; }
            try {
                const r = await Mbokal.comments.list(opts.mangaId, opts.chapitre, more ? cursor : null);
                if (!live()) return;
                status.textContent = !more && !r.items.length ? "Aucun commentaire pour ce chapitre. Sois le premier à réagir." : "";
                r.items.forEach(c => list.append(item(c, null)));
                if (r.items.length) cursor = r.items[r.items.length - 1].created_at;
                moreBtn.hidden = !r.hasMore;
            } catch (ex) {
                if (!live()) return;
                status.textContent = ex.message;
            }
            moreBtn.disabled = false;
        }

        moreBtn.addEventListener("click", () => load(true));

        Mbokal.onChange(() => { if (live()) { renderForm(); load(false); } });
        Mbokal.ready.then(() => { if (live()) { renderForm(); load(false); } });
    }

    window.MbokalComments = { mount };
})();
