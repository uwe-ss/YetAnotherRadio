import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Gst from 'gi://Gst';
import GstAudio from 'gi://GstAudio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { ensureStorageFile, loadStations, saveStations, stationDisplayName, STORAGE_PATH, initTranslations } from './radioUtils.js';

initTranslations(_);

const METADATA_ICON_SIZE = 64;

const Indicator = GObject.registerClass(
    class Indicator extends PanelMenu.Button {
        _init(stations, openPrefs, extensionPath, settings) {
            super._init(0.0, _('Yet Another Radio'));

            this._stations = stations ?? [];
            this._openPrefs = openPrefs;
            this._settings = settings;
            this._player = null;
            this._nowPlaying = null;
            this._playbackState = 'stopped';
            this._metadataTimer = null;
            this._currentMetadata = {
                title: null,
                artist: null,
                albumArt: null
            };
            this._bus = null;
            this._busHandlerId = null;
            this._pausedAt = null;

            const iconPath = `${extensionPath}/icons/yetanotherradio.svg`;
            const iconFile = Gio.File.new_for_path(iconPath);
            const icon = new Gio.FileIcon({ file: iconFile });

            this.add_child(new St.Icon({
                gicon: icon,
                style_class: 'system-status-icon',
            }));

            this.menu.actor.add_style_class_name('yetanotherradio-menu');

            this._metadataItem = this._createMetadataItem();
            this._metadataItem.visible = false;
            this.menu.addMenuItem(this._metadataItem);

            this._volumeItem = this._createVolumeItem();
            this._volumeItem.visible = false;
            this.menu.addMenuItem(this._volumeItem);

            this._playbackControlItem = new PopupMenu.PopupMenuItem(_('Pause'));
            this._playbackControlItem.connect('activate', () => this._togglePlayback());
            this._playbackControlItem.visible = false;
            this.menu.addMenuItem(this._playbackControlItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._favoritesSection = new PopupMenu.PopupMenuSection();
            this._favoritesSection.visible = false;
            this.menu.addMenuItem(this._favoritesSection);

            this._favSeparator = new PopupMenu.PopupSeparatorMenuItem();
            this.menu.addMenuItem(this._favSeparator);

            this._stationSection = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._stationSection);

            this._scrollableSection = this._createScrollableSection();
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

        _createMetadataItem() {
            const box = new St.BoxLayout({
                vertical: false,
                style_class: 'metadata-item-box'
            });

            const thumbnail = new St.Icon({
                icon_name: 'audio-x-generic-symbolic',
                icon_size: METADATA_ICON_SIZE,
                style_class: 'metadata-thumbnail'
            });
            box.add_child(thumbnail);

            const textBox = new St.BoxLayout({
                vertical: true,
                style_class: 'metadata-text-box'
            });

            const titleLabel = new St.Label({
                text: '',
                style_class: 'metadata-title'
            });
            titleLabel.clutter_text.ellipsize = 3;
            textBox.add_child(titleLabel);

            const artistLabel = new St.Label({
                text: '',
                style_class: 'metadata-artist'
            });
            artistLabel.clutter_text.ellipsize = 3;
            textBox.add_child(artistLabel);

            const qualityLabel = new St.Label({
                text: '',
                style_class: 'metadata-quality'
            });
            textBox.add_child(qualityLabel);

            box.add_child(textBox);

            const item = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false
            });
            item.add_child(box);

            item._thumbnail = thumbnail;
            item._titleLabel = titleLabel;
            item._artistLabel = artistLabel;
            item._qualityLabel = qualityLabel;

            return item;
        }

        _createScrollableSection() {
            if (PopupMenu.PopupMenuScrollSection) {
                const section = new PopupMenu.PopupMenuScrollSection();
                section.actor.add_style_class_name('yetanotherradio-scroll-view');
                return section;
            }

            const scrollView = new St.ScrollView({
                style_class: 'yetanotherradio-scroll-view',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC
            });

            const box = new St.BoxLayout({
                vertical: true
            });
            scrollView.add_child(box);

            const item = new PopupMenu.PopupBaseMenuItem({
                reactive: false,
                can_focus: false
            });
            item.actor.add_child(scrollView);
            
            // Allow the scrollview to take up space
            scrollView.x_expand = true;
            scrollView.y_expand = true;
            
            item._box = box;
            return item;
        }

        _createVolumeItem() {
            const item = new PopupMenu.PopupBaseMenuItem({
                activate: false,
            });

            this._volumeIcon = new St.Icon({
                icon_name: 'audio-volume-high-symbolic',
                style_class: 'popup-menu-icon',
            });
            item.add_child(this._volumeIcon);

            const volume = this._settings.get_int('volume') / 100.0;
            this._volumeSlider = new Slider.Slider(volume);
            this._volumeSlider.connect('notify::value', () => this._onVolumeChanged());
            
            // Add slider with expand to fill the width
            item.add_child(this._volumeSlider);
            this._volumeSlider.x_expand = true;
            this._volumeSlider.y_align = Clutter.ActorAlign.CENTER;

            return item;
        }

        _onVolumeChanged() {
            const volume = this._volumeSlider.value;
            
            // Update player volume
            if (this._player) {
                this._player.set_volume(GstAudio.StreamVolumeFormat.CUBIC, volume);
            }

            // Update icon
            let iconName;
            if (volume <= 0) {
                iconName = 'audio-volume-muted-symbolic';
            } else if (volume < 0.33) {
                iconName = 'audio-volume-low-symbolic';
            } else if (volume < 0.66) {
                iconName = 'audio-volume-medium-symbolic';
            } else {
                iconName = 'audio-volume-high-symbolic';
            }
            this._volumeIcon.icon_name = iconName;

            // Save setting (debounced would be better, but simple for now)
            this._settings.set_int('volume', Math.round(volume * 100));
        }

        _updateMetadataDisplay() {
            const showMetadata = this._settings?.get_boolean('show-metadata') ?? true;
            if (!showMetadata || !this._metadataItem.visible || !this._player)
                return;

            this._queryPlayerTags();

            let title = this._currentMetadata.title || _('Unknown title');
            let artist = this._currentMetadata.artist || _('Unknown artist');
            const bitrate = this._currentMetadata.bitrate;

            if (title.length > 35) {
                title = title.substring(0, 32) + '...';
            }
            if (artist.length > 35) {
                artist = artist.substring(0, 32) + '...';
            }

            this._metadataItem._titleLabel.text = title;
            this._metadataItem._artistLabel.text = artist;

            if (bitrate) {
                const kbps = Math.round(bitrate / 1000);
                this._metadataItem._qualityLabel.text = `${kbps} kbps`;
                this._metadataItem._qualityLabel.visible = true;
            } else {
                this._metadataItem._qualityLabel.text = '';
                this._metadataItem._qualityLabel.visible = false;
            }

            let thumbnailSet = false;
            if (this._currentMetadata.albumArt) {
                try {
                    let file;
                    if (this._currentMetadata.albumArt.startsWith('file://') ||
                        this._currentMetadata.albumArt.startsWith('http://') ||
                        this._currentMetadata.albumArt.startsWith('https://')) {
                        file = Gio.File.new_for_uri(this._currentMetadata.albumArt);
                    } else if (this._currentMetadata.albumArt.startsWith('/')) {
                        file = Gio.File.new_for_path(this._currentMetadata.albumArt);
                    } else {
                        file = Gio.File.new_for_uri(this._currentMetadata.albumArt);
                    }
                    const icon = new Gio.FileIcon({ file: file });
                    this._metadataItem._thumbnail.gicon = icon;
                    this._metadataItem._thumbnail.icon_size = METADATA_ICON_SIZE;
                    thumbnailSet = true;
                } catch (e) {
                    console.debug(e);
                }
            }

            if (!thumbnailSet && this._nowPlaying?.favicon) {
                try {
                    const file = Gio.File.new_for_uri(this._nowPlaying.favicon);
                    const icon = new Gio.FileIcon({ file: file });
                    this._metadataItem._thumbnail.gicon = icon;
                    this._metadataItem._thumbnail.icon_size = METADATA_ICON_SIZE;
                    thumbnailSet = true;
                } catch (e) {
                    console.debug(e);
                }
            }

            if (!thumbnailSet) {
                this._metadataItem._thumbnail.icon_name = 'audio-x-generic-symbolic';
            }
        }

        _parseMetadataTags(tagList) {
            if (!tagList)
                return null;

            let title = null;
            if (tagList.get_string(Gst.TAG_TITLE)) {
                [, title] = tagList.get_string(Gst.TAG_TITLE);
            }

            let artist = null;
            if (tagList.get_string(Gst.TAG_ARTIST)) {
                [, artist] = tagList.get_string(Gst.TAG_ARTIST);
            }

            let albumArt = null;
            if (tagList.get_string(Gst.TAG_IMAGE)) {
                [, albumArt] = tagList.get_string(Gst.TAG_IMAGE);
            } else if (tagList.get_string(Gst.TAG_PREVIEW_IMAGE)) {
                [, albumArt] = tagList.get_string(Gst.TAG_PREVIEW_IMAGE);
            }

            return { title, artist, albumArt };
        }

        _queryPlayerTags() {
            if (!this._player)
                return;

            try {
                const tagList = this._player.query_tags(Gst.TagMergeMode.UNDEFINED);
                const metadata = this._parseMetadataTags(tagList);
                if (metadata) {
                    if (metadata.title) this._currentMetadata.title = metadata.title;
                    if (metadata.artist) this._currentMetadata.artist = metadata.artist;
                    if (metadata.albumArt) this._currentMetadata.albumArt = metadata.albumArt;
                    if (metadata.bitrate) this._currentMetadata.bitrate = metadata.bitrate;
                }
            } catch (e) {
                console.debug(e);
            }
        }

        _loadStationIcon(item, faviconUrl) {
            if (!faviconUrl)
                return;

            try {
                const file = Gio.File.new_for_uri(faviconUrl);
                const icon = new Gio.FileIcon({ file: file });
                const iconWidget = new St.Icon({
                    gicon: icon,
                    icon_size: 16,
                    style_class: 'system-status-icon'
                });
                item.insert_child_at_index(iconWidget, 0);
            } catch (e) {
                console.debug(e);
            }
        }

        setStations(stations) {
            this._stations = stations ?? [];
            this._refreshStationsMenu();
        }

        _refreshStationsMenu() {
            this._favoritesSection.removeAll();
            this._stationSection.removeAll();
            
            if (this._scrollableSection.removeAll) {
                this._scrollableSection.removeAll();
            } else if (this._scrollableSection._box) {
                this._scrollableSection._box.destroy_all_children();
            }

            if (!this._stations.length) {
                const emptyItem = new PopupMenu.PopupMenuItem(_('No saved stations yet. Use preferences to add some.'));
                emptyItem.reactive = false;
                emptyItem.sensitive = false;
                this._stationSection.addMenuItem(emptyItem);
                
                this._favoritesSection.visible = false;
                this._favSeparator.visible = false;
                this._stationSection.visible = true;
                this._scrollableSection.visible = false;
                
                this._hintItem.visible = true;
                return;
            }

            this._hintItem.visible = false;

            const favorites = this._stations.filter(s => s.favorite).sort((a, b) =>
                stationDisplayName(a).localeCompare(stationDisplayName(b))
            );
            const regular = this._stations.filter(s => !s.favorite);

            if (this._stations.length > 6) {
                this._favoritesSection.visible = false;
                this._favSeparator.visible = false;
                this._stationSection.visible = false;
                this._scrollableSection.visible = true;

                const addStation = (station) => {
                    const item = this._createStationMenuItem(station);
                    if (this._scrollableSection.addMenuItem) {
                        this._scrollableSection.addMenuItem(item);
                    } else {
                        this._scrollableSection._box.add_child(item.actor);
                    }
                };

                if (favorites.length > 0) {
                    favorites.forEach(addStation);
                    
                    if (regular.length > 0) {
                        if (this._scrollableSection.addMenuItem) {
                            this._scrollableSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                        } else {
                            const sep = new PopupMenu.PopupSeparatorMenuItem();
                            this._scrollableSection._box.add_child(sep.actor);
                        }
                    }
                }
                
                regular.forEach(addStation);
            } else {
                this._scrollableSection.visible = false;
                this._stationSection.visible = true;

                if (favorites.length > 0) {
                    favorites.forEach(station => {
                        const item = this._createStationMenuItem(station);
                        this._favoritesSection.addMenuItem(item);
                    });
                    this._favoritesSection.visible = true;
                    this._favSeparator.visible = regular.length > 0;
                } else {
                    this._favoritesSection.visible = false;
                    this._favSeparator.visible = false;
                }

                regular.forEach(station => {
                    const item = this._createStationMenuItem(station);
                    this._stationSection.addMenuItem(item);
                });
            }
        }

        _createStationMenuItem(station) {
            const stationName = stationDisplayName(station);
            const item = new PopupMenu.PopupMenuItem(stationName);
            item.connect('activate', () => {
                this._playStation(station);
            });

            if (stationName.length > 40) {
                item.label.text = stationName.substring(0, 37) + '...';
            }

            if (station.favicon) {
                this._loadStationIcon(item, station.favicon);
            }

            return item;
        }

        _ensurePlayer() {
            if (!Gst.is_initialized()) {
                    Gst.init(null);
            }

            if (this._player)
                return;

            this._player = Gst.ElementFactory.make('playbin', 'radio-player');
            
            // Set initial volume
            const volume = this._settings.get_int('volume') / 100.0;
            this._player.set_volume(GstAudio.StreamVolumeFormat.CUBIC, volume);

            const fakeVideoSink = Gst.ElementFactory.make('fakesink', 'fake-video-sink');
            this._player.set_property('video-sink', fakeVideoSink);

            this._bus = this._player.get_bus();
            this._bus.add_signal_watch();
            this._busHandlerId = this._bus.connect('message', (bus, message) => {
                if (message.type === Gst.MessageType.TAG) {
                    this._handleTagMessage(message);
                } else if (message.type === Gst.MessageType.ERROR) {
                    const [error, debug] = message.parse_error();
                    console.error(error, debug);
                    let errorBody = _('Could not play the selected station.');
                    let errorMessage = '';
                    if (error) {
                        if (error.message && typeof error.message === 'string') {
                            errorMessage = String(error.message);
                            errorBody = errorMessage;
                        } else if (debug && typeof debug === 'string') {
                            errorMessage = String(debug);
                            errorBody = errorMessage;
                        } else if (typeof error === 'string') {
                            errorMessage = String(error);
                            errorBody = errorMessage;
                        }
                    }
                    
                    // If we get a "seeking" error and we have a station playing, reconnect to stream
                    if (errorMessage && 
                        (errorMessage.includes('seeking') || errorMessage.includes('seek')) &&
                        this._nowPlaying && 
                        this._playbackState === 'playing') {
                        console.log('Seeking error detected, reconnecting to stream...');
                        const station = this._nowPlaying;
                        // Small delay to ensure player state is cleaned up
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                            this._playStation(station);
                            return false;
                        });
                    } else {
                        Main.notifyError(_('Playback error'), errorBody);
                        this._stopPlayback();
                    }
                } else if (message.type === Gst.MessageType.EOS) {
                    this._stopPlayback();
                }
            });
        }

        _handleTagMessage(message) {
            const tagList = message.parse_tag();
            const metadata = this._parseMetadataTags(tagList);
            if (metadata) {
                if (metadata.title) this._currentMetadata.title = metadata.title;
                if (metadata.artist) this._currentMetadata.artist = metadata.artist;
                if (metadata.albumArt) this._currentMetadata.albumArt = metadata.albumArt;
                if (metadata.bitrate) this._currentMetadata.bitrate = metadata.bitrate;
            }
        }

        _startMetadataUpdate() {
            this._stopMetadataUpdate();
            const interval = this._settings?.get_int('metadata-update-interval') ?? 2;
            this._metadataTimer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                interval,
                () => {
                    this._updateMetadataDisplay();
                    return true;
                }
            );
        }

        _stopMetadataUpdate() {
            if (this._metadataTimer) {
                GLib.source_remove(this._metadataTimer);
                this._metadataTimer = null;
            }
        }

        _playStation(station) {
            try {
                this._ensurePlayer();

                this._currentMetadata = {
                    title: null,
                    artist: null,
                    albumArt: null,
                    bitrate: null
                };

                this._player.set_state(Gst.State.NULL);
                this._player.set_property('uri', station.url);
                
                // Ensure volume is set correctly when starting playback
                const vol = (this._settings.get_int('volume') || 100) / 100;
                this._player.set_volume(GstAudio.StreamVolumeFormat.CUBIC, vol);
                
                this._player.set_state(Gst.State.PLAYING);

                station.lastPlayed = Date.now();
                this._updateStationHistory(station);

                this._nowPlaying = station;
                this._playbackState = 'playing';
                this._updatePlaybackControl();
                this._playbackControlItem.visible = true;
                this._volumeItem.visible = true;
                const showMetadata = this._settings?.get_boolean('show-metadata') ?? true;
                this._metadataItem.visible = showMetadata;
                if (showMetadata) {
                    this._startMetadataUpdate();
                }
                Main.notify(_('Playing %s').format(stationDisplayName(station)));
            } catch (error) {
                console.error(error, 'Failed to start playback');
                const errorBody = (error && typeof error === 'object' && error.message) 
                    ? String(error.message) 
                    : _('Could not start the selected station.');
                Main.notifyError(_('Playback error'), errorBody);
            }
        }

        _updateStationHistory(station) {
            const stations = loadStations();
            const stationIndex = stations.findIndex(s => s.uuid === station.uuid);
            if (stationIndex >= 0) {
                stations[stationIndex].lastPlayed = Date.now();
                saveStations(stations);
            }
        }

        _updatePlaybackControl() {
            if (this._playbackState === 'playing') {
                this._playbackControlItem.label.text = _('Pause');
            } else if (this._playbackState === 'paused') {
                this._playbackControlItem.label.text = _('Resume');
            }
        }

        _togglePlayback() {
            if (!this._player)
                return;

            if (this._playbackState === 'playing') {
                this._player.set_state(Gst.State.PAUSED);
                this._playbackState = 'paused';
                this._pausedAt = Date.now();
                this._updatePlaybackControl();
            } else if (this._playbackState === 'paused') {
                // For live streams, if paused for more than 5 seconds, reconnect to stream
                // This prevents "Server does not support seeking" errors
                const pauseDuration = this._pausedAt ? Date.now() - this._pausedAt : 0;
                const RECONNECT_THRESHOLD = 5000; // 5 seconds in milliseconds
                
                if (pauseDuration > RECONNECT_THRESHOLD && this._nowPlaying) {
                    // Reconnect to the stream to get current position
                    const station = this._nowPlaying;
                    this._playStation(station);
                } else {
                    // Short pause, try to resume normally
                    this._player.set_state(Gst.State.PLAYING);
                    this._playbackState = 'playing';
                    this._updatePlaybackControl();
                }
                this._pausedAt = null;
            }
        }

        // Public methods for media key handlers
        handleMediaPlayPause() {
            if (this._playbackState === 'playing' || this._playbackState === 'paused') {
                this._togglePlayback();
            }
        }

        handleMediaStop() {
            if (this._playbackState === 'playing' || this._playbackState === 'paused') {
                this._stopPlayback();
            }
        }

        _stopPlayback() {
            if (!this._player)
                return;

            this._player.set_state(Gst.State.NULL);
            this._nowPlaying = null;
            this._playbackState = 'stopped';
            this._pausedAt = null;
            this._playbackControlItem.visible = false;
            this._volumeItem.visible = false;
            this._metadataItem.visible = false;
            this._stopMetadataUpdate();
            this._currentMetadata = {
                title: null,
                artist: null,
                albumArt: null
            };
            this._refreshStationsMenu();
        }

        destroy() {
            if (this._playbackState !== 'stopped') {
                this._stopPlayback();
            }

            this._stopMetadataUpdate();

            if (this._bus) {
                if (this._busHandlerId) {
                    this._bus.disconnect(this._busHandlerId);
                    this._busHandlerId = null;
                }
                this._bus.remove_signal_watch();
                this._bus = null;
            }

            if (this._player) {
                try {
                    this._player.set_state(Gst.State.NULL);
                } catch (e) {
                    console.debug(e);
                }
                this._player = null;
            }

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

        // Setup media keys
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
        const enableMediaKeys = this._settings?.get_boolean('enable-media-keys') ?? true;
        if (!enableMediaKeys) {
            return;
        }

        const display = global.display;
        this._mediaKeyAccelerators = [];

        // XF86AudioPlay - Play/Pause toggle
        const playPauseId = display.grab_accelerator('XF86AudioPlay', Meta.KeyBindingFlags.NONE);
        if (playPauseId > 0) {
            this._mediaKeyAccelerators.push({
                id: playPauseId,
                action: 'play-pause'
            });
        }

        // XF86AudioStop - Stop playback
        const stopId = display.grab_accelerator('XF86AudioStop', Meta.KeyBindingFlags.NONE);
        if (stopId > 0) {
            this._mediaKeyAccelerators.push({
                id: stopId,
                action: 'stop'
            });
        }

        // Connect to accelerator activated signal
        this._acceleratorHandlerId = global.display.connect('accelerator-activated', (display, action, deviceId, timestamp) => {
            const accelerator = this._mediaKeyAccelerators.find(acc => acc.id === action);
            if (!accelerator || !this._indicator) {
                return;
            }

            if (accelerator.action === 'play-pause') {
                this._indicator.handleMediaPlayPause();
            } else if (accelerator.action === 'stop') {
                this._indicator.handleMediaStop();
            }
        });

        // Listen for settings changes
        this._mediaKeysSettingsHandlerId = this._settings?.connect('changed::enable-media-keys', () => {
            this._cleanupMediaKeys();
            this._setupMediaKeys();
        });
    }

    _cleanupMediaKeys() {
        if (this._acceleratorHandlerId) {
            global.display.disconnect(this._acceleratorHandlerId);
            this._acceleratorHandlerId = null;
        }

        if (this._mediaKeyAccelerators) {
            const display = global.display;
            this._mediaKeyAccelerators.forEach(acc => {
                try {
                    display.ungrab_accelerator(acc.id);
                } catch (e) {
                    // Ignore errors when ungrabing
                    console.debug(e);
                }
            });
            this._mediaKeyAccelerators = [];
        }

        if (this._mediaKeysSettingsHandlerId) {
            this._settings?.disconnect(this._mediaKeysSettingsHandlerId);
            this._mediaKeysSettingsHandlerId = null;
        }
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
