import Gst from 'gi://Gst';
import GstAudio from 'gi://GstAudio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { loadStations, saveStations, stationDisplayName } from '../radioUtils.js';
import { parseMetadataTags } from './metadataDisplay.js';

export function ensurePlayer(player, settings, currentMetadata, bus, busHandlerId, handleTagMessageCallback, stopPlaybackCallback, replayStationCallback) {
    if (!Gst.is_initialized()) {
        Gst.init(null);
    }

    if (player)
        return { player, bus, busHandlerId };

    player = Gst.ElementFactory.make('playbin', 'radio-player');

    const volume = settings.get_int('volume') / 100.0;
    player.set_volume(GstAudio.StreamVolumeFormat.CUBIC, volume);

    const fakeVideoSink = Gst.ElementFactory.make('fakesink', 'fake-video-sink');
    player.set_property('video-sink', fakeVideoSink);

    bus = player.get_bus();
    bus.add_signal_watch();
    busHandlerId = bus.connect('message', (b, message) => {
        if (message.type === Gst.MessageType.TAG) {
            handleTagMessageCallback(message, currentMetadata);
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

            if (errorMessage &&
                (errorMessage.includes('seeking') || errorMessage.includes('seek')) &&
                currentMetadata.nowPlaying &&
                currentMetadata.playbackState === 'playing') {
                console.log('Seeking error detected, reconnecting to stream...');
                const station = currentMetadata.nowPlaying;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    if (replayStationCallback) {
                        replayStationCallback(station);
                    }
                    return false;
                });
            } else {
                Main.notifyError(_('Playback error'), errorBody);
                stopPlaybackCallback();
            }
        } else if (message.type === Gst.MessageType.EOS) {
            stopPlaybackCallback();
        }
    });
    return { player, bus, busHandlerId };
}

export function handleTagMessage(message, currentMetadata) {
    const tagList = message.parse_tag();
    const metadata = parseMetadataTags(tagList);
    if (metadata) {
        if (metadata.title) currentMetadata.title = metadata.title;
        if (metadata.artist) currentMetadata.artist = metadata.artist;
        if (metadata.albumArt) currentMetadata.albumArt = metadata.albumArt;
        if (metadata.bitrate) currentMetadata.bitrate = metadata.bitrate;
    }
}

export function startMetadataUpdate(settings, metadataTimer, updateMetadataDisplayCallback) {
    stopMetadataUpdate(metadataTimer);
    const interval = settings?.get_int('metadata-update-interval') ?? 2;
    metadataTimer = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        interval,
        () => {
            updateMetadataDisplayCallback();
            return true;
        }
    );
    return metadataTimer;
}

export function stopMetadataUpdate(metadataTimer) {
    if (metadataTimer) {
        GLib.source_remove(metadataTimer);
        metadataTimer = null;
    }
    return metadataTimer;
}

export function playStation(station, player, settings, currentMetadata, metadataItem, volumeItem, playbackControlItem, startMetadataUpdateCallback, updateStationHistoryCallback, updatePlaybackControlCallback, refreshStationsMenuCallback) {
    try {
        currentMetadata.title = null;
        currentMetadata.artist = null;
        currentMetadata.albumArt = null;
        currentMetadata.bitrate = null;

        player.set_state(Gst.State.NULL);
        player.set_property('uri', station.url);

        const vol = (settings.get_int('volume') ?? 100) / 100;
        player.set_volume(GstAudio.StreamVolumeFormat.CUBIC, vol);

        player.set_state(Gst.State.PLAYING);

        station.lastPlayed = Date.now();
        updateStationHistoryCallback(station);

        currentMetadata.nowPlaying = station;
        currentMetadata.playbackState = 'playing';
        updatePlaybackControlCallback('playing');
        playbackControlItem.visible = true;
        volumeItem.visible = true;
        const showMetadata = settings?.get_boolean('show-metadata') ?? true;
        metadataItem.visible = showMetadata;
        if (showMetadata) {
            startMetadataUpdateCallback();
        }
        Main.notify(_('Playing %s').format(stationDisplayName(station)));
        return { nowPlaying: currentMetadata.nowPlaying, playbackState: currentMetadata.playbackState };
    } catch (error) {
        console.error(error, 'Failed to start playback');
        const errorBody = (error && typeof error === 'object' && error.message)
            ? String(error.message)
            : _('Could not start the selected station.');
        Main.notifyError(_('Playback error'), errorBody);
        return { nowPlaying: null, playbackState: 'stopped' };
    }
}

export function updateStationHistory(station) {
    const stations = loadStations();
    const stationIndex = stations.findIndex(s => s.uuid === station.uuid);
    if (stationIndex >= 0) {
        stations[stationIndex].lastPlayed = Date.now();
        saveStations(stations);
    }
}

export function updatePlaybackControl(playbackState, playbackControlItem) {
    if (playbackState === 'playing') {
        playbackControlItem.label.text = _('Pause');
    } else if (playbackState === 'paused') {
        playbackControlItem.label.text = _('Resume');
    }
}

export function togglePlayback(player, playbackState, pausedAt, nowPlaying, playStationCallback, updatePlaybackControlCallback) {
    if (!player)
        return { playbackState, pausedAt };

    if (playbackState === 'playing') {
        player.set_state(Gst.State.PAUSED);
        playbackState = 'paused';
        pausedAt = Date.now();
        updatePlaybackControlCallback(playbackState);
    } else if (playbackState === 'paused') {
        const pauseDuration = pausedAt ? Date.now() - pausedAt : 0;
        const RECONNECT_THRESHOLD = 5000;

        if (pauseDuration > RECONNECT_THRESHOLD && nowPlaying) {
            const station = nowPlaying;
            playStationCallback(station);
        } else {
            player.set_state(Gst.State.PLAYING);
            playbackState = 'playing';
            updatePlaybackControlCallback(playbackState);
        }
        pausedAt = null;
    }
    return { playbackState, pausedAt };
}

export function handleMediaPlayPause(playbackState, togglePlaybackCallback) {
    if (playbackState === 'playing' || playbackState === 'paused') {
        togglePlaybackCallback();
    }
}

export function handleMediaStop(playbackState, stopPlaybackCallback) {
    if (playbackState === 'playing' || playbackState === 'paused') {
        stopPlaybackCallback();
    }
}

export function stopPlayback(player, nowPlaying, playbackState, pausedAt, playbackControlItem, volumeItem, metadataItem, stopMetadataUpdateCallback, currentMetadata, refreshStationsMenuCallback) {
    if (!player)
        return { nowPlaying, playbackState, pausedAt };

    player.set_state(Gst.State.NULL);
    nowPlaying = null;
    playbackState = 'stopped';
    pausedAt = null;
    playbackControlItem.visible = false;
    volumeItem.visible = false;
    metadataItem.visible = false;
    stopMetadataUpdateCallback();
    currentMetadata.title = null;
    currentMetadata.artist = null;
    currentMetadata.albumArt = null;
    currentMetadata.bitrate = null;
    refreshStationsMenuCallback();
    return { nowPlaying, playbackState, pausedAt };
}

