import GLib from 'gi://GLib';
import Pango from 'gi://Pango';

export default class ScrollableLabel {
    constructor(label, hoverActor, maxLength = 17) {
        this._label = label;
        this._hoverActor = hoverActor;
        this._maxLength = maxLength;
        this._originalText = '';
        this._loopChars = [];
        this._loopThreshold = 0;
        this._timeoutId = null;
        this._scrollIndex = 0;
        this._isHovering = false;

        this._label.style = 'text-align: left; width: 15em;';
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._label.clutter_text.line_wrap = false;
        this._label.clutter_text.use_markup = false;

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
        const newText = text || '';
        if (this._originalText === newText) {
            return;
        }

        this._originalText = newText;
        
        const originalChars = [...this._originalText];
        
        if (originalChars.length <= this._maxLength) {
            this._stopAnimation();
            this._updateDisplay();
            return;
        }

        const separator = '   ';
        const separatorChars = [...separator];
        
        this._loopThreshold = originalChars.length + separatorChars.length;

        this._loopChars = [...originalChars, ...separatorChars, ...originalChars];

        const minLength = this._loopThreshold + this._maxLength;
        
        while (this._loopChars.length < minLength) {
            this._loopChars.push(...separatorChars, ...originalChars);
        }

        this._stopAnimation();
        this._updateDisplay();

        if (this._isHovering) {
            this._startAnimation();
        }
    }

    _startAnimation() {
        if ([...this._originalText].length <= this._maxLength) return;
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

        const originalChars = [...this._originalText];

        if (originalChars.length <= this._maxLength) {
            this._label.text = this._originalText;
            return;
        }

        if (this._isHovering) {
            const visibleChars = this._loopChars.slice(this._scrollIndex, this._scrollIndex + this._maxLength);
            this._label.text = visibleChars.join('') + '...';
        } else {
            const visibleChars = originalChars.slice(0, this._maxLength);
            this._label.text = visibleChars.join('') + '...';
        }
    }

    destroy() {
        this._stopAnimation();
        if (this._hoverActor) {
            if (this._enterId) this._hoverActor.disconnect(this._enterId);
            if (this._leaveId) this._hoverActor.disconnect(this._leaveId);
        }
    }
}
