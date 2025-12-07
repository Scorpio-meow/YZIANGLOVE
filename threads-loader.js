(function () {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    var embedScriptLoaded = false;
    var embedScriptLoading = false;
    var allBlockquotes = [];
    var currentIndex = 0;
    var processing = false;
    var paused = false;
    var currentDelay = LOAD_DELAY;
    var rateLimitDetected = false;
    var consecutiveErrors = 0;
    var lastRequestTime = 0;
    var retryQueue = [];
    var retryQueueTimer = null;
    var loadedCount = 0;
    var pageSize = (typeof PAGE_SIZE !== 'undefined' ? PAGE_SIZE : 50);
    var currentPage = 1;
    var totalPages = 1;
    var pageInfoEl = null;
    function readUrlState() {
        try {
            var params = new URLSearchParams(window.location.search);
            var p = parseInt(params.get('page'), 10);
            var s = parseInt(params.get('page_size'), 10);
            if (Number.isFinite(p) && p > 0) currentPage = p;
            if (Number.isFinite(s) && s > 0) pageSize = s;
        } catch (e) { }
    }
    function updateUrlParams(push) {
        try {
            var u = new URL(window.location.href);
            u.searchParams.set('page', currentPage);
            u.searchParams.set('page_size', pageSize);
            if (push) window.history.pushState({}, '', u);
            else window.history.replaceState({}, '', u);
        } catch (e) { }
    }
    function withJitter(ms) {
        try {
            var jitter = Math.floor(Math.random() * Math.max(0, Math.round(ms * 0.25)));
            return ms + jitter;
        } catch (e) { return ms; }
    }
    var stats = {
        total: 0,
        loaded: 0,
        failed: 0,
        rateLimitHits: 0,
        startTime: Date.now(),
        loadTimes: []
    };
    var ALLOWED_THREADS_HOSTS = ['threads.com', 'www.threads.com'];
    function isHostAllowed(url, allowedHosts) {
        try {
            var parsed = new URL(url, window.location.href);
            var host = parsed.hostname.toLowerCase();
            for (var i = 0; i < allowedHosts.length; i++) {
                var allowed = allowedHosts[i].toLowerCase();
                if (host === allowed || host === '' + allowed || host.endsWith('.' + allowed)) {
                    return true;
                }
            }
        } catch (e) {
            return false;
        }
        return false;
    }
    function logStats() {
        if (stats.total === 0) return;
        var avgLoadTime = stats.loadTimes.length > 0 ?
            (stats.loadTimes.reduce(function (sum, t) { return sum + t; }, 0) / stats.loadTimes.length).toFixed(2) : '0';
        console.log('[統計] Threads 載入統計:', {
            總數: stats.total,
            已載入: stats.loaded,
            失敗: stats.failed,
            速率限制次數: stats.rateLimitHits,
            成功率: stats.total > 0 ? ((stats.loaded / stats.total) * 100).toFixed(1) + '%' : '0%',
            耗時: ((Date.now() - stats.startTime) / 1000).toFixed(1) + '秒',
            當前延遲: (currentDelay / 1000).toFixed(1) + '秒',
            平均載入時間: avgLoadTime + '秒'
        });
    }
    function handleRateLimit(source, overrideBackoffMs) {
        if (rateLimitDetected) return;
        rateLimitDetected = true;
        paused = true;
        processing = false;
        stats.rateLimitHits++;
        consecutiveErrors++;
        try {
            var activeIfames = document.querySelectorAll('.post-item.current-loading iframe');
            activeIfames.forEach(function (f) {
                try { f.remove(); } catch (e) { }
            });
            visibleQueue.forEach(function (bq) {
                try {
                    var iframes = (bq && bq.parentNode) ? bq.parentNode.querySelectorAll('iframe') : [];
                    iframes.forEach(function (f) { try { f.remove(); } catch (e) { } });
                } catch (e) { }
            });
        } catch (e) { }
        var backoffTime = typeof overrideBackoffMs === 'number' && overrideBackoffMs > 0 ?
            Math.min(overrideBackoffMs, 300000) :
            Math.min(RATE_LIMIT_BACKOFF * Math.pow(1.5, consecutiveErrors - 1), 300000);
        currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
        console.warn('[警告] 偵測到速率限制 (' + source + '),暫停載入 ' + (backoffTime / 1000) + ' 秒');
        showRateLimitBanner(backoffTime);
        console.warn('[警告] 調整延遲時間為 ' + (currentDelay / 1000) + ' 秒');
        setTimeout(function () {
            requestAnimationFrame(function () {
                rateLimitDetected = false;
                paused = false;
                if (consecutiveErrors > 3) {
                    currentDelay = MAX_DELAY;
                } else {
                    currentDelay = Math.max(LOAD_DELAY, currentDelay / 1.5);
                }
                console.log('[恢復] 速率限制解除,恢復載入,延遲: ' + (currentDelay / 1000) + ' 秒');
                hideRateLimitBanner();
            });
        }, backoffTime);
    }
    window.addEventListener('threads:rate-limit', function (e) {
        handleRateLimit('console');
    });
    window.addEventListener('error', function (e) {
        if (e.message && (e.message.includes('429') || e.message.includes('rate limit') || e.message.includes('Too Many Requests'))) {
            handleRateLimit('error-event');
        }
        if (e.target && e.target.tagName === 'SCRIPT' && e.target.src && isHostAllowed(e.target.src, ALLOWED_THREADS_HOSTS)) {
            handleRateLimit('script-error');
        }
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        if (e.reason && e.reason.message && (e.reason.message.includes('429') || e.reason.message.includes('rate limit'))) {
            handleRateLimit('promise-rejection');
        }
    });
    window.addEventListener('threads:xframe-block', function (e) {
        try {
            var msg = (e && e.detail && e.detail.message) ? e.detail.message : '';
            var matches = msg.match(/'(https?:\/\/[^']+)'/);
            var url = matches ? matches[1] : null;
            if (!url) return;
            var iframes = document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
                var f = iframes[i];
                try {
                    var src = f.getAttribute('src') || f.src || '';
                    if (src && src.indexOf(url) !== -1) {
                        var bq = f.closest('.post-item');
                        if (bq) {
                            var blockquote = bq.querySelector('blockquote.text-post-media');
                            if (blockquote) {
                                markBlockquoteFailed(blockquote, 'xframe-deny', true);
                            }
                        }
                    }
                } catch (err) { }
            }
        } catch (err) { }
    });
    (function () {
        var originalFetch = window.fetch;
        if (originalFetch) {
            window.fetch = function (url, options) {
                return originalFetch.apply(this, arguments)
                    .then(function (response) {
                        if (response.status === 429) {
                            var ra = 0;
                            try {
                                var raf = response.headers.get('retry-after');
                                if (raf) {
                                    var rafInt = parseInt(raf, 10);
                                    if (!isNaN(rafInt)) ra = rafInt * 1000;
                                }
                            } catch (e) { }
                            handleRateLimit('fetch-response', ra || undefined);
                            throw new Error('Rate limited (429)');
                        }
                        if (response.ok) {
                            consecutiveErrors = Math.max(0, consecutiveErrors - 1);
                        }
                        return response;
                    })
                    .catch(function (error) {
                        if (error.message && (error.message.includes('429') || error.message.includes('rate limit'))) {
                            handleRateLimit('fetch-error');
                        }
                        throw error;
                    });
            };
        }
        var originalXHROpen = XMLHttpRequest.prototype.open;
        var originalXHRSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._url = url;
            return originalXHROpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            var xhr = this;
            xhr.addEventListener('load', function () {
                if (xhr.status === 429) {
                    var ra = 0;
                    try { var raf = xhr.getResponseHeader('Retry-After'); if (raf) { var rafInt = parseInt(raf, 10); if (!isNaN(rafInt)) ra = rafInt * 1000; } } catch (e) { }
                    handleRateLimit('xhr-response', ra || undefined);
                }
            });
            xhr.addEventListener('error', function () {
                if (xhr._url && isHostAllowed(xhr._url, ALLOWED_THREADS_HOSTS)) {
                    handleRateLimit('xhr-error');
                }
            });
            return originalXHRSend.apply(this, arguments);
        };
    })();
    function loadEmbedScript(callback) {
        if (embedScriptLoaded) {
            if (callback) callback();
            return;
        }
        if (embedScriptLoading) {
            var checkInterval = setInterval(function () {
                if (embedScriptLoaded) {
                    clearInterval(checkInterval);
                    if (callback) callback();
                }
            }, 100);
            return;
        }
        if (window.threadsEmbed && typeof window.threadsEmbed.process === 'function') {
            embedScriptLoaded = true;
            console.log('[資訊] Threads embed script 已存在(快取)');
            if (callback) callback();
            return;
        }
        embedScriptLoading = true;
        var retryCount = 0;
        function attemptLoad() {
            var script = document.createElement('script');
            script.async = true;
            script.src = 'https://www.threads.com/embed.js';
            script.onerror = function () {
                retryCount++;
                if (retryCount < MAX_RETRIES) {
                    console.warn('[警告] Threads embed script 載入失敗,重試中... (' + retryCount + '/' + MAX_RETRIES + ')');
                    setTimeout(function () {
                        if (script.parentNode) {
                            script.parentNode.removeChild(script);
                        }
                        attemptLoad();
                    }, Math.pow(2, retryCount) * 1000);
                } else {
                    console.error('[錯誤] Threads embed script 載入失敗,已達最大重試次數');
                    embedScriptLoading = false;
                    stats.failed++;
                }
            };
            script.onload = function () {
                embedScriptLoaded = true;
                embedScriptLoading = false;
                console.log('[成功] Threads embed script 載入成功');
                if (callback) callback();
            };
            document.body.appendChild(script);
        }
        attemptLoad();
    }
    function addLoadingIndicator(blockquote) {
        return null;
    }
    function removeLoadingIndicator(indicator) {
    }
    function markBlockquoteFailed(blockquote, reason, hide) {
        try {
            blockquote.dataset.embedLoading = 'false';
            blockquote.dataset.embedLoaded = 'false';
            blockquote.dataset.embedFailed = reason || 'failed';
            blockquote.dataset.retryQueued = 'false';
            blockquote.dataset.inQueue = 'false';
            stats.failed++;
            consecutiveErrors++;
            console.warn('[標記] 貼文標記為失敗: ' + reason);
            var postItem = blockquote.closest('.post-item');
            if (postItem) {
                requestAnimationFrame(function () {
                    if (postItem) {
                        postItem.classList.add('error');
                        if (hide) postItem.style.display = 'none';
                    }
                });
            }
        } catch (e) { }
    }

    var rateLimitBannerInterval = null;
    function showRateLimitBanner(backoffTime) {
        try {
            var container = document.getElementById('posts-container');
            if (!container) return;
            var banner = document.getElementById('threads-rate-limit-warning');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'threads-rate-limit-warning';
                banner.className = 'threads-rate-limit';
                banner.style.margin = '8px 0';
                container.insertBefore(banner, container.firstChild);
            }
            var end = Date.now() + (backoffTime || RATE_LIMIT_BACKOFF);
            function updateBanner() {
                var remain = Math.max(0, Math.round((end - Date.now()) / 1000));
                banner.textContent = '已偵測到速率限制，暫時停止載入貼文 — 恢復剩餘: ' + remain + ' 秒';
                if (remain <= 0) {
                    clearInterval(rateLimitBannerInterval);
                    rateLimitBannerInterval = null;
                }
            }
            updateBanner();
            if (rateLimitBannerInterval) clearInterval(rateLimitBannerInterval);
            rateLimitBannerInterval = setInterval(updateBanner, 1000);
        } catch (e) { }
    }
    function hideRateLimitBanner() {
        try {
            if (rateLimitBannerInterval) { clearInterval(rateLimitBannerInterval); rateLimitBannerInterval = null; }
            var banner = document.getElementById('threads-rate-limit-warning');
            if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
        } catch (e) { }
    }
    function incrementRetry(blockquote) {
        try {
            var r = parseInt(blockquote.dataset.retryCount || '0', 10) + 1;
            blockquote.dataset.retryCount = '' + r;
            return r;
        } catch (e) { return 1; }
    }
    function enqueueRetry(blockquote, backoffMs) {
        try {
            if (!blockquote || blockquote.dataset.embedFailed) return;
            if (blockquote.dataset.retryQueued === 'true') return;
            var retryAt = Date.now() + (backoffMs || currentDelay);
            retryQueue.push({ bq: blockquote, retryAt: retryAt });
            console.log('[Retry] 已加入重試佇列 (' + retryQueue.length + '), 預計於 ' + new Date(retryAt).toLocaleTimeString() + ' 重試');
            blockquote.dataset.retryQueued = 'true';
            if (!retryQueueTimer) {
                retryQueueTimer = setInterval(processRetryQueue, 1000);
            }
        } catch (e) { }
    }
    function processRetryQueue() {
        try {
            if (processing || paused || rateLimitDetected) return;
            var now = Date.now();
            for (var i = retryQueue.length - 1; i >= 0; i--) {
                var item = retryQueue[i];
                if (!item || !item.bq) { retryQueue.splice(i, 1); continue; }
                if (item.retryAt <= now) {
                    var bq = item.bq;
                    bq.dataset.retryQueued = 'false';
                    if (bq.dataset.embedFailed || bq.dataset.embedLoading === 'true') {
                        retryQueue.splice(i, 1);
                        continue;
                    }
                    retryQueue.splice(i, 1);
                    console.log('[Retry] 正在重試載入 (佇列剩餘: ' + retryQueue.length + ')');
                    processBlockquoteRetry(bq);
                    break;
                }
            }
            if (retryQueue.length === 0 && retryQueueTimer) {
                clearInterval(retryQueueTimer);
                retryQueueTimer = null;
            }
        } catch (e) { }
    }
    function processBlockquoteRetry(blockquote) {
        if (!blockquote || processing || paused || rateLimitDetected) return;
        processing = true;
        lastRequestTime = Date.now();
        var indicator = addLoadingIndicator(blockquote);
        stats.total++;
        var itemStartTime = Date.now();
        var processStart = performance.now();
        var retryCount = parseInt(blockquote.dataset.retryCount || '0', 10);
        console.log('[重試載入] 重試中 (第 ' + retryCount + '/' + MAX_RETRIES + ' 次)');
        blockquote.dataset.embedLoading = 'true';
        var container = document.getElementById('posts-container');
        var postItem = blockquote.closest('.post-item');
        requestAnimationFrame(function () {
            if (container) container.classList.add('is-loading');
            if (postItem) postItem.classList.add('current-loading');
        });
        scheduleIdle(function () {
            try {
                if (window.threadsEmbed && typeof window.threadsEmbed.process === 'function') {
                    window.threadsEmbed.process();
                }
            } catch (e) {
                console.warn('[Embed] process() failed:', e);
            }
        });
        function restoreState() {
            requestAnimationFrame(function () {
                if (container) container.classList.remove('is-loading');
                if (postItem) postItem.classList.remove('current-loading');
            });
        }
        waitForIframeLoad(blockquote, IFRAME_TIMEOUT)
            .then(function (success) {
                var loadTime = (Date.now() - itemStartTime) / 1000;
                stats.loadTimes.push(loadTime);
                blockquote.dataset.embedLoading = 'false';
                blockquote.dataset.embedLoaded = 'true';
                blockquote.dataset.inQueue = 'false';
                restoreState();
                if (success) {
                    stats.loaded++;
                    loadedCount++;
                    consecutiveErrors = Math.max(0, consecutiveErrors - 1);
                    if (consecutiveErrors === 0 && currentDelay > LOAD_DELAY) {
                        currentDelay = Math.max(LOAD_DELAY, currentDelay / 1.2);
                    }
                    console.log('[重試成功] 重試載入成功 (耗時: ' + loadTime.toFixed(2) + '秒)');
                } else {
                    stats.failed++;
                    var retry = incrementRetry(blockquote);
                    if (retry >= MAX_RETRIES) {
                        markBlockquoteFailed(blockquote, 'max-retries', true);
                    } else {
                        console.log('[重試失敗] 將再次重試 (重試次數: ' + retry + '/' + MAX_RETRIES + ')');
                        blockquote.dataset.embedLoading = 'false';
                        blockquote.dataset.embedLoaded = 'false';
                        blockquote.dataset.inQueue = 'false';
                        enqueueRetry(blockquote, withJitter(currentDelay));
                    }
                }
                removeLoadingIndicator(indicator);
                processing = false;
                if (currentIndex < allBlockquotes.length) {
                    setTimeout(withJitter(currentDelay));
                } else if (retryQueue.length > 0) {
                    setTimeout(processRetryQueue, 1000);
                } else {
                    logStats();
                }
            })
            .catch(function (error) {
                console.error('[重試錯誤] 處理錯誤:', error);
                blockquote.dataset.embedLoading = 'false';
                stats.failed++;
                restoreState();
                markBlockquoteFailed(blockquote, 'error', true);
                removeLoadingIndicator(indicator);
                processing = false;
                if (currentIndex < allBlockquotes.length) {
                    setTimeout(withJitter(currentDelay));
                } else if (retryQueue.length > 0) {
                    setTimeout(processRetryQueue, 1000);
                } else {
                    logStats();
                }
            });
    }
    function scheduleIdle(fn) {
        if (window.requestIdleCallback) {
            requestIdleCallback(fn, { timeout: 50 });
        } else if (window.requestAnimationFrame) {
            requestAnimationFrame(fn);
        } else {
            setTimeout(fn, 16);
        }
    }
    function triggerRelayouts() { }
    function waitForIframeLoad(blockquote, timeout) {
        return new Promise(function (resolve) {
            var timeoutId, observer, earlyTimeoutId;
            var resolved = false;
            function cleanup() {
                if (timeoutId) clearTimeout(timeoutId);
                if (earlyTimeoutId) clearTimeout(earlyTimeoutId);
                if (observer) observer.disconnect();
            }
            function done(success) {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(success);
            }
            timeoutId = setTimeout(function () {
                done(false);
            }, timeout || IFRAME_TIMEOUT);
            try {
                var minTout = (typeof MIN_IFRAME_TIMEOUT !== 'undefined') ? MIN_IFRAME_TIMEOUT : Math.min(10000, (timeout || IFRAME_TIMEOUT));
                earlyTimeoutId = setTimeout(function () {
                    try {
                        var parentNode = blockquote.parentNode;
                        if (!parentNode) { return; }
                        if (parentNode.querySelector('iframe')) return;
                        if (rateLimitDetected || !document.body.contains(blockquote) || blockquote.dataset.embedFailed || blockquote.dataset.retryQueued === 'true') {
                            console.warn('[早退] 早期超時或其他條件觸發，暫時放棄等待 iframe (尚未標記為失敗)');
                        } else {
                            console.warn('[早期警告] 尚未發現 iframe，繼續等待直到主超時 (' + (timeout || IFRAME_TIMEOUT) + 'ms)');
                        }
                    } catch (e) { }
                }, minTout);
            } catch (e) { }
            if (!('MutationObserver' in window)) {
                setTimeout(function () { done(true); }, 2000);
                return;
            }
            var parentNode = blockquote.parentNode;
            if (!parentNode) {
                done(false);
                return;
            }
            try {
                if (blockquote.dataset.embedFailed || blockquote.dataset.retryQueued === 'true' || !document.body.contains(blockquote) || rateLimitDetected) {
                    done(false);
                    return;
                }
            } catch (e) { }
            observer = new MutationObserver(function (mutations) {
                var blockquoteRemoved = false;
                for (var i = 0; i < mutations.length; i++) {
                    var mutation = mutations[i];
                    if (mutation.removedNodes && mutation.removedNodes.length) {
                        for (var r = 0; r < mutation.removedNodes.length; r++) {
                            var rn = mutation.removedNodes[r];
                            if (rn === blockquote || (rn && rn.contains && rn.contains(blockquote))) {
                                blockquoteRemoved = true;
                            }
                        }
                    }
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        var node = mutation.addedNodes[j];
                        function checkNodeForIframes(n) {
                            try {
                                if (!n) return;
                                if (n.tagName === 'IFRAME') {
                                    node = n;
                                } else if (n.querySelector) {
                                    var nested = n.querySelectorAll('iframe');
                                    if (nested && nested.length) {
                                        node = nested[0];
                                    }
                                }
                            } catch (e) { }
                        }
                        checkNodeForIframes(node);
                        if (node.tagName === 'IFRAME') {
                            console.log('[observer] 偵測到新增 IFRAME，視為 embed 目標');
                            (function (iframeNode) {
                                var handled = false;
                                function markDone(success, reason) {
                                    if (handled) return;
                                    handled = true;
                                    if (!success) {
                                        markBlockquoteFailed(blockquote, reason || 'iframe-error', true);
                                    }
                                    done(success);
                                }
                                iframeNode.addEventListener('error', function () {
                                    console.warn('[iframe] load error: src=' + (iframeNode.src || iframeNode.getAttribute('src')));
                                    try {
                                        var src = iframeNode.getAttribute('src') || iframeNode.src || '';
                                        if (isHostAllowed(src, ALLOWED_THREADS_HOSTS)) {
                                            handleRateLimit('iframe-error');
                                        }
                                    } catch (e) { }
                                    markDone(false, 'iframe-error');
                                }, { once: true });
                                iframeNode.addEventListener('load', function () {
                                    var src = iframeNode.getAttribute('src') || iframeNode.src || '';
                                    if (/chrome-error:|chromewebdata/i.test(src)) {
                                        console.warn('[iframe] chrome error page detected, likely blocked by X-Frame-Options or similar: ' + src);
                                        markDone(false, 'xframe-deny');
                                        return;
                                    }
                                    try {
                                        if (iframeNode.contentWindow && iframeNode.contentWindow.location && iframeNode.contentWindow.location.href) {
                                            var href = '';
                                            try { href = iframeNode.contentWindow.location.href || ''; } catch (e) { }
                                            if (/chrome-error:|chromewebdata/i.test(href)) {
                                                markDone(false, 'xframe-deny');
                                                return;
                                            }
                                        }
                                    } catch (e) {
                                    }
                                    markDone(true);
                                }, { once: true });
                                requestAnimationFrame(function () {
                                    try {
                                        var src2 = iframeNode.getAttribute('src') || iframeNode.src || '';
                                        if (/chrome-error:|chromewebdata/i.test(src2)) {
                                            markDone(false, 'xframe-deny');
                                            return;
                                        }
                                    } catch (e) { }
                                }, 250);
                            })(node);
                        }
                    }
                }
                if (blockquoteRemoved) {
                    setTimeout(function () {
                        try {
                            var parentNode = blockquote.parentNode || document.querySelector('[data-posts-container]') || document.body;
                            if (parentNode) {
                                var found = parentNode.querySelector('iframe');
                                if (found) {
                                    console.log('[observer] 在 blockquote 移除後找到 iframe，視為替換成功');
                                    var src = found.getAttribute('src') || found.src || '';
                                    if (/chrome-error:|chromewebdata/i.test(src)) {
                                        markBlockquoteFailed(blockquote, 'xframe-deny', true);
                                        done(false);
                                        return;
                                    }
                                    var handled = false;
                                    function markDone(success, reason) {
                                        if (handled) return;
                                        handled = true;
                                        if (!success) markBlockquoteFailed(blockquote, reason || 'iframe-error', true);
                                        done(success);
                                    }
                                    found.addEventListener('error', function () {
                                        console.warn('[iframe] load error: src=' + (found.src || found.getAttribute('src')));
                                        try { if (isHostAllowed(found.getAttribute('src') || found.src || '', ALLOWED_THREADS_HOSTS)) handleRateLimit('iframe-error'); } catch (e) { }
                                        markDone(false, 'iframe-error');
                                    }, { once: true });
                                    found.addEventListener('load', function () { markDone(true); }, { once: true });
                                }
                            }
                        } catch (e) { }
                    }, 200);
                }
            });
            observer.observe(parentNode, {
                childList: true,
                subtree: true
            });
            var existingIframe = parentNode.querySelector('iframe');
            if (existingIframe) {
                try {
                    var src = existingIframe.getAttribute('src') || existingIframe.src || '';
                    if (/chrome-error:|chromewebdata/i.test(src)) {
                        markBlockquoteFailed(blockquote, 'xframe-deny', true);
                        done(false);
                    } else {
                        done(true);
                    }
                } catch (e) {
                    done(true);
                }
            }
        });
    }
    function init() {
        var container = document.getElementById('posts-container');
        if (!container) return;
        try {
            if (!Array.isArray(posts)) return;
        } catch (e) { return; }
        var CHUNK_APPEND_SIZE = 20;
        readUrlState();
        function appendPostsInChunks(postsToAppend, done) {
            if (typeof postsToAppend === 'function') { done = postsToAppend; postsToAppend = posts; }
            if (!postsToAppend || postsToAppend.length === 0) return done();
            if (postsToAppend.length <= CHUNK_APPEND_SIZE) {
                var frag = document.createDocumentFragment();
                for (var i = 0; i < postsToAppend.length; i++) {
                    var item = document.createElement('div');
                    item.className = 'post-item';
                    item.innerHTML = postsToAppend[i];
                    frag.appendChild(item);
                }
                container.appendChild(frag);
                return done();
            }
            var idx = 0;
            function loop() {
                var start = performance.now();
                var frag = document.createDocumentFragment();
                var end = Math.min(idx + CHUNK_APPEND_SIZE, postsToAppend.length);
                for (; idx < end; idx++) {
                    var item = document.createElement('div');
                    item.className = 'post-item';
                    item.innerHTML = postsToAppend[idx];
                    frag.appendChild(item);
                }
                container.appendChild(frag);
                var elapsed = performance.now() - start;
                if (idx < postsToAppend.length) {
                    if (elapsed > 30) {
                        scheduleIdle(loop);
                    } else {
                        setTimeout(loop, 0);
                    }
                } else {
                    done();
                }
            }
            loop();
        }
        totalPages = Math.max(1, Math.ceil(posts.length / pageSize));
        function getPagePosts(page) {
            var p = Math.max(1, Math.min(totalPages, page));
            var start = (p - 1) * pageSize;
            var end = Math.min(start + pageSize, posts.length);
            return posts.slice(start, end);
        }
        function parseIntSafe(v, fallback) {
            var n = parseInt(v, 10);
            return (Number.isFinite(n) && n > 0) ? n : fallback;
        }
        function clearPageState() {
            processing = false;
            paused = false;
            rateLimitDetected = false;
            consecutiveErrors = 0;
            lastRequestTime = 0;
            retryQueue = [];
            if (retryQueueTimer) { clearInterval(retryQueueTimer); retryQueueTimer = null; }
            loadedCount = 0;
            stats = { total: 0, loaded: 0, failed: 0, rateLimitHits: 0, startTime: Date.now(), loadTimes: [] };
            try { hideRateLimitBanner(); } catch (e) { }
        }
        function updatePaginationControls() {
            var paginationEls = document.querySelectorAll('.pagination');
            if (!paginationEls || paginationEls.length === 0) return;
            paginationEls.forEach(function (el) { el.innerHTML = ''; });
            function navigateTo(pageNum, size) {
                try {
                    var u = new URL(window.location.href);
                    u.searchParams.set('page', pageNum);
                    u.searchParams.set('page_size', typeof size !== 'undefined' ? size : pageSize);
                    window.location.href = u.toString();
                } catch (e) {
                    window.location.search = '?page=' + pageNum + '&page_size=' + (typeof size !== 'undefined' ? size : pageSize);
                }
            }
            function addBtnTo(parentEl, label, page, disabled, active) {
                var btn = document.createElement('button');
                btn.className = 'page-btn' + (active ? ' active' : '');
                if (disabled) btn.setAttribute('disabled', 'disabled');
                btn.textContent = label;
                if (!disabled) {
                    btn.addEventListener('click', function () {
                        if (page === currentPage) return;
                        navigateTo(page, pageSize);
                    });
                }
                parentEl.appendChild(btn);
            }
            paginationEls.forEach(function (paginationEl) {
                addBtnTo(paginationEl, 'Prev', Math.max(1, currentPage - 1), currentPage <= 1, false);
            });
            var maxButtons = 9;
            if (totalPages <= maxButtons) {
                for (var i = 1; i <= totalPages; i++) {
                    paginationEls.forEach(function (paginationEl) { addBtnTo(paginationEl, String(i), i, false, i === currentPage); });
                }
            } else {
                paginationEls.forEach(function (paginationEl) { addBtnTo(paginationEl, '1', 1, false, 1 === currentPage); });
                var left = Math.max(2, currentPage - 2);
                var right = Math.min(totalPages - 1, currentPage + 2);
                paginationEls.forEach(function (paginationEl) { if (left > 2) { var ell = document.createElement('span'); ell.className = 'ellipsis'; ell.textContent = '...'; paginationEl.appendChild(ell); } });
                for (var p = left; p <= right; p++) {
                    paginationEls.forEach(function (paginationEl) { addBtnTo(paginationEl, String(p), p, false, p === currentPage); });
                }
                paginationEls.forEach(function (paginationEl) { if (right < totalPages - 1) { var ell2 = document.createElement('span'); ell2.className = 'ellipsis'; ell2.textContent = '...'; paginationEl.appendChild(ell2); } });
                paginationEls.forEach(function (paginationEl) { addBtnTo(paginationEl, String(totalPages), totalPages, false, totalPages === currentPage); });
            }
            paginationEls.forEach(function (paginationEl) { addBtnTo(paginationEl, 'Next', Math.min(totalPages, currentPage + 1), currentPage >= totalPages, false); });
            try {
                var pageInfoEls = document.querySelectorAll('.page-info');
                if (pageInfoEls && pageInfoEls.length > 0) {
                    pageInfoEls.forEach(function (pi) { pi.textContent = '第 ' + currentPage + ' / ' + totalPages + ' 頁'; });
                }
            } catch (e) { }
        }
        function renderPage(page, opts) {
            opts = opts || {};
            var push = true;
            if (typeof opts.push !== 'undefined') push = !!opts.push;
            try { page = Math.max(1, Math.min(totalPages, page)); } catch (e) { page = 1; }
            if (page === currentPage && container.querySelectorAll('.post-item').length > 0) return;
            currentPage = page;
            clearPageState();
            container.innerHTML = '';
            if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
            appendPostsInChunks(getPagePosts(currentPage), function () {
                requestAnimationFrame(function () {
                    var blockquotes = container.querySelectorAll('blockquote.text-post-media');
                    allBlockquotes = Array.prototype.slice.call(blockquotes);
                    try { loadedCount = container.querySelectorAll('blockquote[data-embed-loaded="true"]').length || 0; } catch (e) { loadedCount = 0; }
                    totalPages = Math.max(1, Math.ceil(posts.length / pageSize));
                    currentIndex = 0;
                    updatePaginationControls();
                    try { updateUrlParams(push); } catch (e) { }
                    if (allBlockquotes.length > 0) {
                        loadEmbedScript(function () {
                            try { currentIndex = 0; } catch (e) { }
                        });
                    }
                });
            });
        }
        updatePaginationControls();
        renderPage(currentPage, { push: false });
        window.addEventListener('popstate', function () {
            try {
                readUrlState();
                totalPages = Math.max(1, Math.ceil(posts.length / pageSize));
                currentPage = Math.max(1, Math.min(totalPages, currentPage));
                renderPage(currentPage, { push: false });
            } catch (e) { }
        });
    }
})();