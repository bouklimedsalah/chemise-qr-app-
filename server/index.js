const express = require("express");
const cors = require("cors");
const path = require("path");
const { HttpError } = require("../lib/store");

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

app.get("/api/etapes", (req, res) => res.json(ETAPES));

app.get("/api/dossiers", handle((req) => store.listDossiers(req.query.q)));

app.get("/api/dossiers/:reference", handle(async (req) => {
  const d = await store.getDossier(req.params.reference);
  if (!d) throw new HttpError(404, "Chemise introuvable pour cette référence.");
  return d;
}));

app.post("/api/dossiers", handle((req) => store.createDossier(req.body || {})));

app.post("/api/dossiers/:reference/checkin", handle((req) => store.checkin(req.params.reference, (req.body || {}).utilisateur)));

app.post("/api/dossiers/:reference/quitter", handle((req) => store.quitter(req.params.reference, (req.body || {}).utilisateur)));

app.post("/api/dossiers/:reference/checkout", handle((req) => {
  const { nextIdx, destinataire } = req.body || {};
  return store.checkout(req.params.reference, nextIdx, destinataire);
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Suivi des chemises — API sur http://localhost:${PORT} (stockage: ${STORAGE})`));
