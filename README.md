# Suivi des chemises par QR code

## Démarrage
```bash
npm install
npm start
```
Puis ouvrir http://localhost:3000 dans le navigateur (sur mobile, utiliser l'adresse IP de la
machine sur le réseau local pour accéder à la caméra).

## Ce qui est fonctionnel
- Création de chemise (manuelle) avec check-in automatique au Service client
- Check-in multi-opérateurs (plusieurs personnes actives simultanément sur la même chemise)
- Check-out qui clôture tous les opérateurs actifs et envoie vers l'étape + destinataire choisis
- Circuit fixe à 8 étapes (Service client → Programmation → Impression → Ordre de facturation →
  Vérification → Facturation → Recouvrement → Archives)
- Retrait des archives = même mécanique de check-out/check-in
- Recherche en temps réel (référence, client, contrat, type de prestation)
- **Scan QR par caméra réel** (bibliothèque html5-qrcode) — le QR doit contenir le texte
  `CHEMISE:<référence>` (ou juste la référence)
- Historique complet par chemise (journal des mouvements)

## Stockage
Deux modes disponibles, choisis via la variable d'environnement `STORAGE` :

### `STORAGE=file` (par défaut — aucune configuration)
Fichier JSON local (`server/data.json`, généré automatiquement au premier lancement). Pratique
pour développer et tester, mais pas conçu pour des écritures concurrentes intensives ni un accès
depuis plusieurs machines.

### `STORAGE=sheets` (Google Sheets)
Utilise un classeur Google Sheets comme base de données (deux feuilles : `Dossiers` pour l'état
courant, `Mouvements` pour le journal d'audit — créées automatiquement au premier accès).

Mise en place :
1. Créer un projet sur [Google Cloud Console](https://console.cloud.google.com/), activer
   l'**API Google Sheets**.
2. Créer un **compte de service** (IAM & Admin → Comptes de service), puis générer une **clé
   JSON** pour ce compte (bouton "Gérer les clés" → "Ajouter une clé" → JSON).
3. Créer un classeur Google Sheets vide, et le **partager en "Éditeur"** avec l'adresse email du
   compte de service (visible dans le fichier JSON, champ `client_email`).
4. Récupérer l'**ID du classeur** dans son URL :
   `https://docs.google.com/spreadsheets/d/`**`CET_ID`**`/edit`
5. Définir les variables d'environnement avant de lancer le serveur :
   ```bash
   export STORAGE=sheets
   export SPREADSHEET_ID="l-id-du-classeur"
   export GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account", ... tout le contenu du fichier JSON ...}'
   npm start
   ```
   Sur Render/Railway, mets ces trois variables dans les "Environment Variables" du service au
   lieu de `export`.

**Important** : ce mode n'a pas pu être testé en conditions réelles dans cet environnement (pas
d'accès à l'API Google depuis ici). Le code suit fidèlement la documentation officielle de
l'API Sheets et reproduit exactement la même logique métier que le mode fichier (déjà testée et
validée) — mais teste-le avec tes propres identifiants avant de basculer en production, et
dis-moi si une erreur apparaît pour qu'on la corrige ensemble.

## Comptes utilisateurs
Chaque utilisateur est créé par toi (pas d'auto-inscription) et ne peut agir que sur **son
poste** — c'est-à-dire une seule étape du circuit (ou "tous" pour un accès admin complet).

Variable d'environnement supplémentaire à définir : `JWT_SECRET` — une chaîne de caractères
secrète et longue, au choix (sert à signer les sessions). Génère-en une aléatoire, par exemple
avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Ajouter un utilisateur
- **Mode `sheets`** : ouvre l'onglet **Utilisateurs** du classeur (créé automatiquement au
  premier lancement), ajoute une ligne : `email | mot_de_passe | nom | poste | actif`.
  Le `poste` est le numéro de l'étape (0 = Service client, 1 = Programmation, …, 7 = Archives),
  ou `tous` pour un accès complet. Mets `actif` à `FALSE` pour désactiver un compte sans le
  supprimer.
- **Mode `file`** (dev/test) : édite directement `server/data.seed.json`, tableau
  `utilisateurs`.

**Limite connue** : les mots de passe sont stockés en clair dans la feuille/le fichier — un
compromis acceptable pour un outil interne à accès restreint, mais à améliorer (hachage) si
besoin d'un niveau de sécurité supérieur.

## Pas encore fait (hors scope de cette version)
- Génération de la page de garde imprimable avec QR (le modèle sera fourni séparément)
- Invitation par email pour l'activation des comptes (pour l'instant, mot de passe fourni
  directement par l'admin)

