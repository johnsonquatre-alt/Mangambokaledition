/* =====================================================
   TEXTE DES LIGHT NOVELS : mise en forme simple, sans HTML
   Écrire :
     une ligne vide        = nouveau paragraphe
     # Titre / ## Titre    = intertitre
     **gras**  *italique*
     ---                   = séparation de scène
   Tout est construit avec createElement/textContent : le texte
   d'un auteur ne peut jamais exécuter de code.
===================================================== */
(function () {
    "use strict";

    function inline(parent, text) {
        const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
        let last = 0, m;
        while ((m = re.exec(text))) {
            if (m.index > last) parent.append(document.createTextNode(text.slice(last, m.index)));
            const bold = m[0].indexOf("**") === 0;
            const node = document.createElement(bold ? "strong" : "em");
            node.textContent = m[0].slice(bold ? 2 : 1, bold ? -2 : -1);
            parent.append(node);
            last = re.lastIndex;
        }
        if (last < text.length) parent.append(document.createTextNode(text.slice(last)));
    }

    function render(container, text) {
        container.textContent = "";
        String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/).forEach(block => {
            const t = block.trim();
            if (!t) return;
            if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
                const sep = document.createElement("div");
                sep.className = "novel-sep";
                sep.setAttribute("aria-hidden", "true");
                sep.textContent = "* * *";
                container.append(sep);
                return;
            }
            const h = t.match(/^(#{1,3})\s+(.+)$/);
            if (h && t.indexOf("\n") === -1) {
                const hd = document.createElement(h[1].length === 1 ? "h2" : "h3");
                inline(hd, h[2]);
                container.append(hd);
                return;
            }
            const p = document.createElement("p");
            t.split("\n").forEach((line, i) => {
                if (i) p.append(document.createElement("br"));
                inline(p, line);
            });
            container.append(p);
        });
    }

    const words = text => String(text || "").trim().split(/\s+/).filter(Boolean).length;

    window.MbokalTexte = { render, words };
})();
