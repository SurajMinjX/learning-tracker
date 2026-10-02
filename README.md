# Fieldnote — personal developer dashboard

A small, dependency-free web app for a public learning dashboard and a private owner-only editor. It runs on Node.js and stores its dashboard and admin credential files locally; no database or third-party service is required.

## Run it

Requirements: Node.js 18 or newer.

```sh
npm start
```

Open `http://localhost:3000` (or the address printed by the server). On first start, copy the **one-time setup key** printed in the server terminal, click **Admin**, and use the key to create an owner password of at least 12 characters. The key is single-use. Once setup succeeds, the app removes the generated key file and only the password-protected sign-in remains.

The generated key is also stored outside the web root at `data/setup-key.txt` until it is used. If you configure `SETUP_KEY` in the server environment, that value is used instead and is not printed by the app:

```sh
SETUP_KEY='a-long-random-one-time-secret' PORT=3000 npm start
```

## What’s included

- **Public dashboard:** learning milestones and statuses, language/skill proficiency bars, a current-focus card, project cards with direct GitHub links, and mobile-friendly layouts.
- **Private admin:** edit the profile, add/update/remove learning milestones, add/update/remove languages and proficiency levels, and manage GitHub project cards. Save changes to publish them; the public dashboard itself is read-only.
- **Example starter content:** the first run seeds illustrative Python, Java, HTML/CSS, and learning-path values. A visible starter-content notice stays on until you turn it off in the Profile editor. No example GitHub repositories are invented—the project shelf starts empty.
- **Persistence:** dashboard content is saved in `data/dashboard.json`. The admin password salt/hash is stored separately in `data/admin.json`. These files are not served by the web server.

## Security and deployment notes

- There is no public registration route. The first owner must present the one-time setup key; after owner setup, the key is consumed and setup is closed.
- Owner passwords are stored using Node’s `scrypt` password-based key derivation. Admin sessions use random, HTTP-only, `SameSite=Strict` cookies and expire after eight hours. Sign-in attempts are rate-limited, and write requests are origin/custom-header checked and server-validated.
- Put the app behind HTTPS before sharing it publicly. The server marks cookies `Secure` when the request is HTTPS (or the trusted proxy supplies `X-Forwarded-Proto: https`). Use a private persistent volume for `data/`; never serve or publish that directory, its setup key, or credential file.
- The session store is intentionally in memory and suited to a single Node process. For multi-instance deployments, use a shared session store and platform-level rate limiting.
- Back up `data/` securely. There is no password-reset endpoint. To reinitialize the owner account, stop the server, remove only `data/admin.json` (keep `dashboard.json`), remove an old `data/setup-key.txt` if present, then restart and use the newly generated key. If you normally supply `SETUP_KEY`, rotate that environment value before restarting.

## Project structure

```text
server.mjs       Node HTTP server, API, auth, validation, persistence
public/          Public page, admin interface, styles, and browser code
data/            Runtime dashboard, credential, and one-time setup files (private)
```
