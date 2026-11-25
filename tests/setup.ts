// JSDOM lacks browser dialog and scrolling APIs used by the shared frontend.
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
    if (typeof options === 'object') this.scrollTop = options.top ?? this.scrollTop;
    else if (typeof y === 'number') this.scrollTop = y;
  };
}
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
}
