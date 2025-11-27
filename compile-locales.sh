#!/bin/bash

# Domain matches the UUID and gettext-domain in metadata.json
DOMAIN="yetanotherradio@io.github.buddysirjava"
# The directory where the extension source lives
EXTENSION_DIR="yetanotherradio@io.github.buddysirjava"

# Create the locale directory structure inside the extension folder
INSTALL_DIR="$EXTENSION_DIR/locale"

if [ ! -d "po" ]; then
    echo "Error: 'po' directory not found."
    exit 1
fi

echo "Compiling translations..."

for po_file in po/*.po; do
    # Check if file exists to handle case where no .po files exist yet
    [ -e "$po_file" ] || continue
    
    # Extract language code (e.g., 'de' from 'po/de.po')
    lang=$(basename "$po_file" .po)
    
    # Create the target directory: locale/LANG/LC_MESSAGES/
    target_dir="$INSTALL_DIR/$lang/LC_MESSAGES"
    mkdir -p "$target_dir"
    
    # Compile .po to .mo
    msgfmt "$po_file" -o "$target_dir/$DOMAIN.mo"
    
    if [ $? -eq 0 ]; then
        echo "✓ Compiled $lang -> $target_dir/$DOMAIN.mo"
    else
        echo "✗ Failed to compile $lang"
    fi
done

echo "Done."


