# La Cosa Nostra Tournament Manager (Prototype v2)

A GitHub Pages-ready, no-dependencies HTML/CSS/JavaScript demo built for La Cosa Nostra PTA by NextGen NTS.

## Run
Open `index.html` in a modern browser. No installation or server is needed.

## Included
- Separate Men's and Ladies' divisions, selected in the top-right menu.
- Independent rosters, brackets, scores, and champions for each division.
- Manually enter approved player names collected separately through Google Forms.
- Match format set per round (Race to N or Best of N, whole numbers 1 through 999), for each division. Set it in Registration > Match Settings, or on each round's heading in Match Control. Rounds without their own setting use the division default.
- Editing a round's format mid-tournament needs no restart: completed matches stay locked, and live matches in that round adapt (a match whose score already meets the new target finishes and the leader advances).
- Adaptive single-elimination bracket for any player count (2+). The bracket is sized to the registered players, not a fixed 32: a Preliminary Round only as large as needed (e.g. 24 players = 8 preliminary matches, 8 byes into a Round of 16), no byes at all for 8, 16, 32 etc. Byes are random, spread across the bracket, and rotate between tournaments (players with fewer past byes get them first). Byes are labelled in the bracket, Match Control and Registration.
- Registration shows the player count, matches and byes per round, and a Preview Draw before you generate. The draw locks when the first rack is scored; use Start New Tournament afterwards (players are kept).
- Automatic advancement and locked completed matches.
- Full-screen spectator view, division-specific championship titles.
- Eight fictional/demo player names per division.
- Browser localStorage saves data on the current browser and device.
- JSON export backs up both divisions.

## Demonstration
1. Select Men's Tournament and open Player Management.
2. Enter an approved player's name (or use the sample players).
3. Set the round formats (e.g. Race to 2 early, Best of 5 for the Final), then generate a bracket.
4. Open Match Control and tap +1 until someone reaches three racks.
5. Watch the winner advance, then open TV Spectator Mode.
6. Switch to Ladies' Tournament and repeat with a different race length.

## GitHub Pages
Create a public GitHub repository and upload `index.html`, `style.css`, and `app.js` to the root. In Settings > Pages select Deploy from a branch, main, /(root). After publication, visit `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

## Important limitations
This is a single-browser prototype, not a live online tournament backend. Different devices will NOT synchronise. Google Forms is not integrated; staff must manually add player names. There is no user authentication, payment verification, audit trail, server database, or multi-admin locking. Browser data may be cleared. Use the JSON export for a backup. Once a match is finalised, scores are locked; regenerate the division to start over. Round formats are remembered by position from the final (Final, Semi-finals, ...), so they survive regenerating the bracket. Lowering a target can finish live matches (you are asked to confirm first); raising it does not reopen completed matches.

For production, add a secure backend, real-time database, roles, and a proper correction/audit workflow.
