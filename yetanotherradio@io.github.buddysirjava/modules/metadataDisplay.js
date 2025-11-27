import St from 'gi://St';
import Gio from 'gi://Gio';
import Gst from 'gi://Gst';
import GLib from 'gi://GLib';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import ScrollableLabel from './scrollableLabel.js';

const METADATA_ICON_SIZE = 64;

export function createMetadataItem() {
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
        style_class: 'metadata-text-box',
        reactive: true
    });

    const titleLabel = new St.Label({
        text: '',
        style_class: 'metadata-title'
    });
    textBox.add_child(titleLabel);

    const artistLabel = new St.Label({
        text: '',
        style_class: 'metadata-artist'
    });
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

    item._titleScrollable = new ScrollableLabel(titleLabel, textBox, 30);
    item._artistScrollable = new ScrollableLabel(artistLabel, textBox, 30);

    return item;
}

function extractImageFromSample(sample) {
    if (!sample)
        return null;

    try {
        const buffer = sample.get_buffer();
        if (!buffer)
            return null;

        const mapInfo = buffer.map(Gst.MapFlags.READ);
        if (!mapInfo)
            return null;

        try {
            const data = mapInfo.data;
            if (!data || data.length === 0)
                return null;

            let extension = 'jpg';
            const caps = sample.get_caps();
            if (caps) {
                const structure = caps.get_structure(0);
                if (structure) {
                    const name = structure.get_name();
                    if (name) {
                        if (name.includes('png')) extension = 'png';
                        else if (name.includes('gif')) extension = 'gif';
                        else if (name.includes('jpeg') || name.includes('jpg')) extension = 'jpg';
                        else if (name.includes('webp')) extension = 'webp';
                    }
                }
            }

            const tmpDir = GLib.get_tmp_dir();
            const tmpFile = Gio.File.new_for_path(
                GLib.build_filenamev([tmpDir, `yetanotherradio-art-${GLib.get_real_time()}.${extension}`])
            );

            const outputStream = tmpFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
            outputStream.write_all(data, null);
            outputStream.close(null);

            return tmpFile.get_uri();
        } finally {
            buffer.unmap(mapInfo);
        }
    } catch (e) {
        console.debug('Error extracting image from sample:', e);
        return null;
    }
}

export function parseMetadataTags(tagList) {
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
    let sample;
    if (tagList.get_sample(Gst.TAG_IMAGE)) {
        [, sample] = tagList.get_sample(Gst.TAG_IMAGE);
        albumArt = extractImageFromSample(sample);
    } else if (tagList.get_sample(Gst.TAG_PREVIEW_IMAGE)) {
        [, sample] = tagList.get_sample(Gst.TAG_PREVIEW_IMAGE);
        albumArt = extractImageFromSample(sample);
    }

    let bitrate = null;
    if (tagList.get_uint(Gst.TAG_BITRATE)) {
        [, bitrate] = tagList.get_uint(Gst.TAG_BITRATE);
    }

    return { title, artist, albumArt, bitrate };
}

export function queryPlayerTags(player, currentMetadata) {
    if (!player)
        return;

    try {
        const tagList = player.query_tags(Gst.TagMergeMode.UNDEFINED);
        const metadata = parseMetadataTags(tagList);
        if (metadata) {
            if (metadata.title) currentMetadata.title = metadata.title;
            if (metadata.artist) currentMetadata.artist = metadata.artist;
            if (metadata.albumArt) currentMetadata.albumArt = metadata.albumArt;
            if (metadata.bitrate) currentMetadata.bitrate = metadata.bitrate;
        }
    } catch (e) {
        console.debug(e);
    }
}

export function updateMetadataDisplay(settings, metadataItem, player, nowPlaying, currentMetadata) {
    const showMetadata = settings?.get_boolean('show-metadata') ?? true;
    if (!showMetadata || !metadataItem.visible || !player)
        return;

    queryPlayerTags(player, currentMetadata);

    let title = currentMetadata.title || _('Unknown title');
    let artist = currentMetadata.artist || _('Unknown artist');
    const bitrate = currentMetadata.bitrate;

    metadataItem._titleScrollable.setText(title);
    metadataItem._artistScrollable.setText(artist);

    if (bitrate) {
        const kbps = Math.round(bitrate / 1000);
        metadataItem._qualityLabel.text = `${kbps} kbps`;
        metadataItem._qualityLabel.visible = true;
    } else {
        metadataItem._qualityLabel.text = '';
        metadataItem._qualityLabel.visible = false;
    }

    let thumbnailSet = false;
    if (currentMetadata.albumArt) {
        try {
            let file;
            if (currentMetadata.albumArt.startsWith('file://') ||
                currentMetadata.albumArt.startsWith('http://') ||
                currentMetadata.albumArt.startsWith('https://')) {
                file = Gio.File.new_for_uri(currentMetadata.albumArt);
            } else if (currentMetadata.albumArt.startsWith('/')) {
                file = Gio.File.new_for_path(currentMetadata.albumArt);
            } else {
                file = Gio.File.new_for_uri(currentMetadata.albumArt);
            }
            const icon = new Gio.FileIcon({ file: file });
            metadataItem._thumbnail.gicon = icon;
            metadataItem._thumbnail.icon_size = METADATA_ICON_SIZE;
            thumbnailSet = true;
        } catch (e) {
            console.debug(e);
        }
    }

    if (!thumbnailSet && nowPlaying?.favicon) {
        try {
            const file = Gio.File.new_for_uri(nowPlaying.favicon);
            const icon = new Gio.FileIcon({ file: file });
            metadataItem._thumbnail.gicon = icon;
            metadataItem._thumbnail.icon_size = METADATA_ICON_SIZE;
            thumbnailSet = true;
        } catch (e) {
            console.debug(e);
        }
    }

    if (!thumbnailSet) {
        metadataItem._thumbnail.icon_name = 'audio-x-generic-symbolic';
    }
}

export function loadStationIcon(item, faviconUrl) {
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

