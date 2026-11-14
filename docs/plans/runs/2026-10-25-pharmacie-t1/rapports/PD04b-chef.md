# PD04b : contrôle du chef d'orchestration

Verdict : validé, avec deux corrections du chef (D757). Front `orch/pharmacie-t1-desktop`, commit f5c24d7. Vérificateur Sonnet : PASS, scénario D442 tenu, web identique. Corrigé par le codeur : purge retirée du montage sans session, session d'affichage rétablie du profil si le stockage est vide, cookie de refresh retiré à la déconnexion, `surDemandeJeton` gardé.

## Rétablissement de session, relu

- Il exige `pont.profil.lire()` non nul et du même compte. Le profil est effacé par la déconnexion, le 401 à code, le 403 et le jeton d'un autre compte (D756) : **aucune session rouverte après l'un d'eux**. Test ajouté : profil effacé, utilisateur resté en stockage : pas de reprise, pas de refresh, pas de cookie témoin.
- Aucun accès sans identité : la reprise ne touche que l'affichage. Le droit de vendre reste au processus principal, dont le contrôle est relu en PD04a.
- Cas à connaître : session révoquée vue par le processus principal alors que le rendu garde jeton et utilisateur. Redémarrage hors ligne : utilisateur affiché, profil nul, menu non fiable, et le pont répond 401 à toute vente. Pas de vente possible, mais l'écran ne dit pas pourquoi avant le retour du réseau. Laissé tel quel.

## Défaut corrigé par le chef : reprise sans jeton

La reprise rendait la main sans jeton, même en ligne. Conséquences : aucun envoi avant le renouvellement de 12 min, et ce renouvellement ignore un refus (il journalise seulement) : une session révoquée n'était **jamais** détectée dans ce parcours. Corrigé : `rafraichirPourPoste`, le corps de `surDemandeJeton` extrait, est aussi appelé à la reprise. Refus du serveur : purge et poste déconnecté. Panne : rien. Tests ajoutés.

Un test existant (« surDemandeJeton sans utilisateur ni jeton ») gardait un profil présent, situation qui n'est pas une déconnexion : il pose désormais un profil vide.

## Cookie de refresh, relu

Nom juste : `refresh_token` (`sessions.constants.ts:15`). Le cookie du back n'a ni domaine ni chemin imposés : hôte de l'API, chemin `/`. Adresse de retrait : `https://` si `secure`, sinon `http://`, plus domaine et chemin lus du cookie : juste pour la production et pour le dev. Ordre juste : `apiLogout` part avant le retrait, donc le serveur révoque quand il est joignable.

**Défaut corrigé** : le résultat était ignoré et toute erreur avalée. `retirerEtControlerCookieRefresh` relit la session et journalise un reste, sans valeur ni domaine. Rien d'affiché au vendeur : un cookie resté ne suffit pas à reprendre, aucun refresh ne part sans utilisateur en stockage et la connexion suivante le remplace.

**Toujours pas joué dans Electron**, ni en dev ni avec `SameSite=None; Secure`. Ajouté à PD04c (8 bis, et 8 ter pour le port changé) et à la preuve `https` de PD06.

## Corrections non revues par un agent

`useAuth.tsx` (`rafraichirPourPoste`), `cookie_session.ts`, `main.ts`, trois tests front, deux tests desktop.

## Rejoué par le chef, après ces corrections

Front : `tsc` vert, `vitest` 900 verts, 1 sauté dans le conteneur. Desktop : `tsc` vert, 147 tests verts avant le dernier ajustement d'un test du front ; construction Electron réussie. Crochet pre-commit passé. Sonde non rejouée (elle écrit sur la base du porteur).

## Non prouvé, ou limite

- Course étroite, non traitée : un refresh déjà parti au moment du `logout` peut, à son retour, repousser un jeton et réinstaller l'identité par `/auth/me`. Le serveur a révoqué si la déconnexion l'a atteint, et le refresh échoue alors ; reste le cas où les deux se croisent. Même risque sur le web aujourd'hui pour le stockage.
- Déconnexion hors ligne : session du serveur non révoquée, expire seule en 30 jours (D757).
- Parcours « port changé » : hook testé seulement ; une page de connexion peut s'afficher d'abord, le cookie témoin n'existant pas encore sur la nouvelle origine. À relever en PD04c.
- Scénario hors ligne de la sonde : joué par le codeur, non rejoué ici.
