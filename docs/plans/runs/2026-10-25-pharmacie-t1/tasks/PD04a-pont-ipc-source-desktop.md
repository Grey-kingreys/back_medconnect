# PD04a - Pont IPC, source desktop, synchro branchée

Tier: dur (codeur Sonnet, vérificateur Sonnet ; fiche détaillée)
Audience: dev (aucun écran changé)
Visuel: n/a
Background-safe: oui, sauf le passage de la sonde (fenêtre)
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: PD03 validé

## Spec

### Objectif

Le processus principal ouvre la base, fait tourner la synchro, et répond à des gestionnaires IPC validés. Le front gagne une source desktop et un sélecteur de source. Les écrans n'en profitent pas encore (PD04c), sauf `vente/page.tsx` qui passe déjà par la source. **Sur le web, rien ne change.**

Décisions : D442, D737, D739, D741, D742, D743. Plan 4.3, 4.4, 4.8.

### Contexte vérifié

- `SourceCaisse` (`src/lib/caisse/source.ts`) n'a que 4 méthodes. `vente/page.tsx` importe `sourceEnLigne` en dur (lignes 20, 166 à 168, 422, 434). `caisse/page.tsx`, `FermetureCaisse.tsx`, `MouvementCaisse.tsx`, `ventes/page.tsx` et `ventes/[venteId]/recu/page.tsx` appellent `api_caisse` et `api_ventes` directement.
- Une erreur traverse mal `contextBridge` : les propriétés d'une `Error` sont perdues. D'où une réponse enveloppée.
- `ApiError` (`src/lib/api_auth.ts`) : `status`, `message`, `details` = corps entier de la réponse d'erreur ; `codeErreur`, `codeErreurVente`, `lignesErreurVente` lisent `details.code`, `details.details`.

### 1. `src/lib/caisse/contrat_desktop.ts`

Remplace le contrat minimal de PD01 :

```ts
export type ReponsePont<T> =
  | { ok: true; data: T; message: string }
  | { ok: false; status: number; message: string; code?: string; details?: unknown };

export interface UtilisateurPoste { id: string; nom: string; structureId: string; permissions: string[] }
export interface EtatPosteDesktop {
  enLigne: boolean; connexionARefaire: boolean; nonEnregistre: boolean; catalogueDisponible: boolean;
  fileEnAttente: number; rejetes: number; plageEpuisee: boolean; heureFausse: boolean; posteDesactive: boolean;
  autrePharmacie: boolean; dernierContactLe: string | null; photographieLe: string | null;
}
export interface PontDesktop {
  version: string;
  definirJeton(jeton: string | null): Promise<void>;
  definirUtilisateur(u: UtilisateurPoste | null): Promise<void>;
  surDemandeJeton(rappel: () => void): () => void;
  etat(): Promise<EtatPosteDesktop>;
  surEtat(rappel: (e: EtatPosteDesktop) => void): () => void;
  caisse: {
    chargerStock(s: string): Promise<ReponsePont<StockMedicament[]>>;
    chargerReferentiels(s: string): Promise<ReponsePont<Referentiels>>;
    etatCaisse(s: string, u: string): Promise<ReponsePont<EtatCaisse>>;
    creerVente(s: string, corps: CorpsCreationVente, cle: string): Promise<ReponsePont<Vente>>;
    ouvrirSession(s: string, corps: CorpsOuverture): Promise<ReponsePont<SessionCaisseOuverte>>;
    saisirComptage(s: string, sessionId: string, corps: CorpsComptage): Promise<ReponsePont<ComptageCaisse>>;
    enregistrerMouvement(s: string, sessionId: string, corps: CorpsMouvement): Promise<ReponsePont<MouvementCaisse>>;
    getBilan(s: string, sessionId: string): Promise<ReponsePont<BilanCaisse>>;
    fermerSession(s: string, sessionId: string, corps: CorpsFermeture): Promise<ReponsePont<BilanCaisse>>;
    listerVentes(s: string, options: { date?: string; page?: number }): Promise<ReponsePont<VentesDuJour>>;
    getVente(s: string, venteId: string): Promise<ReponsePont<Vente | null>>;
    enregistrerAnnulationServeur(reponse: Vente): Promise<ReponsePont<null>>;
  };
}
```

Schémas Zod dans le même fichier pour chaque argument (`schemasPont`), utilisés par le processus principal. Le web importe seulement `pontDesktop` et les types : vérifier que `zod` n'alourdit pas un écran web (déjà dépendance). Si `import type` suffit partout côté écrans, garder ainsi.

### 2. `src/lib/caisse/source.ts` et sélection

`SourceCaisse` gagne, en renvoyant `ApiResponse<T>` comme `api_caisse` (les pages lisent `res.message`) : `ouvrirSession`, `saisirComptage`, `enregistrerMouvement`, `getBilan`, `fermerSession`, `listerVentes`, `getVente`, et `enLigneSeulement: boolean`.

`source_en_ligne.ts` : délègue à `api_caisse` et `api_ventes`, `enLigneSeulement: true`. Comportement identique : les tests existants des écrans simulent `@/lib/api_caisse` et restent verts sans modification.

`source_desktop.ts` (nouveau) : `creerSourceDesktop(pont): SourceCaisse`. Chaque méthode appelle le pont ; `ok: false` devient `throw new ApiError(message, status, { code, details, message })`, pour que les codes de vente et de caisse se lisent à l'identique. `enLigneSeulement: false`.

`source_active.ts` (nouveau) : `sourceCaisse()` : pont présent : source desktop (mémorisée), sinon `sourceEnLigne`.

`vente/page.tsx` : remplacer `sourceEnLigne` par `sourceCaisse()`. Seul écran touché ici.

Tests : `source_desktop.test.ts` : succès ; refus `SORTIE_MANUELLE_REQUISE` lu par `codeErreurVente` et `lignesErreurVente` ; 409 lu par `codeErreur`. `source_active.test.ts` : sans pont, `sourceEnLigne` ; avec pont, source desktop. Page de vente : tests existants verts sans modification.

### 3. `desktop/electron/ipc.ts`

Un gestionnaire `ipcMain.handle` par méthode, canal `caisse:<methode>`, `etat`, `jeton`, `utilisateur`. Dans l'ordre :
1. `event.senderFrame.url` doit avoir l'origine `http://127.0.0.1:<port>` du serveur lancé, sinon refus sans détail ;
2. arguments validés par `schemasPont`, sinon `{ ok: false, status: 400, code: "VALIDATION", message: "Cette demande n'est pas valide." }` ;
3. `utilisateur` courant requis pour toute écriture de caisse ; `structureId` de l'argument égal à la structure rattachée, sinon 403 avec « Ce poste est rattaché à une autre pharmacie. » (D741) ;
4. `superviseur` calculé par `permissions.includes("caisse:superviser")`. **`caisse:utiliser` absente : 403**, message du back (le poste ne vend pas pour un compte sans ce droit) ;
5. appel du cœur ; `RefusCaisse` devient `ok: false` ; toute autre exception : `{ ok: false, status: 500, message: "L'enregistrement sur ce poste a échoué. Réessayez. Si cela persiste, redémarrez l'application." }`, journalisée sans corps ni jeton.

Après `creerVente` réussie : `moteur.cycle("apres-vente")` sans attendre. Rattachement : premier utilisateur de pharmacie connecté en ligne : `coeur.rattacher({ structureId })`.

`etatCaisse` renvoie `{ poste: { id, code, libelle, type: "DESKTOP" }, session }` ; sans poste enregistré : 503 avec « Connectez ce poste à internet une première fois pour charger le catalogue. ». `chargerStock` sans catalogue : même message.

`listerVentes` et `getVente` : données locales seulement ici ; la fusion en ligne est en PD04c.

### 4. `desktop/electron/synchro.ts`

- Client HTTP réel : `fetch` du processus principal vers `NEXT_PUBLIC_API_URL` (`process.env` figé au build par esbuild `define`, jamais lu d'un fichier), en-tête `Authorization: Bearer <jeton>` si présent, `node:zlib` `gzipSync` si `gzip`, délai de 30 s par `AbortSignal.timeout` pour une requête, 120 s pour la photographie. `fetch` décompresse br et gzip.
- Minuterie par `setTimeout` sur `moteur.prochainDelaiMs()`, relancée après chaque cycle. Démarre quand un jeton existe ; sinon en attente, sans erreur.
- `definirJeton` : garde en mémoire seulement, déclenche un cycle. 401 du moteur : `webContents.send("demande-jeton")`, le rendu rafraîchit (PD04b) et repousse le jeton. Rien sur disque.
- Après chaque cycle et chaque écriture : `webContents.send("etat", etat)`.
- Base : `app.getPath("userData")/caisse.sqlite`. `productName` donne `%APPDATA%/MedConnecte Caisse`. Avant `migrer`, `controlerBase()` ; base illisible : voir section 5.
- `libellePoste` : `os.hostname()` tronqué à 40 caractères.

`esbuild` : `define` de `NEXT_PUBLIC_API_URL` ; `construire-electron.mjs` exige la variable comme `construire-front.mjs`, même message.

### 5. Base illisible (D740)

`quick_check` en échec : boîte de dialogue « Les ventes enregistrées sur ce poste n'ont pas pu être relues. Le fichier est conservé. Appelez le support avant de continuer. » avec « Quitter » et « Repartir d'une base vide ». Le second : renomme le fichier en `caisse-illisible-<AAAAMMJJ-HHmm>.sqlite` (jamais supprimé), recrée, le poste reprend après `sequenceMaxRecue`. Test du renommage dans `desktop/coeur` (fonction pure sur `fs`, injectée).

### 6. Preuves

- `preload.ts` : expose chaque méthode, aucun accès brut à `ipcRenderer`. Test `desktop/coeur/garde_imports.test.ts` étendu : `preload.ts` n'exporte pas `ipcRenderer`.
- `sonde.ts` étendue : vente en ligne par le pont depuis la page, photographie reçue, `etat()` cohérent, ligne en base locale, puis événement `ENVOYE` et `sequenceAppliquee` au serveur. **Écrit une vente sur la base de dev du porteur** : compte démo de la Pharmacie de Kaloum seulement, le chef le dit avant le passage.

## Fichiers autorisés

`src/lib/caisse/**`, `src/app/dashboard/vente/page.tsx`, et tout sous `desktop/`.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée. Le jeton n'est jamais journalisé, jamais écrit sur disque.
- Pas de tiret cadratin ni demi-cadratin, français.
- `npm run build` du front en local, jamais dans le conteneur.
- Le web reste en ligne et ne change pas de comportement : tests existants verts sans modification.
- Rien sur la base de dev du porteur sans le dire.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Gates

`docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, eslint des fichiers touchés, `npm run build` local ; dans `desktop/` : `npm run types`, `npm test`, sonde.

## Done when

- [ ] Chaque gestionnaire contrôle l'origine et valide ses arguments
- [ ] Les refus du cœur se lisent comme ceux de l'API
- [ ] Synchro réelle tournante, jeton en mémoire seulement
- [ ] Base illisible conservée, jamais supprimée
- [ ] Web inchangé, tests existants intacts

## Return

Fichiers touchés, sorties des gates, résultat de la sonde, tout écart à la fiche.

## Historique

## Validation
