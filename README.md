# FIB Portal

Portail interne du FIB construit avec Node.js, Express, EJS et MySQL. L'application permet de gérer les citoyens, les rapports, le temps de service et les messages internes.

## Prerequis

- Node.js 18 ou version plus recente
- npm
- MySQL 8 ou compatible

## Installation

1. Cloner le projet et entrer dans son dossier :

	```bash
	git clone <URL_DU_DEPOT>
	cd fib
	```

2. Installer les dependances :

	```bash
	npm install
	```

3. Creer la base de donnees et ses tables :

	```bash
	mysql -u root -p < database/schema.sql
	```

	Le script cree la base `fib_portal` et un compte initial `admin`.

4. Configurer MySQL dans `config/database.js` si nécessaire :

	```js
	host: "localhost",
	user: "root",
	password: "",
	database: "fib_portal"
	```

5. Demarrer le serveur :

	```bash
	npm start
	```

6. Ouvrir [http://localhost:3000](http://localhost:3000).

## Compte initial

- Utilisateur : `admin`
- Mot de passe : `admin123`

Changez ce mot de passe avant toute utilisation réelle.

## Fonctionnalites

- Authentification et inscription
- Tableau de bord avec statistiques
- Gestion des citoyens et des rapports
- Edition et suppression des rapports
- Suivi du temps de service
- Messagerie interne avec boite de reception, messages envoyes et suppression
- Administration des utilisateurs et consultation des logs

## Structure

- `server.js` : demarrage du serveur Express
- `routes/` : routes de l'application
- `views/` : templates EJS
- `public/` : fichiers CSS, JavaScript et images
- `database/schema.sql` : structure MySQL

## Tests de verification

Le projet ne contient pas encore de suite de tests automatisee. Pour verifier la syntaxe des vues et des routes :

```bash
node --check server.js
node --check routes/messages.js
```
