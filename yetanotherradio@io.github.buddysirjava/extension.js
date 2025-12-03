import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ensureStorageFile, loadStations, STORAGE_PATH, initTranslations } from './radioUtils.js';
import { createMetadataItem, updateMetadataDisplay, updatePlaybackStateIcon } from './modules/metadataDisplay.js';
import { createVolumeItem, onVolumeChanged } from './modules/volumeControl.js';
import { createScrollableSection, createStationMenuItem, refreshStationsMenu } from './modules/stationMenu.js';
import PlaybackManager from './modules/playbackManager.js';
import { setupMediaKeys, cleanupMediaKeys } from './modules/mediaKeys.js';

initTranslations(_);

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(stations, openPrefs, extensionPath, settings) {
            super._init(0.0, _('Yet Another Radio'));

            this._stations = stations ?? [];
            this._openPrefs = openPrefs;
            this._settings = settings;

            this._playbackManager = new PlaybackManager(this._settings, {
                onStateChanged: (state) => this._onStateChanged(state),
                onStationChanged: (station) => this._onStationChanged(station),
                onMetadataUpdate: () => this._updateMetadataDisplay(),
                onVisibilityChanged: (visible) => this._updateVisibility(visible)
            });

            const iconPath = `${extensionPath}/icons/yetanotherradio.svg`;
            const iconFile = Gio.File.new_for_path(iconPath);
            const icon = new Gio.FileIcon({ file: iconFile });

            this.add_child(new St.Icon({
                gicon: icon,
                style_class: 'system-status-icon',
            }));

            this.menu.actor.add_style_class_name('yetanotherradio-menu');

            this._metadataItem = createMetadataItem(
                () => this._togglePlayback(),
                () => this._stopPlayback()
            );
            this._metadataItem.visible = false;
            this.menu.addMenuItem(this._metadataItem);

            this._volumeItem = createVolumeItem(this._settings);
            this._volumeItem._volumeSlider.connect('notify::value', () => this._onVolumeChanged());
            this._volumeItem.visible = false;
            this.menu.addMenuItem(this._volumeItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._favoritesSection = new PopupMenu.PopupMenuSection();
            this._favoritesSection.visible = false;
            this.menu.addMenuItem(this._favoritesSection);

            this._favSeparator = new PopupMenu.PopupSeparatorMenuItem();
            this.menu.addMenuItem(this._favSeparator);

            this._stationSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._stationSection);

            this._scrollableSection = createScrollableSection();
            this._scrollableSection.visible = false;
            this.menu.addMenuItem(this._scrollableSection);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._prefsItem = new PopupMenu.PopupMenuItem(_('Open preferences'));
            this._prefsItem.connect('activate', () => this._openPrefs?.());
            this.menu.addMenuItem(this._prefsItem);

            this._hintItem = new PopupMenu.PopupMenuItem(_('Use preferences to add stations.'));
            this._hintItem.reactive = false;
            this._hintItem.sensitive = false;
            this.menu.addMenuItem(this._hintItem);

            this._refreshStationsMenu();
        }

        _onStateChanged(state) {
            updatePlaybackStateIcon(this._metadataItem, state);
        }

        _onStationChanged(station) {
            this._refreshStationsMenu();
        }

        _updateVisibility(visible) {
            const showMetadata = this._settings?.get_boolean('show-metadata') ?? true;
            this._metadataItem.visible = visible && showMetadata;
            this._volumeItem.visible = visible;
        }

        _onVolumeChanged() {
            onVolumeChanged(this._volumeItem._volumeSlider, this._volumeItem._volumeIcon, this._settings);
            this._playbackManager.setVolume(this._volumeItem._volumeSlider.value);
        }

        _updateMetadataDisplay() {
            updateMetadataDisplay(
                this._settings,
                this._metadataItem,
                this._playbackManager.nowPlaying,
                this._playbackManager.currentMetadata
            );
        }

        setStations(stations) {
            this._stations = stations ?? [];
            this._refreshStationsMenu();
        }

        _refreshStationsMenu() {
            refreshStationsMenu(
                this._stations,
                this._favoritesSection,
                this._stationSection,
                this._scrollableSection,
                this._hintItem,
                (station, isNowPlaying) => this._createStationMenuItem(station, isNowPlaying),
                this._playbackManager.nowPlaying
            );

            const favorites = this._stations.filter(s => s.favorite);
            const regular = this._stations.filter(s => !s.favorite);

            if (this._stations.length <= 6) {
                if (favorites.length > 0) {
                    this._favSeparator.visible = regular.length > 0;
                } else {
                    this._favSeparator.visible = false;
                }
            } else {
                this._favSeparator.visible = false;
            }
        }

        _createStationMenuItem(station, isNowPlaying = false) {
            return createStationMenuItem(station, (s) => this._playStation(s), isNowPlaying);
        }

        _playStation(station) {
            this._playbackManager.play(station);
        }

        _togglePlayback() {
            this._playbackManager.toggle();
        }

        _stopPlayback() {
            this._playbackManager.stop();
        }

        handleMediaPlayPause() {
            this._togglePlayback();
        }

        handleMediaStop() {
            this._stopPlayback();
        }

        destroy() {
            this._playbackManager.destroy();

            this._metadataItem = null;
            this._volumeItem = null;
            this._favoritesSection = null;
            this._stationSection = null;
            this._scrollableSection = null;
            this._prefsItem = null;
            this._hintItem = null;

            super.destroy();
        }
    });

export default class YetAnotherRadioExtension extends Extension {
    enable() {
        ensureStorageFile();
        const stations = loadStations();

        this._settings = this.getSettings();

        this._indicator = new Indicator(stations, () => this.openPreferences(), this.path, this._settings);
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._monitor = this._watchStationsFile();

        this._setupMediaKeys();
    }

    _watchStationsFile() {
        const file = Gio.File.new_for_path(STORAGE_PATH);
        const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._monitorHandlerId = monitor.connect('changed', () => {
            this._indicator?.setStations(loadStations());
        });
        return monitor;
    }

    _setupMediaKeys() {
        const { mediaKeyAccelerators, acceleratorHandlerId, mediaKeysSettingsHandlerId } = setupMediaKeys(this._settings, this._indicator);
        this._mediaKeyAccelerators = mediaKeyAccelerators;
        this._acceleratorHandlerId = acceleratorHandlerId;
        this._mediaKeysSettingsHandlerId = mediaKeysSettingsHandlerId;

        if (this._mediaKeysSettingsHandlerId) {
            this._settings?.disconnect(this._mediaKeysSettingsHandlerId);
        }
        this._mediaKeysSettingsHandlerId = this._settings?.connect('changed::enable-media-keys', () => {
            this._cleanupMediaKeys();
            this._setupMediaKeys();
        });
    }

    _cleanupMediaKeys() {
        const { mediaKeyAccelerators, acceleratorHandlerId, mediaKeysSettingsHandlerId } = cleanupMediaKeys(this._mediaKeyAccelerators, this._acceleratorHandlerId, this._mediaKeysSettingsHandlerId, this._settings);
        this._mediaKeyAccelerators = mediaKeyAccelerators;
        this._acceleratorHandlerId = acceleratorHandlerId;
        this._mediaKeysSettingsHandlerId = mediaKeysSettingsHandlerId;
    }

    disable() {
        if (this._monitor) {
            if (this._monitorHandlerId) {
                this._monitor.disconnect(this._monitorHandlerId);
                this._monitorHandlerId = null;
            }
            this._monitor.cancel();
            this._monitor = null;
        }

        this._cleanupMediaKeys();

        this._indicator?.destroy();
        this._indicator = null;

        this._settings = null;
    }
}
