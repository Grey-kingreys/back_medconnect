/**
 * Toute route ajoutée sous /pharmacie doit figurer ici avec un appel dans
 * test/db/etancheite-couts.db-spec.ts (le type l'impose) : sinon
 * src/pharmacie/etancheite-couts.spec.ts échoue. Une route qui renvoie un coût
 * doit le masquer par masquerCouts (D466).
 */
export type ClasseRoute =
  | 'JSON'
  | 'FICHIER'
  | 'PUBLIQUE'
  | 'TEXTE'
  | 'CLASSEUR_STOCK';

export interface RouteInventoriee {
  /** JSON : réponse lue ; FICHIER : classeur binaire, sans donnée de la pharmacie ; PUBLIQUE : sans authentification ; CLASSEUR_STOCK : classeur Excel du stock de la pharmacie, lu avec exceljs : la colonne de coût doit être vide sans marge:read ; TEXTE : fichier texte de la pharmacie (CSV), lu en entier : aucun en-tête ni aucune valeur ne doit correspondre au motif des coûts. */
  classe: ClasseRoute;
  /** Le titulaire reçoit au moins une clé de coût dans le scénario (contrôle positif). */
  porteCout: boolean;
  /** La garde exige marge:read (le vendeur reçoit 403). */
  exigeMarge: boolean;
}

const J: ClasseRoute = 'JSON';
const F: ClasseRoute = 'FICHIER';
const P: ClasseRoute = 'PUBLIQUE';
const T: ClasseRoute = 'TEXTE';
const CS: ClasseRoute = 'CLASSEUR_STOCK';

export const ROUTES_PHARMACIE = {
  'GET /pharmacie/:structureId/referentiels': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/parametres': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'PATCH /pharmacie/:structureId/parametres': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/postes': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/postes': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'PATCH /pharmacie/:structureId/postes/:posteId': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/postes/:posteId/plages': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/synchro/catalogue': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/synchro/evenements': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/caisse/sessions': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/caisse/sessions/courante': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/caisse/sessions': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/caisse/sessions/:sessionId/comptages': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/caisse/sessions/:sessionId/mouvements': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/caisse/sessions/:sessionId/bilan': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/ventes': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/ventes': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/ventes/:venteId': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/ventes/:venteId/annuler': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/caisse/sessions/:sessionId/fermer': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/fournisseurs': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/fournisseurs': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/receptions': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/receptions': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/receptions/:receptionId': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/stock/:stockId/lots': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'PATCH /pharmacie/:structureId/lots/:lotId': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'PATCH /pharmacie/:structureId/stock/:stockId/fiche': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/stock/:structureId': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'POST /pharmacie/stock/:structureId': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'PATCH /pharmacie/stock/:structureId/:stockId/quantite': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'DELETE /pharmacie/stock/:structureId/:stockId': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/stock/sorties': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/inventaires': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/inventaires': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/inventaires/:inventaireId': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/anomalies': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'PATCH /pharmacie/:structureId/anomalies/:anomalieId': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/stock/:structureId/export': {
    classe: CS,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/stock/:structureId/import/modele': {
    classe: F,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/stock/:structureId/import/apercu': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'POST /pharmacie/stock/:structureId/import': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/stock/alertes-peremption': {
    classe: J,
    porteCout: true,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/rapports/marge': {
    classe: J,
    porteCout: true,
    exigeMarge: true,
  },
  'GET /pharmacie/:structureId/caisse/clotures/:jour/preparation': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/:structureId/caisse/clotures': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/caisse/clotures/:jour/export': {
    classe: T,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/:structureId/caisse/clotures': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/rechercher': {
    classe: P,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/catalogue': {
    classe: P,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/catalogue/categories': {
    classe: P,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/catalogue/:medicamentId': {
    classe: P,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/catalogue': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'PATCH /pharmacie/catalogue/:medicamentId': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'GET /pharmacie/catalogue/import/modele': {
    classe: F,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/catalogue/import/apercu': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'POST /pharmacie/catalogue/import': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
  'DELETE /pharmacie/catalogue/:medicamentId': {
    classe: J,
    porteCout: false,
    exigeMarge: false,
  },
} as const satisfies Record<string, RouteInventoriee>;

export type CleRoutePharmacie = keyof typeof ROUTES_PHARMACIE;
