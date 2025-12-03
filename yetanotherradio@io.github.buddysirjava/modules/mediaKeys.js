import Meta from 'gi://Meta';

export function setupMediaKeys(settings, indicator) {
    const enableMediaKeys = settings?.get_boolean('enable-media-keys') ?? true;
    if (!enableMediaKeys) {
        return { mediaKeyAccelerators: [], acceleratorHandlerId: null, mediaKeysSettingsHandlerId: null };
    }

    const display = global.display;
    const mediaKeyAccelerators = [];

    const playPauseId = display.grab_accelerator('XF86AudioPlay', Meta.KeyBindingFlags.NONE);
    if (playPauseId > 0) {
        mediaKeyAccelerators.push({
            id: playPauseId,
            action: 'play-pause'
        });
    }

    const stopId = display.grab_accelerator('XF86AudioStop', Meta.KeyBindingFlags.NONE);
    if (stopId > 0) {
        mediaKeyAccelerators.push({
            id: stopId,
            action: 'stop'
        });
    }

    const acceleratorHandlerId = global.display.connect('accelerator-activated', (display, action, deviceId, timestamp) => {
        const accelerator = mediaKeyAccelerators.find(acc => acc.id === action);
        if (!accelerator || !indicator) {
            return;
        }

        if (accelerator.action === 'play-pause') {
            indicator.handleMediaPlayPause();
        } else if (accelerator.action === 'stop') {
            indicator.handleMediaStop();
        }
    });

    return { mediaKeyAccelerators, acceleratorHandlerId, mediaKeysSettingsHandlerId: null };
}

export function cleanupMediaKeys(mediaKeyAccelerators, acceleratorHandlerId, mediaKeysSettingsHandlerId, settings) {
    if (acceleratorHandlerId) {
        global.display.disconnect(acceleratorHandlerId);
        acceleratorHandlerId = null;
    }

    if (mediaKeyAccelerators) {
        const display = global.display;
        mediaKeyAccelerators.forEach(acc => {
            try {
                display.ungrab_accelerator(acc.id);
            } catch (e) {
                console.debug(e);
            }
        });
    }

    if (mediaKeysSettingsHandlerId) {
        settings?.disconnect(mediaKeysSettingsHandlerId);
        mediaKeysSettingsHandlerId = null;
    }

    return { mediaKeyAccelerators: [], acceleratorHandlerId, mediaKeysSettingsHandlerId };
}
