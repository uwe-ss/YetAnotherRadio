import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

const ScrollableLabel = class ScrollableLabel {
    constructor(label, hoverActor, maxLength = 30) {
        this._label = label;
        this._hoverActor = hoverActor;
        this._maxLength = maxLength;
        this._originalText = '';
        this._loopText = '';
        this._loopThreshold = 0;
        this._timeoutId = null;
        this._scrollIndex = 0;
        this._isHovering = false;

        this._label.style = 'width: 22em; text-align: left;';
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._label.clutter_text.line_wrap = false;

        if (!this._hoverActor.reactive) {
            this._hoverActor.reactive = true;
        }

        this._enterId = this._hoverActor.connect('enter-event', () => {
            this._isHovering = true;
            this._startAnimation();
        });
        this._leaveId = this._hoverActor.connect('leave-event', () => {
            this._isHovering = false;
            this._stopAnimation();
        });

        this._destroyId = this._label.connect('destroy', () => this.destroy());
    }

    setText(text) {
        this._originalText = text || '';
        this._loopText = this._originalText + '   ' + this._originalText;
        this._loopThreshold = this._originalText.length + 3;

        this._stopAnimation();
        this._updateDisplay();

        if (this._isHovering) {
            this._startAnimation();
        }
    }

    _startAnimation() {
        if (this._originalText.length <= this._maxLength) return;
        if (this._timeoutId) return;

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._scrollIndex++;
            if (this._scrollIndex >= this._loopThreshold) {
                this._scrollIndex = 0;
            }
            this._updateDisplay();
            return true;
        });
    }

    _stopAnimation() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._scrollIndex = 0;
        this._updateDisplay();
    }

    _updateDisplay() {
        if (!this._originalText) {
            this._label.text = '';
            return;
        }

        if (this._originalText.length <= this._maxLength) {
            this._label.text = this._originalText;
            return;
        }

        if (this._isHovering) {
            const text = this._loopText.substring(this._scrollIndex, this._scrollIndex + this._maxLength);
            this._label.text = text + '...';
        } else {
            this._label.text = this._originalText.substring(0, this._maxLength) + '...';
        }
    }

    destroy() {
        this._stopAnimation();
        if (this._hoverActor) {
            if (this._enterId) this._hoverActor.disconnect(this._enterId);
            if (this._leaveId) this._hoverActor.disconnect(this._leaveId);
        }
    }
};

export default ScrollableLabel;
