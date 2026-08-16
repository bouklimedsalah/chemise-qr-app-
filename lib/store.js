// Interface commune que doivent respecter fileStore.js et sheetsStore.js.
// Chaque store expose ces méthodes async ; server/index.js ne connaît que cette interface,
// jamais les détails d'implémentation (fichier JSON ou Google Sheets).
//
//   listDossiers(q)                         -> [{ ...dossier, statut, label, ... }]
//   getDossier(reference)                   -> { ...dossier, statut, label, historique } | null
//   createDossier({ reference, client, numero_bc, contrat, type_prestation })
//                                            -> dossier créé | lève une erreur { status, message }
//   checkin(reference, utilisateur)         -> dossier mis à jour
//   quitter(reference, utilisateur)         -> dossier mis à jour
//   checkout(reference, nextIdx, destinataire) -> dossier mis à jour
//
// Les erreurs métier (référence invalide, déjà existante, chemise introuvable...) doivent être
// levées comme: const e = new Error("message"); e.status = 400; throw e;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { HttpError };
