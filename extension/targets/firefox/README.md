# Firefox Marmalade Library extension

The five-file Firefox package is generated from the shared source with a
root-relative Firefox Manifest V3. It uses background.js, content.js, library.html,
library.js, two library modules, and manifest.json. It neither loads nor requires
Minternet or a native server.

Install for testing with about:debugging > This Firefox > Load Temporary Add-on
(select the generated manifest.json). A permanent Firefox installation requires
Mozilla Add-ons signing; the generated XPI is explicitly unsigned.

Persistent extension storage keeps the video catalog, folder names and metadata
across browser restarts. Firefox does not generally provide the native persistent
File System Access directory picker. Re-select the original folder/files to
re-authorize access, without losing the catalog or duplicating titles.
Use Export Catalog Backup before uninstalling the extension.
