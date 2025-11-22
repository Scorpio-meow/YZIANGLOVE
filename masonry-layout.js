(function () {
    var GAP = 12;
    var raf = window.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); };
    var resizeObserver = null;
    function getColumnConfig() {
        var w = window.innerWidth;
        if (w < 576) return { columns: 1, minWidth: 280 };
        if (w < 900) return { columns: 1, minWidth: 320 };
        return { columns: 2, minWidth: 400 };
    }
    function getNumber(value) { var n = parseFloat(value); return isNaN(n) ? 0 : n; }
    function layoutMasonry() {
        var container = document.getElementById('posts-container');
        if (!container) return;
        var items = Array.prototype.slice.call(container.getElementsByClassName('post-item'));
        if (!items.length) return;
        var cs = getComputedStyle(container);
        var padL = getNumber(cs.paddingLeft), padR = getNumber(cs.paddingRight);
        var padT = getNumber(cs.paddingTop), padB = getNumber(cs.paddingBottom);
        var innerW = container.clientWidth - padL - padR;
        if (innerW <= 0) return;
        var config = getColumnConfig();
        var cols = Math.min(config.columns, Math.max(1, Math.floor((innerW + GAP) / (config.minWidth + GAP))));
        var colW = (innerW - GAP * (cols - 1)) / cols;
        var colHeights = new Array(cols);
        for (var i = 0; i < cols; i++) colHeights[i] = 0;
        for (var j = 0; j < items.length; j++) {
            var item = items[j];
            item.style.width = colW + 'px';
            var minIdx = 0;
            for (var c = 1; c < cols; c++) {
                if (colHeights[c] < colHeights[minIdx]) minIdx = c;
            }
            var left = padL + (colW + GAP) * minIdx;
            var top = padT + colHeights[minIdx];
            item.style.transform = 'translate(' + left + 'px,' + top + 'px)';
            item.style.left = '0';
            item.style.top = '0';

            var itemHeight = item.offsetHeight;
            colHeights[minIdx] += itemHeight + GAP;
        }
        var maxH = 0;
        for (var k = 0; k < cols; k++) maxH = Math.max(maxH, colHeights[k]);
        container.style.height = (padT + maxH + padB) + 'px';

        if (window.ResizeObserver && !resizeObserver) {
            resizeObserver = new ResizeObserver(function () {
                relayout();
            });
            for (var m = 0; m < items.length; m++) {
                resizeObserver.observe(items[m]);
            }
        }
    }
    var pending = false;
    var resizeTimer;
    function relayout() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (pending) return;
            pending = true;
            raf(function () { pending = false; layoutMasonry(); });
        }, 100);
    }
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    window.addEventListener('load', relayout);
    window.addEventListener('masonry:render-ready', relayout);
    window.addEventListener('load', function () { setTimeout(relayout, 200); setTimeout(relayout, 600); setTimeout(relayout, 1200); setTimeout(relayout, 2000); });
})();
