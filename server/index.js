const express = require("express");
const cors = require("cors");
const path = require("path");
const { HttpError } = require("../lib/store");
const { signToken, requireAuth, checkPoste } = require("../lib/auth");

const STORAGE = process.env.STORAGE || "file"; // "file" | "sheets"
const store = STORAGE === "sheets" ? require("../lib/sheetsStore") : require("../lib/fileStore");
const { ETAPES } = require("../lib/etapes");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

function handle(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req, res));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.status(status).json({ error: e.message || "Erreur serveur." });
    }
  };
}

// ---- Connexion ----
app.post("/api/login", handle(async (req) => {
  const { email, password } = req.body || {};
  const user = await store.getUserByEmail(email);
  if (!user || user.mot_de_passe !== password) {
    throw new HttpError(401, "Email ou mot de passe incorrect.");
  }
  return { token: signToken(user), nom: user.nom, poste: String(user.poste) };
}));

app.get("/api/etapes", (req, res) => res.json(ETAPES));

// ---- Routes protégées : il faut être connecté à partir d'ici ----
app.use("/api/dossiers", requireAuth);

app.get("/api/dossiers", handle((req) => store.listDossiers(req.query.q)));

app.get("/api/dossiers/:reference", handle(async (req) => {
  const d = await store.getDossier(req.params.reference);
  if (!d) throw new HttpError(404, "Chemise introuvable pour cette référence.");
  return d;
}));

// Ouverture d'une chemise = toujours l'étape 0 (Service client)
app.post("/api/dossiers", handle((req) => {
  checkPoste(req.user, 0);
  return store.createDossier(req.body || {});
}));

app.post("/api/dossiers/:reference/checkin", handle(async (req) => {
  const d = await store.getDossier(req.params.reference);
  if (!d) throw new HttpError(404, "Chemise introuvable.");
  const targetEtape = d.transit ? d.transit.nextIdx : d.etapeIdx;
  checkPoste(req.user, targetEtape);
  return store.checkin(req.params.reference, (req.body || {}).utilisateur);
}));

app.post("/api/dossiers/:reference/quitter", handle(async (req) => {
  const d = await store.getDossier(req.params.reference);
  if (!d) throw new HttpError(404, "Chemise introuvable.");
  checkPoste(req.user, d.etapeIdx);
  return store.quitter(req.params.reference, (req.body || {}).utilisateur);
}));

app.post("/api/dossiers/:reference/checkout", handle(async (req) => {
  const d = await store.getDossier(req.params.reference);
  if (!d) throw new HttpError(404, "Chemise introuvable.");
  checkPoste(req.user, d.etapeIdx);
  const { nextIdx, destinataire } = req.body || {};
  return store.checkout(req.params.reference, nextIdx, destinataire);
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Suivi des chemises — API sur http://localhost:${PORT} (stockage: ${STORAGE})`));
