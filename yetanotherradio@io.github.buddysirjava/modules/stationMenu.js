import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import ScrollableLabel from './scrollableLabel.js';
import { stationDisplayName } from '../radioUtils.js';
import { loadStationIcon } from './metadataDisplay.js';

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
    const item = new PopupMenu.PopupMenuItem(stationName);
    item.connect('activate', () => {
        playStationCallback(station);
    });

    const scrollable = new ScrollableLabel(item.label, item.actor, 30);
    scrollable.setText(stationName);
    item._scrollable = scrollable;

    if (station.favicon) {
        loadStationIcon(item, station.favicon);
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
