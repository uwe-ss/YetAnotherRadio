import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_SERVICE_NAME = 'org.mpris.MediaPlayer2.yetanotherradio';
const MPRIS_OBJECT_PATH = '/org/mpris/MediaPlayer2';

const MPRIS_ROOT_XML = `<node>
    <interface name="org.mpris.MediaPlayer2">
        <method name="Raise"/>
        <property name="Identity" type="s" access="read"/>
        <property name="CanQuit" type="b" access="read"/>
        <property name="CanRaise" type="b" access="read"/>
        <property name="HasTrackList" type="b" access="read"/>
    </interface>
</node>`;

const MPRIS_PLAYER_XML = `<node>
    <interface name="org.mpris.MediaPlayer2.Player">
        <method name="Play"/>
        <method name="Pause"/>
        <method name="PlayPause"/>
        <method name="Stop"/>
        <method name="Next"/>
        <method name="Previous"/>
        <property name="PlaybackStatus" type="s" access="read"/>
        <property name="Metadata" type="a{sv}" access="read"/>
        <property name="Volume" type="d" access="readwrite"/>
        <property name="CanPlay" type="b" access="read"/>
        <property name="CanPause" type="b" access="read"/>
        <property name="CanControl" type="b" access="read"/>
        <property name="CanGoNext" type="b" access="read"/>
        <property name="CanGoPrevious" type="b" access="read"/>
    </interface>
</node>`;

export default class MprisInterface {
    constructor(playbackManager, settings, navigateCallback, lastStationCallback, raiseCallback) {
        this._playbackManager = playbackManager;
        this._settings = settings;
        this._navigateCallback = navigateCallback ?? null;
        this._lastStationCallback = lastStationCallback ?? null;
        this._raiseCallback = raiseCallback ?? null;
        this._stationCount = 0;
        this._dbusConnection = null;
        this._rootExported = null;
        this._playerExported = null;
        this._ownerId = 0;
        this._settingsChangedId = 0;

        this._setupCallbacks();
        this._setupSettingsMonitoring();
        this._register();
    }

    _setupCallbacks() {
        if (!this._playbackManager) return;

        this._onState = () => this._emitPlayerPropertiesChanged(['PlaybackStatus', 'CanPlay', 'CanPause']);
        this._onMeta = () => this._emitPlayerPropertiesChanged(['Metadata']);
        this._onStation = () => this._emitPlayerPropertiesChanged(['Metadata', 'CanPlay', 'CanPause', 'CanGoNext', 'CanGoPrevious']);

        this._playbackManager.addListener('onStateChanged', this._onState);
        this._playbackManager.addListener('onMetadataUpdate', this._onMeta);
        this._playbackManager.addListener('onStationChanged', this._onStation);
    }

    _setupSettingsMonitoring() {
        if (this._settings) {
            this._settingsChangedId = this._settings.connect('changed::volume', () => {
                this._emitPlayerPropertiesChanged(['Volume']);
            });
        }
    }

    _register() {
        try {
            this._dbusConnection = Gio.bus_get_sync(Gio.BusType.SESSION, null);

            const self = this;

            this._rootExported = Gio.DBusExportedObject.wrapJSObject(
                MPRIS_ROOT_XML,
                {
                    Raise() { self._raiseCallback?.(); },
                    get Identity() { return 'Yet Another Radio'; },
                    get CanQuit() { return false; },
                    get CanRaise() { return true; },
                    get HasTrackList() { return false; },
                }
            );

            this._playerExported = Gio.DBusExportedObject.wrapJSObject(
                MPRIS_PLAYER_XML,
                {
                    Play() {
                        const m = self._playbackManager;
                        if (!m) return;
                        const target = m.nowPlaying ?? self._lastStationCallback?.();
                        if (target) m.play(target);
                    },
                    Pause() { const m = self._playbackManager; if (m?.playbackState === 'playing') m.toggle(); },
                    PlayPause() {
                        const m = self._playbackManager;
                        if (!m) return;
                        if (m.playbackState === 'stopped') {
                            const target = m.nowPlaying ?? self._lastStationCallback?.();
                            if (target) m.play(target);
                        } else {
                            m.toggle();
                        }
                    },
                    Stop() { self._playbackManager?.stop(); },
                    Next() { self._navigateCallback?.(+1); },
                    Previous() { self._navigateCallback?.(-1); },
                    get PlaybackStatus() { return self._getPlaybackStatus(); },
                    get Metadata() { return self._getMetadata(); },
                    get Volume() { return self._getVolume(); },
                    set Volume(v) {
                        const vol = Math.max(0.0, Math.min(1.0, v));
                        self._playbackManager?.setVolume(vol);
                        self._settings?.set_int('volume', Math.round(vol * 100));
                    },
                    get CanPlay() { return !!self._playbackManager?.nowPlaying; },
                    get CanPause() { return !!self._playbackManager?.nowPlaying && self._getPlaybackStatus() !== 'Stopped'; },
                    get CanControl() { return true; },
                    get CanGoNext() { return self._canNavigate(); },
                    get CanGoPrevious() { return self._canNavigate(); },
                }
            );

            this._rootExported.export(this._dbusConnection, MPRIS_OBJECT_PATH);
            this._playerExported.export(this._dbusConnection, MPRIS_OBJECT_PATH);

            this._ownerId = Gio.bus_own_name_on_connection(
                this._dbusConnection,
                MPRIS_SERVICE_NAME,
                Gio.BusNameOwnerFlags.NONE,
                null,
                null
            );

            if (this._ownerId === 0) {
                console.error('MPRIS: Failed to acquire bus name');
                this._cleanup();
                return;
            }

            console.log('MPRIS: Service registered successfully');
            this._emitPlayerPropertiesChanged(['PlaybackStatus', 'Metadata', 'CanPlay', 'CanPause', 'Volume']);
        } catch (error) {
            console.error('MPRIS: Registration failed:', error);
            this._cleanup();
        }
    }

    _getPlaybackStatus() {
        if (!this._playbackManager) return 'Stopped';
        switch (this._playbackManager.playbackState) {
            case 'playing': return 'Playing';
            case 'paused': return 'Paused';
            default: return 'Stopped';
        }
    }

    _getMetadata() {
        if (this._playbackManager) {
            const metadata = this._playbackManager.getMPRISMetadata();
            if (!metadata['mpris:trackid']) {
                metadata['mpris:trackid'] = new GLib.Variant('o', '/org/mpris/MediaPlayer2/NoTrack');
            }
            return metadata;
        }

        return {
            'xesam:title': new GLib.Variant('s', 'Yet Another Radio'),
        };
    }

    _getVolume() {
        if (!this._settings) return 1.0;
        return Math.max(0.0, Math.min(1.0, this._settings.get_int('volume') / 100.0));
    }

    _canNavigate() {
        if (!this._playbackManager?.nowPlaying) return false;
        return this._stationCount > 1;
    }

    setStationCount(count) {
        this._stationCount = count;
        this._emitPlayerPropertiesChanged(['CanGoNext', 'CanGoPrevious']);
    }

    _emitPropertiesChanged(interfaceName, changedProps) {
        if (!this._dbusConnection) return;

        try {
            this._dbusConnection.emit_signal(
                null,
                MPRIS_OBJECT_PATH,
                'org.freedesktop.DBus.Properties',
                'PropertiesChanged',
                GLib.Variant.new_tuple([
                    new GLib.Variant('s', interfaceName),
                    new GLib.Variant('a{sv}', changedProps),
                    new GLib.Variant('as', [])
                ])
            );
        } catch (error) {
            console.error('MPRIS: Failed to emit PropertiesChanged:', error);
        }
    }

    _emitPlayerPropertiesChanged(propertyNames) {
        const getters = {
            PlaybackStatus: () => new GLib.Variant('s', this._getPlaybackStatus()),
            Metadata: () => new GLib.Variant('a{sv}', this._getMetadata()),
            Volume: () => new GLib.Variant('d', this._getVolume()),
            CanPlay: () => new GLib.Variant('b', !!this._playbackManager?.nowPlaying),
            CanPause: () => new GLib.Variant('b', !!this._playbackManager?.nowPlaying && this._getPlaybackStatus() !== 'Stopped'),
            CanGoNext: () => new GLib.Variant('b', this._canNavigate()),
            CanGoPrevious: () => new GLib.Variant('b', this._canNavigate()),
        };

        const changed = {};
        for (const name of propertyNames) {
            if (getters[name]) changed[name] = getters[name]();
        }

        if (Object.keys(changed).length > 0) {
            this._emitPropertiesChanged('org.mpris.MediaPlayer2.Player', changed);
        }
    }

    _cleanup() {
        if (this._playbackManager) {
            this._playbackManager.removeListener('onStateChanged', this._onState);
            this._playbackManager.removeListener('onMetadataUpdate', this._onMeta);
            this._playbackManager.removeListener('onStationChanged', this._onStation);
        }
        this._onState = null;
        this._onMeta = null;
        this._onStation = null;

        if (this._settingsChangedId !== 0) {
            if (this._settings) {
                this._settings.disconnect(this._settingsChangedId);
            }
            this._settingsChangedId = 0;
        }

        if (this._ownerId !== 0) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }

        if (this._rootExported) {
            this._rootExported.unexport();
            this._rootExported = null;
        }

        if (this._playerExported) {
            this._playerExported.unexport();
            this._playerExported = null;
        }

        this._dbusConnection = null;
    }

    destroy() {
        this._cleanup();
        this._playbackManager = null;
        this._settings = null;
    }
}
