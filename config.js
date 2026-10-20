/* =====================================================
   CONFIGURATION DES COMPTES
   - Laisser vide  : mode démo (comptes gardés sur l'appareil).
   - Remplir les 2 valeurs (Supabase > Project Settings > API)
     pour activer les vrais comptes en ligne.
   La clé "anon" est publique par conception : la sécurité
   vient des règles RLS de supabase.sql, pas de la clé.
===================================================== */
window.MBOKAL_CONFIG = {
    supabaseUrl: "https://qirfpvphjudqgtrgnxqy.supabase.co",
    // true : les textes absents du fichier traductions.js sont envoyés à un service de traduction
    // (fonction SQL "traduire" + clé Google). false : seul le fichier traductions.js est utilisé.
    traductionServeur: false,
    supabaseKey: "sb_publishable_NlRWiDd_Wa6vOn4wOfCg8Q_5T9hu7Z8"   // clé publique (jamais la clé "secret")
};
