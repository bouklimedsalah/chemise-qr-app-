const ETAPES = [
  { idx: 0, nom: "Service client", sous: "Ouverture de dossier" },
  { idx: 1, nom: "Programmation", sous: "Selon le type de prestation" },
  { idx: 2, nom: "Impression", sous: "Selon le type de prestation" },
  { idx: 3, nom: "Ordre de facturation", sous: "Selon le type de prestation" },
  { idx: 4, nom: "Vérification", sous: "Service client" },
  { idx: 5, nom: "Facturation", sous: "Émission de la facture" },
  { idx: 6, nom: "Recouvrement", sous: "Suivi des paiements" },
  { idx: 7, nom: "Archives", sous: "Fin de circuit" },
];
const ARCHIVE_IDX = ETAPES.length - 1;
const REF_PATTERN = /^\d{2}[A-Z]{2}\d{4}$/;

module.exports = { ETAPES, ARCHIVE_IDX, REF_PATTERN };
