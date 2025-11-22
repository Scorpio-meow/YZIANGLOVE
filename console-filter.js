(function () {
    var originalError = console.error;
    console.error = function () {
        var args = Array.prototype.slice.call(arguments);
        var msg = args.join(' ');
        if (/https?:\/\/[^\/]*cdninstagram\.com.*404/.test(msg)) return;
        if (/favicon\.ico.*404|404.*favicon\.ico/.test(msg)) return;
        originalError.apply(console, arguments);
    };
})();
