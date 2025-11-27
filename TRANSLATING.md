## Translating Yet Another Radio

Thank you for your interest in translating **Yet Another Radio**! This guide explains how to create or update translations for the GNOME Shell extension.

### 1. Requirements

- **gettext** tools installed (for `xgettext`, `msginit`, `msgmerge`, etc.).
- A PO editor (for example: Poedit, Gtranslator, or any text editor you like).
- Basic familiarity with using a terminal.

### 2. Get the source code

- **Clone the repository**:

```bash
git clone https://github.com/BuddySirJava/YetAnotherRadio.git
cd YetAnotherRadio
```

All paths mentioned below are relative to this directory.

### 3. Update the translation template

The script `update-po.sh` extracts translatable strings from the JavaScript and schema files and updates the POT template.

```bash
./update-po.sh
```

This will regenerate `po/yetanotherradio.pot`.

### 4. Create a new translation

If your language does not exist yet:

1. Decide on the **locale code** (for example: `de` for German, `fr` for French, `pt_BR` for Brazilian Portuguese).
2. Create a new PO file using `msginit` (replace `LANG` with your locale code):

```bash
cd po
msginit --locale=LANG --input=yetanotherradio.pot --output-file=LANG.po
```

3. Open the new `LANG.po` file in your PO editor and translate the strings.
4. Save the file and go back to the project root when you are done:

```bash
cd ..
```

### 5. Update an existing translation

If a translation for your language already exists (for example `po/de.po`):

1. Make sure the POT file is up to date:

```bash
./update-po.sh
```

2. Merge the latest template into your language file:

```bash
cd po
msgmerge --update LANG.po yetanotherradio.pot
cd ..
```

3. Open `po/LANG.po` in your PO editor and translate any newly added or fuzzy strings.

### 6. Testing your translation

The GNOME Shell extension uses the gettext domain:

- **Domain**: `yetanotherradio@io.github.buddysirjava`

To test your translation, you need to compile the `.po` file into a binary `.mo` file and install the extension.

1. **Compile the translations**:

   Run the included script to compile all `.po` files into the extension's `locale` directory:

   ```bash
   ./compile-locales.sh
   ```

2. **Install/Update the extension**:

   Typical ways to test:

   - Install or link the extension folder (`yetanotherradio@io.github.buddysirjava`) into `~/.local/share/gnome-shell/extensions/`.
   - Ensure your system/session language is set to your target locale.
   - Restart GNOME Shell (for example `Alt+F2`, then type `r` on Xorg) or log out and log back in on Wayland.
   - Open the indicator and preferences window to verify that strings appear translated.

> Note: If you don't see your translations, check that the `locale` folder was created inside the extension directory and contains your language code (e.g., `locale/de/LC_MESSAGES/yetanotherradio@io.github.buddysirjava.mo`).

### 7. Submitting your translation

When your translation is ready:

1. Commit your changes:

```bash
git add po/LANG.po
git commit -m "Add LANG translation"
```

2. Push your branch and open a **Pull Request** on GitHub against the main repository:

`https://github.com/BuddySirJava/YetAnotherRadio`

Please mention:

- The language/locale you translated.
- Any special notes (e.g. terminology choices).

### 8. Keeping translations up to date

Whenever new strings are added to the extension:

1. Run `./update-po.sh`.
2. Run `msgmerge` for your language as shown above.
3. Translate new or changed strings.
4. Submit an updated Pull Request.


