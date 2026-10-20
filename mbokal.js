/* =====================================================
   MBOKAL — comptes, favoris, historique de lecture
   Une seule API pour tout le site : window.Mbokal

   Deux modes, choisis par config.js :
   - "local"  : démo, tout reste sur l'appareil
   - "cloud"  : Supabase (vrais comptes, synchronisés)
===================================================== */
(function () {
    "use strict";

    const cfg = window.MBOKAL_CONFIG || {};
    const wantsCloud = !!(cfg.supabaseUrl && cfg.supabaseKey);
    let mode = wantsCloud ? "cloud" : "local";
    let sb = null;
    let current = null;               // { id, email, pseudo } ou null (visiteur)
    const listeners = [];

    /* ---------- Stockage local ---------- */
    const LS = {
        get(k, f) {
            try { const r = localStorage.getItem("mbokal:" + k); return r ? JSON.parse(r) : f; }
            catch (e) { return f; }
        },
        set(k, v) {
            try { localStorage.setItem("mbokal:" + k, JSON.stringify(v)); }
            catch (e) { /* stockage bloqué : on continue */ }
        }
    };

    const emit = () => listeners.forEach(fn => { try { fn(current); } catch (e) { /* ignore */ } });

    /* ---------- Messages d'erreur ---------- */
    const fail = msg => { throw new Error(msg); };

    function cloudError(error) {
        const m = (error && error.message || "").toLowerCase();
        if (m.includes("already registered")) return "Un compte existe déjà avec cet e-mail.";
        if (m.includes("invalid login")) return "E-mail ou mot de passe incorrect.";
        if (m.includes("not confirmed")) return "Confirme d'abord ton e-mail (lien reçu dans ta boîte).";
        if (m.includes("password")) return "Mot de passe trop faible : 8 caractères minimum.";
        if (m.includes("rate") || m.includes("too many")) return "Trop d'essais. Attends une minute puis réessaie.";
        return "Une erreur est survenue. Réessaie dans un instant.";
    }

    function checkFields(email, password, pseudo) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Entre une adresse e-mail valide.");
        if (password.length < 8) fail("Le mot de passe doit faire au moins 8 caractères.");
        if (pseudo !== undefined && (pseudo.length < 2 || pseudo.length > 24)) fail("Le pseudo doit faire entre 2 et 24 caractères.");
    }

    /* ---------- Données : une interface, deux implémentations ---------- */
    // prefix "" = visiteur (mêmes clés que le lecteur : "favoris", "progress")
    function localData(prefix) {
        return {
            async favs() { return LS.get(prefix + "favoris", []); },
            async setFav(id, on) {
                const list = LS.get(prefix + "favoris", []).filter(x => x !== id);
                if (on) list.unshift(id);
                LS.set(prefix + "favoris", list);
            },
            async progress() { return LS.get(prefix + "progress", {}); },
            async setProgress(id, entry) {
                const all = LS.get(prefix + "progress", {});
                all[id] = entry;
                LS.set(prefix + "progress", all);
            }
        };
    }

    function cloudData(uid) {
        const check = r => { if (r.error) throw r.error; return r.data; };
        return {
            async favs() {
                const rows = check(await sb.from("favoris").select("manga_id").order("created_at", { ascending: false }));
                return rows.map(r => r.manga_id);
            },
            async setFav(id, on) {
                if (on) {
                    check(await sb.from("favoris").upsert({ user_id: uid, manga_id: id },
                        { onConflict: "user_id,manga_id", ignoreDuplicates: true }));
                } else {
                    check(await sb.from("favoris").delete().eq("user_id", uid).eq("manga_id", id));
                }
            },
            async progress() {
                const rows = check(await sb.from("progression").select("*"));
                const out = {};
                rows.forEach(r => {
                    out[r.manga_id] = { chapitre: r.chapitre, page: r.page, lus: r.lus || [], maj: Date.parse(r.maj) || 0 };
                });
                return out;
            },
            async setProgress(id, e) {
                check(await sb.from("progression").upsert({
                    user_id: uid, manga_id: id, chapitre: e.chapitre, page: e.page || 0,
                    lus: e.lus || [], maj: new Date(e.maj || Date.now()).toISOString()
                }, { onConflict: "user_id,manga_id" }));
            }
        };
    }

    function data() {
        if (!current) return localData("");
        return mode === "cloud" ? cloudData(current.id) : localData("u:" + current.id + ":");
    }

    // À la connexion : ce que le visiteur a fait avant est ajouté au compte
    async function mergeGuest() {
        const guest = localData("");
        const d = data();
        const gf = await guest.favs();
        const cf = await d.favs();
        for (const id of gf) if (cf.indexOf(id) === -1) await d.setFav(id, true);

        const gp = await guest.progress();
        const cp = await d.progress();
        for (const id of Object.keys(gp)) {
            const g = gp[id], c = cp[id];
            if (!c || (g.maj || 0) > (c.maj || 0)) {
                const lus = Array.from(new Set([].concat(g.lus || [], c && c.lus || [])));
                await d.setProgress(id, Object.assign({}, g, { lus }));
            }
        }
    }

    /* ---------- Comptes : mode local (démo) ---------- */
    async function pbkdf2(password, salt) {
        if (!(window.crypto && crypto.subtle)) fail("Ce navigateur ne permet pas de créer un compte ici. Ouvre le site en https.");
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
        const bits = await crypto.subtle.deriveBits(
            { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256);
        return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    const randomHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)))
        .map(b => b.toString(16).padStart(2, "0")).join("");

    const local = {
        restore() {
            const s = LS.get("session", null);
            const users = LS.get("users", {});
            const u = s && Object.values(users).find(x => x.id === s.id);
            current = u ? { id: u.id, email: u.email, pseudo: u.pseudo } : null;
        },
        async signUp(email, password, pseudo) {
            checkFields(email, password, pseudo);
            const users = LS.get("users", {});
            if (users[email]) fail("Un compte existe déjà avec cet e-mail.");
            const salt = randomHex(16);
            users[email] = { id: "u" + randomHex(8), email, pseudo, salt, hash: await pbkdf2(password, salt) };
            LS.set("users", users);
            LS.set("session", { id: users[email].id });
            local.restore();
            await mergeGuest();
            emit();
            return { confirm: false };
        },
        async signIn(email, password) {
            checkFields(email, password);
            const u = LS.get("users", {})[email];
            const ok = u && (await pbkdf2(password, u.salt)) === u.hash;
            if (!ok) fail("E-mail ou mot de passe incorrect.");
            LS.set("session", { id: u.id });
            local.restore();
            await mergeGuest();
            emit();
        },
        async signOut() { LS.set("session", null); current = null; emit(); }
    };

    /* ---------- Comptes : mode cloud (Supabase) ---------- */
    const toUser = u => u ? { id: u.id, email: u.email, pseudo: (u.user_metadata && u.user_metadata.pseudo) || u.email.split("@")[0] } : null;

    const cloud = {
        async signUp(email, password, pseudo) {
            checkFields(email, password, pseudo);
            const { data: d, error } = await sb.auth.signUp({ email, password, options: { data: { pseudo } } });
            if (error) fail(cloudError(error));
            if (!d.session) return { confirm: true };     // confirmation par e-mail requise
            current = toUser(d.user);
            await mergeGuest();
            emit();
            return { confirm: false };
        },
        async signIn(email, password) {
            checkFields(email, password);
            const { data: d, error } = await sb.auth.signInWithPassword({ email, password });
            if (error) fail(cloudError(error));
            current = toUser(d.user);
            await mergeGuest();
            emit();
        },
        async signOut() { await sb.auth.signOut(); current = null; emit(); }
    };

    const driver = () => (mode === "cloud" ? cloud : local);

    /* ---------- Démarrage ---------- */
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src; s.onload = resolve; s.onerror = reject;
            document.head.append(s);
        });
    }

    const ready = (async function () {
        if (wantsCloud) {
            try {
                await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
                sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
                const { data: d } = await sb.auth.getSession();
                current = toUser(d.session && d.session.user);
                sb.auth.onAuthStateChange((_event, session) => { current = toUser(session && session.user); emit(); });
                return;
            } catch (e) {
                mode = "offline";   // service injoignable : on reste en mode visiteur
                current = null;
                return;
            }
        }
        local.restore();
    })();

    /* ---------- Commentaires (avec réponses et compteurs) ---------- */
    const COMMENTS_PAGE = 20;
    const REPLIES_MAX = 100;
    const COMMENT_MAX = 1000;
    const ck = r => { if (r.error) throw r.error; return r.data; };
    const needLogin = what => { if (!current) fail("Connecte-toi pour " + what + "."); };
    const commentError = e => {
        const m = (e && e.message || "").toLowerCase();
        if (m.includes("trop_rapide")) return "Attends quelques secondes avant de publier à nouveau.";
        if (m.includes("parent_invalide")) return "Le commentaire auquel tu réponds n'existe plus.";
        if (e && e.message && !m.includes("violates") && !m.includes("row-level") && !m.includes("jwt") && !m.includes("fetch")) return e.message;
        return "Une erreur est survenue. Réessaie dans un instant.";
    };
    const cleanText = t => String(t || "").replace(/\r\n/g, "\n").trim();

    const localComments = {
        shape(c, likes, replyCount) {
            return {
                id: c.id, pseudo: c.pseudo, texte: c.texte, created_at: c.created_at,
                likes: (likes[c.id] || []).length,
                liked: !!current && (likes[c.id] || []).indexOf(current.id) !== -1,
                mine: !!current && c.user_id === current.id,
                reponses: replyCount
            };
        },
        async list(manga, chap, before) {
            const likes = LS.get("likes", {});
            const all = LS.get("comments", []);
            const rows = all
                .filter(c => !c.parent_id && !c.masque && c.manga_id === manga && c.chapitre === chap && (!before || c.created_at < before))
                .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
            return {
                items: rows.slice(0, COMMENTS_PAGE).map(c =>
                    localComments.shape(c, likes, all.filter(r => r.parent_id === c.id).length)),
                hasMore: rows.length > COMMENTS_PAGE
            };
        },
        async replies(parentId) {
            const likes = LS.get("likes", {});
            return LS.get("comments", [])
                .filter(c => c.parent_id === parentId)
                .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
                .slice(0, REPLIES_MAX)
                .map(c => localComments.shape(c, likes, 0));
        },
        async add(manga, chap, texte, parentId) {
            const all = LS.get("comments", []);
            if (parentId && !all.some(c => c.id === parentId && !c.parent_id)) fail("Le commentaire auquel tu réponds n'existe plus.");
            const last = all.filter(c => c.user_id === current.id).map(c => c.created_at).sort().pop();
            if (last && Date.now() - Date.parse(last) < 10000) fail("Attends quelques secondes avant de publier à nouveau.");
            const c = { id: "c" + randomHex(6), manga_id: manga, chapitre: chap, parent_id: parentId || null,
                        user_id: current.id, pseudo: current.pseudo, texte, created_at: new Date().toISOString() };
            all.push(c);
            LS.set("comments", all);
            return localComments.shape(c, {}, 0);
        },
        async like(id, on) {
            const likes = LS.get("likes", {});
            const list = (likes[id] || []).filter(u => u !== current.id);
            if (on) list.push(current.id);
            likes[id] = list;
            LS.set("likes", likes);
        },
        async remove(id) {
            const all = LS.get("comments", []);
            const mine = all.find(c => c.id === id && c.user_id === current.id);
            if (!mine) return;
            LS.set("comments", all.filter(c => c.id !== id && c.parent_id !== id));   // ses réponses partent avec lui
        },
        async report(id, motif) {
            const r = LS.get("reports", []);
            if (!r.some(x => x.comment_id === id && x.user_id === current.id)) r.push({ comment_id: id, user_id: current.id, motif, at: Date.now() });
            LS.set("reports", r);
        },
        async counts(manga) {
            const out = {};
            LS.get("comments", []).filter(c => c.manga_id === manga).forEach(c => { out[c.chapitre] = (out[c.chapitre] || 0) + 1; });
            return out;
        }
    };

    const cloudComments = {
        async shape(rows) {
            let mine = [];
            if (current && rows.length) {
                mine = ck(await sb.from("likes_commentaires").select("comment_id")
                    .eq("user_id", current.id).in("comment_id", rows.map(r => r.id))).map(r => r.comment_id);
            }
            return rows.map(r => ({
                id: r.id, pseudo: r.pseudo, texte: r.texte, created_at: r.created_at,
                likes: (r.likes && r.likes[0] && r.likes[0].count) || 0,
                liked: mine.indexOf(r.id) !== -1,
                mine: !!current && r.user_id === current.id,
                reponses: (r.reponses && r.reponses[0] && r.reponses[0].count) || 0
            }));
        },
        async list(manga, chap, before) {
            let q = sb.from("commentaires")
                .select("id,user_id,pseudo,texte,created_at,likes:likes_commentaires(count),reponses:commentaires!parent_id(count)")
                .eq("manga_id", manga).eq("chapitre", chap).is("parent_id", null)
                .order("created_at", { ascending: false }).limit(COMMENTS_PAGE + 1);
            if (before) q = q.lt("created_at", before);
            const rows = ck(await q);
            return { items: await cloudComments.shape(rows.slice(0, COMMENTS_PAGE)), hasMore: rows.length > COMMENTS_PAGE };
        },
        async replies(parentId) {
            const rows = ck(await sb.from("commentaires")
                .select("id,user_id,pseudo,texte,created_at,likes:likes_commentaires(count)")
                .eq("parent_id", parentId).order("created_at", { ascending: true }).limit(REPLIES_MAX));
            return cloudComments.shape(rows);
        },
        async add(manga, chap, texte, parentId) {
            // user_id et pseudo sont fixés côté serveur (déclencheur SQL) : impossible de se faire passer pour quelqu'un
            const r = ck(await sb.from("commentaires")
                .insert({ manga_id: manga, chapitre: chap, texte, parent_id: parentId || null })
                .select("id,user_id,pseudo,texte,created_at").single());
            return { id: r.id, pseudo: r.pseudo, texte: r.texte, created_at: r.created_at, likes: 0, liked: false, mine: true, reponses: 0 };
        },
        async like(id, on) {
            if (on) ck(await sb.from("likes_commentaires").upsert({ comment_id: id, user_id: current.id },
                { onConflict: "comment_id,user_id", ignoreDuplicates: true }));
            else ck(await sb.from("likes_commentaires").delete().eq("comment_id", id).eq("user_id", current.id));
        },
        async remove(id) { ck(await sb.from("commentaires").delete().eq("id", id).eq("user_id", current.id)); },
        async report(id, motif) {
            const r = await sb.from("signalements").insert({ comment_id: id, motif });
            if (r.error && r.error.code !== "23505") throw r.error;   // 23505 = déjà signalé : pas grave
        },
        async counts(manga) {
            const out = {};
            ck(await sb.rpc("compter_commentaires", { p_manga: manga })).forEach(r => { out[r.chapitre] = Number(r.total); });
            return out;
        }
    };

    const commentsDriver = () => (mode === "cloud" ? cloudComments : localComments);

    const comments = {
        async list(manga, chap, before) {
            await ready;
            if (mode === "offline") fail("Les commentaires sont injoignables pour le moment.");
            try { return await commentsDriver().list(manga, Number(chap), before || null); }
            catch (e) { fail(commentError(e)); }
        },
        async replies(parentId) {
            await ready;
            try { return await commentsDriver().replies(parentId); }
            catch (e) { fail(commentError(e)); }
        },
        async add(manga, chap, texte, parentId) {
            await ready;
            needLogin(parentId ? "répondre" : "commenter");
            texte = cleanText(texte);
            if (!texte) fail("Écris quelque chose avant de publier.");
            if (texte.length > COMMENT_MAX) fail("Ton commentaire dépasse " + COMMENT_MAX + " caractères.");
            try { return await commentsDriver().add(manga, Number(chap), texte, parentId || null); }
            catch (e) { fail(commentError(e)); }
        },
        async toggleLike(id, on) {
            await ready; needLogin("aimer un commentaire");
            try { await commentsDriver().like(id, on); } catch (e) { fail(commentError(e)); }
        },
        async remove(id) {
            await ready; needLogin("supprimer ton commentaire");
            try { await commentsDriver().remove(id); } catch (e) { fail(commentError(e)); }
        },
        async report(id, motif) {
            await ready; needLogin("signaler un commentaire");
            try { await commentsDriver().report(id, motif || "autre"); } catch (e) { fail(commentError(e)); }
        },
        // { numeroChapitre: nombre } — commentaires + réponses. Ne bloque jamais la lecture : {} si indisponible.
        async counts(manga) {
            await ready;
            if (mode === "offline") return {};
            try { return await commentsDriver().counts(manga); } catch (e) { return {}; }
        },
        max: COMMENT_MAX
    };

    /* ---------- Statistiques : vues, lectures, avis ---------- */
    const today = () => new Date().toISOString().slice(0, 10);
    const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    function deviceId() {
        let d = LS.get("device", null);
        if (!d) { d = randomHex(12); LS.set("device", d); }
        return d;
    }
    const num = v => Number(v) || 0;

    // Mode démo : les chiffres ne concernent que cet appareil
    const localStats = {
        async event(manga, chap, type) {
            const seen = LS.get("stats-vus", {});
            const key = [manga, chap, type, today()].join(":");
            if (seen[key]) return;
            Object.keys(seen).forEach(k => { if (k.split(":")[3] !== today()) delete seen[k]; });
            seen[key] = 1;
            LS.set("stats-vus", seen);
            const all = LS.get("stats-jour", {});
            const row = (all[manga] = all[manga] || {});
            const cell = (row[today()] = row[today()] || [0, 0]);
            cell[type === "vue" ? 0 : 1] += 1;
            LS.set("stats-jour", all);
        },
        sums(manga, since) {
            const row = LS.get("stats-jour", {})[manga] || {};
            let v = 0, l = 0;
            Object.keys(row).forEach(d => { if (d >= since) { v += row[d][0]; l += row[d][1]; } });
            return { vues: v, lus: l };
        },
        favoris(manga) {
            let n = LS.get("favoris", []).indexOf(manga) !== -1 ? 1 : 0;
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (/^mbokal:u:.+:favoris$/.test(k)) {
                    try { if (JSON.parse(localStorage.getItem(k)).indexOf(manga) !== -1) n++; } catch (e) { /* ignore */ }
                }
            }
            return n;
        },
        avis(manga) {
            const all = LS.get("avis", {});
            let up = 0, down = 0;
            Object.keys(all).forEach(u => { if (all[u][manga] === 1) up++; else if (all[u][manga] === -1) down++; });
            return { likes: up, dislikes: down };
        },
        async summary(manga) {
            return Object.assign({ manga_id: manga }, localStats.sums(manga, "2000-01-01"),
                { favoris: localStats.favoris(manga) }, localStats.avis(manga));
        },
        async top(period) {
            const since = period === "semaine" ? daysAgo(6) : period === "mois" ? daysAgo(29) : "2000-01-01";
            return (window.MANGAS || []).map(m => Object.assign({ manga_id: m.id, titre: m.titre },
                localStats.sums(m.id, since), { favoris: localStats.favoris(m.id) }, localStats.avis(m.id)));
        },
        async myRating(manga) { return ((LS.get("avis", {})[current.id]) || {})[manga] || 0; },
        async rate(manga, value) {
            const all = LS.get("avis", {});
            const mine = (all[current.id] = all[current.id] || {});
            if (value === 0) delete mine[manga]; else mine[manga] = value;
            LS.set("avis", all);
        }
    };

    const cloudStats = {
        async event(manga, chap, type) {
            ck(await sb.rpc("enregistrer_evenement", { p_manga: manga, p_chapitre: chap, p_type: type, p_appareil: deviceId() }));
        },
        async summary(manga) {
            const r = ck(await sb.rpc("stats_manga", { p_manga: manga }));
            const row = (r && r[0]) || {};
            return { manga_id: manga, vues: num(row.vues), lus: num(row.lus), favoris: num(row.favoris), likes: num(row.likes), dislikes: num(row.dislikes) };
        },
        async top(period) {
            return ck(await sb.rpc("top_mangas", { p_periode: period })).map(r => ({
                manga_id: r.manga_id, titre: r.titre, vues: num(r.vues), lus: num(r.lus),
                favoris: num(r.favoris), likes: num(r.likes), dislikes: num(r.dislikes)
            }));
        },
        async myRating(manga) {
            const r = await sb.from("avis_manga").select("valeur").eq("manga_id", manga).eq("user_id", current.id).maybeSingle();
            return r.data ? r.data.valeur : 0;
        },
        async rate(manga, value) {
            if (value === 0) ck(await sb.from("avis_manga").delete().eq("manga_id", manga).eq("user_id", current.id));
            else ck(await sb.from("avis_manga").upsert({ user_id: current.id, manga_id: manga, valeur: value }, { onConflict: "user_id,manga_id" }));
        }
    };

    const statsDriver = () => (mode === "cloud" ? cloudStats : localStats);
    const statsDown = "Les statistiques sont injoignables pour le moment.";

    const stats = {
        // type : "vue" (chapitre ouvert) ou "lu" (chapitre terminé). Ne bloque jamais la lecture.
        async event(manga, chapitre, type) {
            await ready;
            if (mode === "offline") return;
            try { await statsDriver().event(manga, Number(chapitre), type); } catch (e) { /* le compteur n'est pas vital */ }
        },
        async summary(manga) {
            await ready;
            if (mode === "offline") fail(statsDown);
            try { return await statsDriver().summary(manga); } catch (e) { fail(statsDown); }
        },
        async top(period) {
            await ready;
            if (mode === "offline") fail(statsDown);
            try { return await statsDriver().top(period || "tout"); } catch (e) { fail(statsDown); }
        },
        async myRating(manga) {
            await ready;
            if (!current || mode === "offline") return 0;
            try { return await statsDriver().myRating(manga); } catch (e) { return 0; }
        },
        // value : 1 (j'aime), -1 (je n'aime pas), 0 (retirer son avis)
        async rate(manga, value) {
            await ready;
            needLogin("donner ton avis");
            if ([1, -1, 0].indexOf(value) === -1) return;
            try { await statsDriver().rate(manga, value); } catch (e) { fail("Impossible d'enregistrer ton avis. Réessaie."); }
        }
    };

    /* ---------- Illustrations : ♥ et vues ---------- */
    const localIllus = {
        async view(id) { const all = LS.get("illus-vues", {}); all[id] = num(all[id]) + 1; LS.set("illus-vues", all); },
        async counters(ids) {
            const v = LS.get("illus-vues", {}), l = LS.get("illus-likes", {}), out = {};
            ids.forEach(id => { out[id] = { vues: num(v[id]), likes: Object.keys(l[id] || {}).length }; });
            return out;
        },
        async mine(ids) { const l = LS.get("illus-likes", {}); return ids.filter(id => current && (l[id] || {})[current.id]); },
        async like(id, on) {
            const l = LS.get("illus-likes", {});
            const m = l[id] || (l[id] = {});
            if (on) m[current.id] = 1; else delete m[current.id];
            LS.set("illus-likes", l);
        }
    };

    const cloudIllus = {
        async view(id) { ck(await sb.rpc("illustration_vue", { p_id: id, p_appareil: deviceId() })); },
        async counters(ids) {
            const rows = ck(await sb.rpc("illustrations_compteurs", { p_ids: ids }));
            const out = {};
            rows.forEach(r => { out[r.illustration_id] = { vues: num(r.vues), likes: num(r.likes) }; });
            return out;
        },
        async mine(ids) {
            return ck(await sb.from("illustration_likes").select("illustration_id")
                .eq("user_id", current.id).in("illustration_id", ids)).map(r => r.illustration_id);
        },
        async like(id, on) {
            if (on) ck(await sb.from("illustration_likes").upsert({ illustration_id: id, user_id: current.id },
                { onConflict: "illustration_id,user_id", ignoreDuplicates: true }));
            else ck(await sb.from("illustration_likes").delete().eq("illustration_id", id).eq("user_id", current.id));
        }
    };

    const illusDriver = () => (mode === "cloud" ? cloudIllus : localIllus);

    const illus = {
        // Une vue par appareil et par jour (le serveur le garantit aussi)
        async view(id) {
            await ready;
            if (mode === "offline") return;
            const seen = LS.get("illus-seen", {});
            const k = id + ":" + today();
            if (seen[k]) return;
            Object.keys(seen).forEach(x => { if (x.slice(-10) !== today()) delete seen[x]; });
            seen[k] = 1;
            LS.set("illus-seen", seen);
            try { await illusDriver().view(id); } catch (e) { /* le compteur n'est pas vital */ }
        },
        async counters(ids) {
            await ready;
            if (mode === "offline" || !ids.length) return {};
            try { return await illusDriver().counters(ids); } catch (e) { return {}; }
        },
        async mine(ids) {
            await ready;
            if (!current || mode === "offline" || !ids.length) return [];
            try { return await illusDriver().mine(ids); } catch (e) { return []; }
        },
        async like(id, on) {
            await ready;
            needLogin("aimer une illustration");
            try { await illusDriver().like(id, on); } catch (e) { fail("Impossible d'enregistrer ton ♥. Réessaie."); }
        }
    };

    /* ---------- Administration ---------- */
    const adminError = e => ((e && e.message) || "").indexOf("reserve_admin") !== -1
        ? "Réservé aux administrateurs." : "L'opération a échoué. Réessaie dans un instant.";

    const localAdmin = {
        async team() {
            return Object.values(LS.get("users", {})).map(u => ({ user_id: u.id, email: u.email, pseudo: u.pseudo, role: "admin" }));
        },
        async addMember() { fail("La gestion de l'équipe est disponible avec la base en ligne."); },
        async removeMember() { fail("La gestion de l'équipe est disponible avec la base en ligne."); },
        async reports() {
            const comments = LS.get("comments", []);
            const by = {};
            LS.get("reports", []).forEach(r => {
                const c = comments.find(x => x.id === r.comment_id);
                if (!c) return;
                const e = (by[c.id] = by[c.id] || { comment_id: c.id, texte: c.texte, pseudo: c.pseudo, manga_id: c.manga_id,
                                                      chapitre: c.chapitre, masque: !!c.masque, nb: 0, dernier: 0 });
                e.nb += 1; e.dernier = Math.max(e.dernier, r.at || 0);
            });
            return Object.values(by).sort((a, b) => b.dernier - a.dernier);
        },
        async moderate(id, action) {
            let all = LS.get("comments", []);
            if (action === "masquer" || action === "afficher") all.forEach(c => { if (c.id === id) c.masque = action === "masquer"; });
            else if (action === "supprimer") all = all.filter(c => c.id !== id && c.parent_id !== id);
            else if (action === "ignorer") LS.set("reports", LS.get("reports", []).filter(r => r.comment_id !== id));
            if (action !== "ignorer") LS.set("comments", all);
        }
    };

    const cloudAdmin = {
        async team() { return ck(await sb.rpc("equipe_liste")); },
        async addMember(email, role) {
            const r = ck(await sb.rpc("equipe_ajouter", { p_email: email, p_role: role }));
            if (r === "inconnu") fail("Aucun compte avec cet e-mail. La personne doit d'abord créer son compte sur le site.");
            if (r === "dernier_admin") fail("Il doit rester au moins un administrateur.");
        },
        async removeMember(id) {
            const r = ck(await sb.rpc("equipe_retirer", { p_user: id }));
            if (r === "dernier_admin") fail("Il doit rester au moins un administrateur.");
        },
        async reports() { return ck(await sb.rpc("signalements_liste")); },
        async moderate(id, action) { ck(await sb.rpc("moderer_commentaire", { p_id: id, p_action: action })); }
    };

    const adminDriver = () => (mode === "cloud" ? cloudAdmin : localAdmin);
    const adminCall = name => async function () {
        await ready;
        if (!current) fail("Connecte-toi pour continuer.");
        if (mode === "offline") fail("Le service est injoignable. Réessaie plus tard.");
        try { return await adminDriver()[name].apply(null, arguments); }
        catch (e) { if (e && e.message && /^(Aucun|Il doit|La gestion|Connecte)/.test(e.message)) throw e; fail(adminError(e)); }
    };
    const admin = {
        team: adminCall("team"), addMember: adminCall("addMember"), removeMember: adminCall("removeMember"),
        reports: adminCall("reports"), moderate: adminCall("moderate")
    };

    async function isAdmin() {
        await ready;
        if (!current) return false;
        if (mode === "local") return true;                    // démo : tout compte peut tester l'administration
        if (mode !== "cloud") return false;
        const r = await sb.from("equipe").select("role").eq("user_id", current.id).maybeSingle();
        return !r.error && !!r.data && r.data.role === "admin";
    }

    /* ---------- API publique ---------- */
    const Mbokal = {
        ready,
        get mode() { return mode; },
        user: () => current,
        onChange(fn) { listeners.push(fn); },

        async signUp(email, password, pseudo) {
            await ready;
            if (mode === "offline") fail("Le service de comptes est injoignable. Réessaie plus tard.");
            return driver().signUp(String(email).trim().toLowerCase(), password, String(pseudo).trim());
        },
        async signIn(email, password) {
            await ready;
            if (mode === "offline") fail("Le service de comptes est injoignable. Réessaie plus tard.");
            return driver().signIn(String(email).trim().toLowerCase(), password);
        },
        async signOut() { await ready; if (mode !== "offline") await driver().signOut(); },

        async favorites() { await ready; return data().favs(); },
        async toggleFavorite(id) {
            await ready;
            const on = (await data().favs()).indexOf(id) === -1;
            await data().setFav(id, on);
            return on;
        },

        async progress() { await ready; return data().progress(); },
        // Visiteur : le lecteur a déjà écrit sa progression sur l'appareil, rien à faire ici.
        async saveProgress(id, entry) {
            await ready;
            if (!current) return;
            try { await data().setProgress(id, entry); } catch (e) { /* hors ligne : on réessaiera à la page suivante */ }
        },

        comments,
        stats,
        illus,
        admin,
        isAdmin,
        toast,
        bindFavs: () => initFavButtons(),
        _sb: () => sb
    };
    window.Mbokal = Mbokal;

    /* ---------- Message court ---------- */
    function toast(text) {
        document.querySelectorAll(".mb-toast").forEach(n => n.remove());
        const t = document.createElement("div");
        t.className = "mb-toast";
        t.setAttribute("role", "status");
        t.textContent = text;
        document.body.append(t);
        setTimeout(() => t.remove(), 3400);
    }

    /* ---------- Boutons « + » des couvertures ---------- */
    let favListener = false;
    function initFavButtons() {
        const buttons = Array.from(document.querySelectorAll("[data-fav]")).filter(b => !b.dataset.bound);
        if (!buttons.length) return;

        const paint = (b, on) => {
            b.classList.toggle("is-fav", on);
            b.setAttribute("aria-pressed", String(on));
            b.setAttribute("aria-label", on ? "Retirer des favoris" : "Ajouter aux favoris");
            const i = b.querySelector("i");
            if (i) i.className = on ? "fa-solid fa-check" : "fa-solid fa-plus";
        };
        const refresh = async () => {
            try {
                const favs = await Mbokal.favorites();
                document.querySelectorAll("[data-fav]").forEach(b => paint(b, favs.indexOf(b.dataset.fav) !== -1));
            } catch (e) { /* on garde l'état par défaut */ }
        };

        refresh();
        if (!favListener) { favListener = true; Mbokal.onChange(refresh); }

        buttons.forEach(b => {
            b.dataset.bound = "1";
            b.addEventListener("click", async e => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const on = await Mbokal.toggleFavorite(b.dataset.fav);
                    paint(b, on);
                    toast(!on ? "Retiré de tes favoris"
                        : Mbokal.user() ? "Ajouté à tes favoris"
                        : "Ajouté sur cet appareil. Crée un compte pour le retrouver partout.");
                } catch (err) {
                    toast("Impossible de modifier les favoris. Réessaie.");
                }
            });
        });
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initFavButtons);
    else initFavButtons();
})();
