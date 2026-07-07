/**
 * MessageBox Component
 *
 * Displays a dialog box with dynamic text wrapping, rounded corners, and a tail indicator.
 * The component is fully self-contained and handles text layout, sizing, and rendering.
 *
 * Features:
 * - Dynamic width/height based on text content (max 25 chars/line)
 * - Rounded corners (4px radius)
 * - Tail indicator on the left side (fixed position)
 * - Text wrapping and newline support
 * - Screen boundary clamping (no overflow)
 */

var MessageBox = (function() {
    /**
     * Constructor
     * @param {Object} options Configuration object
     * @param {string} options.text The message text (supports \n for line breaks)
     * @param {number} options.tailX Fixed horizontal position of tail (left edge)
     * @param {number} options.tailY Fixed vertical position of tail
     * @param {number} options.bottomY Fixed bottom edge position (frame aligns to this)
     */
    function MessageBox(options) {
        this.text = options.text || '';
        this.tailX = options.tailX !== undefined ? options.tailX : 113;
        this.tailY = options.tailY !== undefined ? options.tailY : 82;
        this.bottomY = options.bottomY !== undefined ? options.bottomY : 86;

        // Component properties
        this.padding = 6;
        this.radius = 4;
        this.maxLineLength = 25;
        this.textRightPadding = 12;  // 12px padding from right edge of screen

        // Tail properties
        this.tailStripWidth = 10;
        this.tailStairHeight = 8;
        this.tailOffsetX = 1;
        this.stairOffsetX = 2;

        // Computed properties (updated in _update)
        this.lines = [];
        this.boxX = 0;
        this.boxY = 0;
        this.boxWidth = 0;
        this.boxHeight = 0;

        this._update();
    }

    /**
     * Update computed properties based on text
     * Called after text changes or when canvas dimensions change
     */
    MessageBox.prototype._update = function() {
        var maxContentWidth = HaxrCorp4090FlipCTL.textWidth('A'.repeat(this.maxLineLength));

        // Wrap text into lines
        this.lines = this._wrapText(this.text, maxContentWidth);

        // Calculate box dimensions
        var contentWidth = 0;
        for (var i = 0; i < this.lines.length; i++) {
            var lineWidth = HaxrCorp4090FlipCTL.textWidth(this.lines[i]);
            if (lineWidth > contentWidth) contentWidth = lineWidth;
        }

        var maxBoxWidth = maxContentWidth + this.padding * 2;
        this.boxWidth = Math.min(contentWidth + this.padding * 2, maxBoxWidth);
        this.boxHeight = this.lines.length * 12 + this.padding * 2;

        // Position box relative to tail
        var tailRightX = this.tailX + this.tailStripWidth;
        this.boxX = tailRightX;

        // Clamp to screen boundaries
        var frameRightPadding = 6;
        var canvasWidth = 256;
        var canvasHeight = 144;

        if (this.boxX < 0) {
            this.boxX = 0;
        }
        if (this.boxX + this.boxWidth > canvasWidth - frameRightPadding) {
            this.boxWidth = canvasWidth - frameRightPadding - this.boxX;
        }

        // Position vertically (bottom-aligned)
        this.boxY = this.bottomY - this.boxHeight;

        // Clamp to top boundary
        if (this.boxY < 0) {
            this.boxHeight = this.boxHeight + this.boxY;
            this.boxY = 0;
        }
        if (this.boxY + this.boxHeight > canvasHeight) {
            this.boxHeight = canvasHeight - this.boxY;
        }
    };

    /**
     * Render the component
     * @param {FlipCanvas} canvas The canvas to render to
     */
    MessageBox.prototype.render = function(canvas) {
        var ctx = canvas.ctx;

        // Draw rounded rectangle background
        ctx.fillStyle = '#fff';

        // Center column
        ctx.fillRect(this.boxX + this.radius, this.boxY, this.boxWidth - this.radius * 2, this.boxHeight);
        // Left strip
        ctx.fillRect(this.boxX, this.boxY + this.radius, this.radius, this.boxHeight - this.radius * 2);
        // Right strip
        ctx.fillRect(this.boxX + this.boxWidth - this.radius, this.boxY + this.radius, this.radius, this.boxHeight - this.radius * 2);

        // Corner fill pixels (radius = 4) - white
        // Top-left corner
        ctx.fillRect(this.boxX + 3, this.boxY, 1, 1);
        ctx.fillRect(this.boxX + 2, this.boxY + 1, 1, 1);
        ctx.fillRect(this.boxX + 3, this.boxY + 1, 1, 1);
        ctx.fillRect(this.boxX + 1, this.boxY + 2, 1, 1);
        ctx.fillRect(this.boxX + 2, this.boxY + 2, 1, 1);
        ctx.fillRect(this.boxX + 3, this.boxY + 2, 1, 1);
        ctx.fillRect(this.boxX, this.boxY + 3, 1, 1);
        ctx.fillRect(this.boxX + 1, this.boxY + 3, 1, 1);
        ctx.fillRect(this.boxX + 2, this.boxY + 3, 1, 1);
        ctx.fillRect(this.boxX + 3, this.boxY + 3, 1, 1);

        // Top-right corner
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 3, this.boxY + 1, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY + 1, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 2, this.boxY + 2, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 3, this.boxY + 2, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY + 2, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 1, this.boxY + 3, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 2, this.boxY + 3, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 3, this.boxY + 3, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY + 3, 1, 1);

        // Bottom-left corner
        ctx.fillRect(this.boxX + 3, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + 2, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + 1, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + 3, this.boxY + this.boxHeight - 3, 1, 1);
        ctx.fillRect(this.boxX + 2, this.boxY + this.boxHeight - 3, 1, 1);
        ctx.fillRect(this.boxX + 1, this.boxY + this.boxHeight - 3, 1, 1);
        ctx.fillRect(this.boxX + 3, this.boxY + this.boxHeight - 2, 1, 1);
        ctx.fillRect(this.boxX + 2, this.boxY + this.boxHeight - 2, 1, 1);
        ctx.fillRect(this.boxX + 3, this.boxY + this.boxHeight - 1, 1, 1);

        // Bottom-right corner
        ctx.fillRect(this.boxX + this.boxWidth - 1, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 2, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 3, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 1, this.boxY + this.boxHeight - 3, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 2, this.boxY + this.boxHeight - 3, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 3, this.boxY + this.boxHeight - 3, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY + this.boxHeight - 2, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 3, this.boxY + this.boxHeight - 2, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY + this.boxHeight - 1, 1, 1);

        // Draw black border
        ctx.fillStyle = '#000';
        // Top and bottom edges
        ctx.fillRect(this.boxX + this.radius, this.boxY, this.boxWidth - this.radius * 2, 1);
        ctx.fillRect(this.boxX + this.radius, this.boxY + this.boxHeight - 1, this.boxWidth - this.radius * 2, 1);
        // Left and right edges
        ctx.fillRect(this.boxX, this.boxY + this.radius, 1, this.boxHeight - this.radius * 2);
        ctx.fillRect(this.boxX + this.boxWidth - 1, this.boxY + this.radius, 1, this.boxHeight - this.radius * 2);

        // Corner border pixels
        // Top-left
        ctx.fillRect(this.boxX + 3, this.boxY, 1, 1);
        ctx.fillRect(this.boxX + 2, this.boxY + 1, 1, 1);
        ctx.fillRect(this.boxX + 1, this.boxY + 2, 1, 1);
        ctx.fillRect(this.boxX, this.boxY + 3, 1, 1);

        // Top-right
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 3, this.boxY + 1, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 2, this.boxY + 2, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 1, this.boxY + 3, 1, 1);

        // Bottom-left
        ctx.fillRect(this.boxX, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + 1, this.boxY + this.boxHeight - 3, 1, 1);
        ctx.fillRect(this.boxX + 2, this.boxY + this.boxHeight - 2, 1, 1);
        ctx.fillRect(this.boxX + 3, this.boxY + this.boxHeight - 1, 1, 1);

        // Bottom-right
        ctx.fillRect(this.boxX + this.boxWidth - 1, this.boxY + this.boxHeight - 4, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 2, this.boxY + this.boxHeight - 3, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 3, this.boxY + this.boxHeight - 2, 1, 1);
        ctx.fillRect(this.boxX + this.boxWidth - 4, this.boxY + this.boxHeight - 1, 1, 1);

        // Draw tail
        ctx.fillStyle = '#000';
        // Black tail strip
        ctx.fillRect(this.tailX + this.tailOffsetX, this.tailY, this.tailStripWidth, 1);

        // Black staircase above the strip
        for (var i = 0; i < this.tailStairHeight; i++) {
            ctx.fillRect(this.tailX + this.stairOffsetX + i, this.tailY - i - 1, 1, 1);
        }

        // White vertical line
        ctx.fillStyle = '#fff';
        ctx.fillRect(this.tailX + this.tailStripWidth + this.tailOffsetX - 1, this.tailY - 8, 1, 8);

        // Draw text
        var textX = this.boxX + this.padding;
        var textY = this.boxY + this.padding;
        for (var i = 0; i < this.lines.length; i++) {
            HaxrCorp4090FlipCTL.draw(ctx, this.lines[i], textX, textY + i * 12, '#000');
        }
    };

    /**
     * Text wrapping helper
     * Splits text by newlines and wraps long lines
     * @param {string} text The text to wrap
     * @param {number} maxWidth Maximum width in pixels
     * @return {Array} Array of wrapped lines
     */
    MessageBox.prototype._wrapText = function(text, maxWidth) {
        var paragraphs = text.split('\n');
        var lines = [];

        for (var p = 0; p < paragraphs.length; p++) {
            var words = paragraphs[p].split(' ');
            var currentLine = '';

            for (var i = 0; i < words.length; i++) {
                var word = words[i];
                var testLine = currentLine + (currentLine ? ' ' : '') + word;
                var width = HaxrCorp4090FlipCTL.textWidth(testLine);

                if (width <= maxWidth) {
                    currentLine = testLine;
                } else {
                    if (currentLine) lines.push(currentLine);
                    currentLine = word;
                }
            }

            if (currentLine) lines.push(currentLine);
        }

        return lines;
    };

    /**
     * Update text content
     * @param {string} newText The new text to display
     */
    MessageBox.prototype.setText = function(newText) {
        this.text = newText;
        this._update();
    };

    /**
     * Update tail position
     * @param {number} x Horizontal position (left edge)
     * @param {number} y Vertical position
     */
    MessageBox.prototype.setTailPosition = function(x, y) {
        this.tailX = x;
        this.tailY = y;
        this._update();
    };

    return MessageBox;
})();
