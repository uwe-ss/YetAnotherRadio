import GLib from 'gi://GLib';
import St from 'gi://St';
import Gio from 'gi://Gio';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import ScrollableLabel from './scrollableLabel.js';
import { stationDisplayName } from '../radioUtils.js';

export function createScrollableSection() {
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

    scrollView.x_expand = true;
    scrollView.y_expand = true;

    item._box = box;
    return item;
}

export function createStationMenuItem(station, playStationCallback, isNowPlaying = false) {
    const stationName = stationDisplayName(station);
    const escapedName = GLib.markup_escape_text(stationName, -1);
    const item = new PopupMenu.PopupMenuItem(escapedName);
    item.connect('activate', () => {
        playStationCallback(station);
    });

    const scrollable = new ScrollableLabel(item.label, item.actor, 30);
    scrollable.setText(stationName);
    item._scrollable = scrollable;

    const iconWidget = new St.Icon({
        icon_name: 'audio-x-generic-symbolic',
        icon_size: 16,
        style_class: 'system-status-icon'
    });
    item.insert_child_at_index(iconWidget, 0);

    if (station.favicon) {
        if (station.favicon.startsWith('file://')) {
            const path = station.favicon.replace('file://', '');
            if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
                return item;
            }
        } else if (station.favicon.startsWith('/')) {
            if (!GLib.file_test(station.favicon, GLib.FileTest.EXISTS)) {
                return item;
            }
        }

        try {
            const file = Gio.File.new_for_uri(station.favicon);
            const icon = new Gio.FileIcon({ file: file });
            iconWidget.gicon = icon;
            iconWidget.icon_name = null;
        } catch (e) {
            console.debug(e);
        }
    }

    if (isNowPlaying) {
        item.actor.add_style_class_name('yetanotherradio-current-station');
    }

    return item;
}

export function refreshStationsMenu(stations, favoritesSection, stationSection, scrollableSection, hintItem, createStationMenuItemCallback, nowPlaying = null) {
    favoritesSection.removeAll();
    stationSection.removeAll();

    if (scrollableSection.removeAll) {
        scrollableSection.removeAll();
    } else if (scrollableSection._box) {
        scrollableSection._box.destroy_all_children();
    }

    if (!stations.length) {
        const emptyItem = new PopupMenu.PopupMenuItem(_('No saved stations yet. Use preferences to add some.'));
        emptyItem.reactive = false;
        emptyItem.sensitive = false;
        stationSection.addMenuItem(emptyItem);

        favoritesSection.visible = false;
        stationSection.visible = true;
        scrollableSection.visible = false;

        hintItem.visible = true;
        return;
    }

    hintItem.visible = false;

    const favorites = stations.filter(s => s.favorite).sort((a, b) =>
        stationDisplayName(a).localeCompare(stationDisplayName(b))
    );
    const regular = stations.filter(s => !s.favorite);

    const isNowPlayingStation = (station) => {
        if (!nowPlaying)
            return false;

        if (nowPlaying.uuid && station.uuid)
            return station.uuid === nowPlaying.uuid;

        return stationDisplayName(station) === stationDisplayName(nowPlaying);
    };

    if (stations.length > 6) {
        favoritesSection.visible = false;
        stationSection.visible = false;
        scrollableSection.visible = true;

        const addStation = (station) => {
            const item = createStationMenuItemCallback(station, isNowPlayingStation(station));
            if (scrollableSection.addMenuItem) {
                scrollableSection.addMenuItem(item);
            } else {
                scrollableSection._box.add_child(item.actor);
            }
        };

        if (favorites.length > 0) {
            favorites.forEach(addStation);

            if (regular.length > 0) {
                if (scrollableSection.addMenuItem) {
                    scrollableSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                } else {
                    const sep = new PopupMenu.PopupSeparatorMenuItem();
                    scrollableSection._box.add_child(sep.actor);
                }
            }
        }

        regular.forEach(addStation);
    } else {
        scrollableSection.visible = false;
        stationSection.visible = true;

        if (favorites.length > 0) {
            favorites.forEach(station => {
                const item = createStationMenuItemCallback(station, isNowPlayingStation(station));
                favoritesSection.addMenuItem(item);
            });
            favoritesSection.visible = true;
        } else {
            favoritesSection.visible = false;
        }

        regular.forEach(station => {
            const item = createStationMenuItemCallback(station, isNowPlayingStation(station));
            stationSection.addMenuItem(item);
        });
    }
}
