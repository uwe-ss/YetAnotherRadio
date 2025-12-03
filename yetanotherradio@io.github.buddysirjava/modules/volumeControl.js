import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

export function createVolumeItem(settings) {
    const item = new PopupMenu.PopupBaseMenuItem({
        activate: false,
    });

    const volumeIcon = new St.Icon({
        icon_name: 'audio-volume-high-symbolic',
        style_class: 'popup-menu-icon',
    });
    item.add_child(volumeIcon);

    const volume = settings.get_int('volume') / 100.0;
    const volumeSlider = new Slider.Slider(volume);

    item.add_child(volumeSlider);
    volumeSlider.x_expand = true;
    volumeSlider.y_align = Clutter.ActorAlign.CENTER;

    item._volumeIcon = volumeIcon;
    item._volumeSlider = volumeSlider;

    return item;
}

export function onVolumeChanged(volumeSlider, volumeIcon, settings) {
    const volume = volumeSlider.value;

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
    volumeIcon.icon_name = iconName;

    settings.set_int('volume', Math.round(volume * 100));
}
