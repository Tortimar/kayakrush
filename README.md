# 🛶 Kayak Rush

Jeu web multijoueur coopératif (1 à 4 joueurs) : descendre un fleuve procédural dans le même kayak, en ramant en rythme.

## Lancer le jeu

```bash
npm install
npm start          # http://localhost:3000  (PORT=xxxx pour changer)
```

Ouvrez la page, choisissez un pseudo, **Créer un lobby**, puis partagez le code à 5 caractères (le bouton *Copier* donne un lien direct `…/#CODE`). Pour jouer à plusieurs sur un réseau local, les autres ouvrent `http://<ip-de-la-machine>:3000`. Pour jouer sur Internet, déployez le dossier sur n'importe quel hébergeur Node avec WebSockets (Render, Railway, Fly.io…) avec `npm start`.

## Commandes

| Où | Touche | Action |
|---|---|---|
| Rive | ZQSD / WASD / flèches | marcher (Maj : courir) |
| Rive | E | tableau des fleuves / ponton du tutoriel |
| Kayak | Q / A / ← (maintenu) | ramer à gauche → le kayak tourne à droite |
| Kayak | D / → (maintenu) | ramer à droite → le kayak tourne à gauche |
| Kayak | F | mode pêche (on/off) |
| Kayak | Espace | sauter à l'eau |
| À l'eau | ZQSD / WASD | nager |
| À l'eau | E | remonter (près du kayak) |
| Tutoriel | Échap | quitter |

## Règles

- **Vitesse** : chaque joueur qui rame donne une impulsion toutes les 0,45 s. Plus il y a de rameurs, plus le kayak va vite ; quand tout le monde s'arrête, il glisse sur son inertie puis suit le courant du fleuve. Ramer des deux côtés en même temps = tout droit.
- **Obstacles procéduraux** : rochers, requins (font tomber 1-2 joueurs, mordillent les nageurs), zones de courant (flèches bleues, poussent latéralement ou accélèrent), zones de vent (traînées blanches) + vent global. La densité, la force et la largeur du lit évoluent avec la distance (difficulté max vers 2 500 m).
- **Chutes** : un choc ou un requin peut éjecter des joueurs. À l'eau, une jauge (15 s → 10 s) se vide : remontez à temps, sinon vous êtes emporté jusqu'au prochain **poste de secours** (tous les 500 m), qui repêche les disparus et répare un peu la coque.
- **Casse** : le gouvernail (contrôle), les plaques de coque (fuite d'eau + perte de vitesse) et les pagaies (ramer à la main = 35 %) peuvent tomber. Récupérez-les en nageant dessus puis en remontant, ou en passant dessus avec un joueur en mode pêche.
- **Pêche** : zones dorées toujours traversables. En mode pêche (on ne rame plus), ~1,6 s dans une zone = une prise : bonus (turbo, réparation, bouclier, pièce, bouée qui remonte tout le monde) ou malus (enclume, commandes inversées, trou dans la coque, tempête). Plus on descend, plus les malus sont fréquents.
- **Fin** : coque à 0 % ou tout l'équipage emporté. Le compteur de mètres est le score.

## Lobby

Chaque joueur se promène sur la rive d'un lac. Le **ponton** lance un tutoriel solo guidé (7 étapes) ; le **tableau** permet de voter pour un fleuve (*La Paisible*, *Gorges Rouges*, *Delta aux Requins*). L'hôte lance la descente ; à égalité, son vote l'emporte. Un joueur qui rejoint en pleine descente embarque au prochain poste de secours.

## Architecture

```
server.js            Express + Socket.io : lobbys, codes, votes, boucle 30 Hz, diffusion 15 Hz
server/game.js       Simulation autoritaire d'une descente (physique, collisions, pêche, casse…)
shared/game-core.js  Partagé serveur/navigateur : générateur de fleuve déterministe (graine),
                     obstacles par tronçons de 80 m, courant/vent, physique du kayak
public/js/main.js        Menu, réseau, bascule lobby ↔ descente
public/js/lobbyWorld.js  Rive, lac, tableau, tutoriel (simulé localement)
public/js/riverWorld.js  Rendu 3D du fleuve, interpolation de l'état serveur, HUD
public/js/models.js      Modèles low-poly, eau en shader, caméra
```

Le fleuve est généré de façon identique sur le serveur et chez chaque client à partir d'une graine : seuls l'état du kayak, des joueurs et des pièces transitent sur le réseau. Les réglages de gameplay (forces, traînée, difficulté, probabilités) sont regroupés dans `shared/game-core.js` et `server/game.js`.
