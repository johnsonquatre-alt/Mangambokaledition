/* =====================================================
   MANGA MBOKAL EDITION — CATALOGUE
   C'est ici que l'équipe des artistes ajoute ses chapitres.

   Pour publier un chapitre :
   1. Déposer les images dans   pages/<id-manga>/<numero>/
      (ex. pages/ishi-no-erito/1/01.webp, 02.webp, ...)
   2. Lister les images dans "pages" (dans l'ordre de lecture).
   3. Mettre "disponible: true".

   Tant que "pages" est vide, le lecteur affiche des pages
   de test ("placeholder" = nombre de pages de test).
   Format conseillé : WebP ou JPG, 1200 px de large.
===================================================== */

window.MANGAS = [
    {
        id: "ishi-no-erito",
        titre: "ISHI NO ERITO",
        genres: "Action • Fantastique",
        // "rtl" = sens de lecture japonais (droite → gauche)
        // "ltr" = gauche → droite
        sens: "rtl",
        chapitres: [
            { numero: 1, titre: "Le réveil de la pierre", disponible: true,  pages: [], placeholder: 8 },
            { numero: 2, titre: "Les héritiers",          disponible: true,  pages: [], placeholder: 6 },
            { numero: 3, titre: "Bientôt",                disponible: false, pages: [] }
        ]
    },
    {
        id: "mani-kongo",
        titre: "MANI KONGO",
        genres: "Histoire • Aventure",
        sens: "rtl",
        chapitres: [
            { numero: 1, titre: "Le royaume", disponible: true, pages: [], placeholder: 5 },
            { numero: 2, titre: "Bientôt",    disponible: false, pages: [] }
        ]
    },
    {
        id: "nzango",
        titre: "NZANGO",
        genres: "Action",
        sens: "rtl",
        chapitres: [
            { numero: 1, titre: "Premier combat", disponible: true, pages: [], placeholder: 5 }
        ]
    }
];
