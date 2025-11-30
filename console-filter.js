(function () {
    var originalError = console.error;
    var originalWarn = console.warn;
    console.error = function () {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.join(' ');
        if (/https?:\/\/[^\/]*cdninstagram\.com.*404/.test(msg)) return;
        if (/favicon\.ico.*404|404.*favicon\.ico/.test(msg)) return;
        if (/429|rate.?limit|too.?many.?requests/i.test(msg)) {
            window.dispatchEvent(new CustomEvent('threads:rate-limit', { detail: { message: msg } }));
            return;
        }
        if (/Failed to load resource.*threads\.com/i.test(msg)) return;
        if (/Refused to display .* in a frame because it set 'X-Frame-Options' to 'deny'/i.test(msg)) {
            window.dispatchEvent(new CustomEvent('threads:xframe-block', { detail: { message: msg } }));
            return;
        }
        originalError.apply(console, arguments);
    };
    console.warn = function () {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.join(' ');
        if (/429|rate.?limit|too.?many.?requests/i.test(msg)) {
            window.dispatchEvent(new CustomEvent('threads:rate-limit', { detail: { message: msg } }));
            return;
        }
        originalWarn.apply(console, arguments);
    };
})();