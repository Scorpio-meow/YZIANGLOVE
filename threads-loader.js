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
    var stats = {
        total: 0,
        loaded: 0,
        failed: 0,
        rateLimitHits: 0,
        startTime: Date.now(),
        loadTimes: []
    };
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
    function handleRateLimit(source) {
        if (rateLimitDetected) return;
        rateLimitDetected = true;
        paused = true;
        processing = false;
        stats.rateLimitHits++;
        consecutiveErrors++;
        var backoffTime = Math.min(RATE_LIMIT_BACKOFF * Math.pow(1.5, consecutiveErrors - 1), 300000);
        currentDelay = Math.min(currentDelay * 2, MAX_DELAY);
        console.warn('[警告] 偵測到速率限制 (' + source + '),暫停載入 ' + (backoffTime / 1000) + ' 秒');
        console.warn('[警告] 調整延遲時間為 ' + (currentDelay / 1000) + ' 秒');
        setTimeout(function () {
            rateLimitDetected = false;
            paused = false;
            if (consecutiveErrors > 3) {
                currentDelay = MAX_DELAY;
            } else {
                currentDelay = Math.max(LOAD_DELAY, currentDelay / 1.5);
            }
            console.log('[恢復] 速率限制解除,恢復載入,延遲: ' + (currentDelay / 1000) + ' 秒');
            processSingleEmbed();
        }, backoffTime);
    }
    window.addEventListener('threads:rate-limit', function (e) {
        handleRateLimit('console');
    });
    window.addEventListener('error', function (e) {
        if (e.message && (e.message.includes('429') || e.message.includes('rate limit') || e.message.includes('Too Many Requests'))) {
            handleRateLimit('error-event');
        }
        if (e.target && e.target.tagName === 'SCRIPT' && e.target.src && e.target.src.includes('threads.com')) {
            handleRateLimit('script-error');
        }
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        if (e.reason && e.reason.message && (e.reason.message.includes('429') || e.reason.message.includes('rate limit'))) {
            handleRateLimit('promise-rejection');
        }
    });
    (function () {
        var originalFetch = window.fetch;
        if (originalFetch) {
            window.fetch = function (url, options) {
                return originalFetch.apply(this, arguments)
                    .then(function (response) {
                        if (response.status === 429) {
                            handleRateLimit('fetch-response');
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
                    handleRateLimit('xhr-response');
                }
            });
            xhr.addEventListener('error', function () {
                if (xhr._url && xhr._url.includes('threads.com')) {
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
            script.src = 'https://www.threads.net/embed.js';
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
        var indicator = document.createElement('div');
        indicator.className = 'threads-loading';
        indicator.textContent = '載入 Threads 貼文中...';
        var parent = blockquote.parentNode;
        if (parent) {
            parent.insertBefore(indicator, blockquote);
        }
        return indicator;
    }
    function removeLoadingIndicator(indicator) {
        if (indicator && indicator.parentNode) {
            indicator.parentNode.removeChild(indicator);
        }
    }
    function triggerRelayouts() {
        window.dispatchEvent(new Event('masonry:render-ready'));
        setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 100);
        setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 300);
        setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 600);
        setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 1000);
    }
    function waitForIframeLoad(blockquote, timeout) {
        return new Promise(function (resolve) {
            var timeoutId, observer;
            var resolved = false;
            function cleanup() {
                if (timeoutId) clearTimeout(timeoutId);
                if (observer) observer.disconnect();
            }
            function done(success) {
                if (resolved) return;
                resolved = true;
                cleanup();
                triggerRelayouts();
                resolve(success);
            }
            timeoutId = setTimeout(function () {
                done(false);
            }, timeout || IFRAME_TIMEOUT);
            if (!('MutationObserver' in window)) {
                setTimeout(function () { done(true); }, 2000);
                return;
            }
            var parentNode = blockquote.parentNode;
            if (!parentNode) {
                done(false);
                return;
            }
            observer = new MutationObserver(function (mutations) {
                for (var i = 0; i < mutations.length; i++) {
                    var mutation = mutations[i];
                    for (var j = 0; j < mutation.addedNodes.length; j++) {
                        var node = mutation.addedNodes[j];
                        if (node.tagName === 'IFRAME') {
                            node.addEventListener('load', function () {
                                done(true);
                            }, { once: true });

                            if (node.contentWindow) {
                                try {
                                    if (node.contentWindow.document.readyState === 'complete') {
                                        done(true);
                                    }
                                } catch (e) {
                                    setTimeout(function () { done(true); }, 500);
                                }
                            }
                        }
                    }
                }
            });
            observer.observe(parentNode, {
                childList: true,
                subtree: true
            });
            var existingIframe = parentNode.querySelector('iframe');
            if (existingIframe) {
                done(true);
            }
        });
    }
    function processSingleEmbed() {
        if (processing || paused || rateLimitDetected) {
            return;
        }
        if (currentIndex >= allBlockquotes.length) {
            if (stats.total > 0) {
                logStats();
            }
            return;
        }
        var now = Date.now();
        var timeSinceLastRequest = now - lastRequestTime;
        var minDelay = typeof MIN_DELAY_BETWEEN_REQUESTS !== 'undefined' ? MIN_DELAY_BETWEEN_REQUESTS : 2000;
        if (lastRequestTime > 0 && timeSinceLastRequest < minDelay) {
            setTimeout(processSingleEmbed, minDelay - timeSinceLastRequest);
            return;
        }
        var blockquote = allBlockquotes[currentIndex];
        if (blockquote.dataset.embedLoaded === 'true') {
            currentIndex++;
            processSingleEmbed();
            return;
        }
        processing = true;
        lastRequestTime = Date.now();
        var indicator = addLoadingIndicator(blockquote);
        stats.total++;
        var itemStartTime = Date.now();
        console.log('[載入] 載入中 (' + (currentIndex + 1) + '/' + allBlockquotes.length + ') - 延遲: ' + (currentDelay / 1000) + '秒');
        blockquote.dataset.embedLoading = 'true';
        var hiddenBlockquotes = [];
        for (var i = 0; i < allBlockquotes.length; i++) {
            if (i !== currentIndex &&
                allBlockquotes[i].dataset.embedLoaded !== 'true' &&
                allBlockquotes[i].dataset.embedLoading !== 'true' &&
                allBlockquotes[i].classList.contains('text-post-media')) {
                hiddenBlockquotes.push(allBlockquotes[i]);
                allBlockquotes[i].classList.remove('text-post-media');
                allBlockquotes[i].classList.add('text-post-media-pending');
            }
        }
        
        function restoreHiddenBlockquotes() {
            for (var i = 0; i < hiddenBlockquotes.length; i++) {
                hiddenBlockquotes[i].classList.remove('text-post-media-pending');
                hiddenBlockquotes[i].classList.add('text-post-media');
            }
        }
        
        try {
            if (window.threadsEmbed && typeof window.threadsEmbed.process === 'function') {
                window.threadsEmbed.process();
            }
        } catch (e) {
            console.error('[錯誤] threadsEmbed.process 錯誤:', e);
        }
        
        waitForIframeLoad(blockquote, IFRAME_TIMEOUT)
            .then(function (success) {
                var loadTime = (Date.now() - itemStartTime) / 1000;
                stats.loadTimes.push(loadTime);
                blockquote.dataset.embedLoading = 'false';
                blockquote.dataset.embedLoaded = 'true';
                restoreHiddenBlockquotes();
                if (success) {
                    stats.loaded++;
                    consecutiveErrors = Math.max(0, consecutiveErrors - 1);
                    if (consecutiveErrors === 0 && currentDelay > LOAD_DELAY) {
                        currentDelay = Math.max(LOAD_DELAY, currentDelay * 0.95);
                    }
                    console.log('[成功] 載入成功 #' + stats.loaded + ' (耗時: ' + loadTime.toFixed(2) + '秒)');
                } else {
                    stats.failed++;
                    console.warn('[警告] 載入超時 #' + (currentIndex + 1));
                    var postItem = blockquote.closest('.post-item');
                    if (postItem) {
                        postItem.classList.add('error');
                        postItem.style.display = 'none';
                    }
                }
                removeLoadingIndicator(indicator);
                processing = false;
                currentIndex++;
                triggerRelayouts();
                if (currentIndex < allBlockquotes.length) {
                    setTimeout(processSingleEmbed, currentDelay);
                } else {
                    logStats();
                }
            })
            .catch(function (error) {
                console.error('[錯誤] 處理錯誤:', error);
                blockquote.dataset.embedLoading = 'false';
                stats.failed++;
                
                restoreHiddenBlockquotes();
                
                var postItem = blockquote.closest('.post-item');
                if (postItem) {
                    postItem.style.display = 'none';
                }
                
                removeLoadingIndicator(indicator);
                processing = false;
                currentIndex++;
                if (currentIndex < allBlockquotes.length) {
                    setTimeout(processSingleEmbed, currentDelay);
                } else {
                    logStats();
                }
            });
    }
    function init() {
        var container = document.getElementById('posts-container');
        if (!container) return;
        try {
            if (!Array.isArray(posts)) return;
        } catch (e) { return; }
        var frag = document.createDocumentFragment();
        for (var i = 0; i < posts.length; i++) {
            var item = document.createElement('div');
            item.className = 'post-item';
            item.innerHTML = posts[i];
            frag.appendChild(item);
        }
        container.appendChild(frag);
        if (typeof window.requestAnimationFrame === 'function') {
            requestAnimationFrame(function () {
                window.dispatchEvent(new Event('masonry:render-ready'));
            });
        } else {
            setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 0);
        }
        var blockquotes = container.querySelectorAll('blockquote.text-post-media');
        allBlockquotes = Array.prototype.slice.call(blockquotes);
        console.log('[資訊] 共找到 ' + allBlockquotes.length + ' 個 Threads 貼文');
        console.log('[資訊] 載入策略: 逐一載入,每個間隔 ' + (LOAD_DELAY / 1000) + ' 秒');
        if (allBlockquotes.length === 0) return;
        loadEmbedScript(function () {
            console.log('[開始] 開始載入貼文...');
            processSingleEmbed();
        });
    }
})();
