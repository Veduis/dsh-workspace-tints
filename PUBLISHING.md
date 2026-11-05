# Publishing checklist

## Where it is live

| Channel | Status |
| --- | --- |
| GitHub repository | **live** — <https://github.com/Veduis/dsh-workspace-tints> (public, homepage `veduis.com`) |
| Tag `v1.0.0` | **pushed** |
| GitHub Release with the `.tgz` | **live** — <https://github.com/Veduis/dsh-workspace-tints/releases/tag/v1.0.0> |
| Plugin market index (GitHub Pages) | **live** — <https://veduis.github.io/dsh-workspace-tints/index.json> |
| npm | **live** — `dsh-workspace-tints@1.0.0`, published 2026-11-05T00:22Z |
| `veduis.com/dsh/` index | not set up (needs upload to the site) |

Install straight from the release while npm is pending:

```sh
dsh plugin --profile web add https://github.com/Veduis/dsh-workspace-tints/releases/download/v1.0.0/dsh-workspace-tints-1.0.0.tgz
```

## Notes from the first publish

npm creates a `0.0.0-stage` stub (`"stub": true`, "Temporary package placeholder for staged publishing") while a new package is scanned; `dist-tags.latest` points at it for a few minutes and then flips to the real version. Do not panic and re-publish — check `npm view <name> versions` instead.

## Before the next publish

1. **Package name** — currently `dsh-workspace-tints` (free on npm as of 2026-11-04). To publish under a scope instead, change `name` in `package.json`, the `name` in `cordis.patch.yml`, and the ModuleLoader `id` plus `STYLE_KEY` / `data-plugin` in `client.js` together. They must stay identical or the Client half will not load.
2. **Repository URL** — done: `https://github.com/Veduis/dsh-workspace-tints` is set in `package.json` and in `market/index.json`, and becomes the **Source code** link on the plugin page.
3. **License holder** — `LICENSE` says `Copyright (c) 2026 Veduis`. Adjust the legal name if needed.
4. **engines.dsh** — `^0.2.1-rc.5` matches the build this was tested on. Widen it only after testing a newer runtime; the install check reads this field and refuses the package otherwise.

## Verify the tarball

```sh
cd /home/vedu/Desktop/DSHWORK/workspace-tints
npm pack --dry-run
```

The tarball must contain `index.js`, `client.js`, `cordis.patch.yml`, `locale/*.json`, `icon.svg`, `screenshots/*.png`, `README.md`, `LICENSE`. `demo/`, `market/` and this file are development-only and stay out via `files`.

## Publish

```sh
npm publish --access public
```

Then confirm it is installable in a clean profile:

```sh
dsh plugin --profile rescue add dsh-workspace-tints
```

`rescue` is the throwaway profile; the package must mount and the Settings section must appear before you announce anything.

## Publish the market index

`market/` is a ready format-1 index and landing page. It is already deployed by `.github/workflows/pages.yml` to GitHub Pages on every push that touches `market/`:

```
https://veduis.github.io/dsh-workspace-tints/index.json
https://veduis.github.io/dsh-workspace-tints/icons/workspace-tints.svg
```

The relative `icon` resolves against the index URL, so the two files stay siblings. Serve over **https** — an `http:` index can be changed by anyone on the path, install specs included.

To move it to the branded URL later, copy `market/` to `https://veduis.com/dsh/` and switch the README and the landing page to that URL; nothing in the index itself depends on its host.

Update `publishTimestamp` to the real publish time (Unix seconds) and add a new `versions[]` entry for every release; order does not matter, the validator sorts by SemVer.

Validate before hosting:

```sh
node -e "import('@deepseek-ai/dsh-plugin-market-index').then(m=>console.log(JSON.parse(require('fs').readFileSync('market/index.json','utf8')))).catch(e=>{console.error(e);process.exit(1)})"
```

or in the app: **Plugins → More → Custom plugin markets → Discover → Add index source** and paste the URL.

## Regenerate the screenshots

The images are rendered from the plugin's own CSS against the shipped theme tokens — no live instance is screenshotted, and every Workspace/Session name is invented.

```sh
cd /home/vedu/Desktop/DSHWORK/workspace-tints
CH="google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --virtual-time-budget=2000"
$CH --window-size=320,620 --screenshot=screenshots/sidebar-dark.png  "file://$PWD/demo/sidebar.html"
$CH --window-size=320,620 --screenshot=screenshots/sidebar-light.png "file://$PWD/demo/sidebar.html#light"
$CH --window-size=900,800 --screenshot=screenshots/settings.png     "file://$PWD/demo/settings.html"
google-chrome --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,800 --virtual-time-budget=2500 --screenshot=screenshots/cover.png "file://$PWD/demo/cover.html"
```

`demo/cover.html` embeds `screenshots/sidebar-dark.png`, so render that one first.

The PNGs Chrome writes are larger than they need to be; this restores full colour fidelity while trimming about a third of the bytes. Do **not** palette-quantize them — the 14px green dot is the first thing a 256-colour palette destroys.

```sh
python3 - <<'PY'
from PIL import Image
import glob
for p in glob.glob('screenshots/*.png'):
    Image.open(p).convert('RGB').save(p, optimize=True)
PY
```

## After publishing

- Index sources are added per profile; there is no central DSH directory, so discovery comes from people adding `https://veduis.com/dsh/index.json`.
- The only in-app links back to you are the entry's **Homepage** (`https://veduis.com`) and, once set, **Source code**. They are not crawlable backlinks — the public surface is the hosted index itself, so keep a human-readable landing page next to it if SEO matters.
