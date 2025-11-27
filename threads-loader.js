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
    var visibleQueue = [];
    var observer = null;
    var lazyLoadEnabled = true;
    var stats = {
        total: 0,
        loaded: 0,
        failed: 0,
        rateLimitHits: 0,
        startTime: Date.now(),
        loadTimes: []
    };
    var ALLOWED_THREADS_HOSTS = ['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'];
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
        if (e.target && e.target.tagName === 'SCRIPT' && e.target.src && isHostAllowed(e.target.src, ALLOWED_THREADS_HOSTS)) {
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
    function setupIntersectionObserver() {
        if (!('IntersectionObserver' in window)) {
            console.warn('[警告] 瀏覽器不支援 IntersectionObserver，改用傳統載入方式');
            lazyLoadEnabled = false;
            return null;
        }
        var options = {
            root: null,
            rootMargin: '200px 0px',
            threshold: 0.01
        };
        observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                var postItem = entry.target;
                var blockquote = postItem.querySelector('blockquote.text-post-media');
                if (!blockquote) return;
                if (entry.isIntersecting) {
                    if (blockquote.dataset.embedLoaded !== 'true' &&
                        blockquote.dataset.embedLoading !== 'true' &&
                        blockquote.dataset.inQueue !== 'true') {
                        blockquote.dataset.inQueue = 'true';
                        visibleQueue.push(blockquote);
                        console.log('[Lazy] 貼文進入視窗，加入佇列 (佇列長度: ' + visibleQueue.length + ')');
                        if (!processing && !paused && !rateLimitDetected) {
                            processVisibleQueue();
                        }
                    }
                }
            });
        }, options);
        return observer;
    }
    function processVisibleQueue() {
        if (processing || paused || rateLimitDetected) {
            return;
        }
        while (visibleQueue.length > 0) {
            var blockquote = visibleQueue[0];
            if (blockquote.dataset.embedLoaded === 'true' ||
                blockquote.dataset.embedLoading === 'true') {
                visibleQueue.shift();
                continue;
            }
            break;
        }
        if (visibleQueue.length === 0) {
            console.log('[Lazy] 佇列已清空');
            return;
        }
        var now = Date.now();
        var timeSinceLastRequest = now - lastRequestTime;
        var minDelay = typeof MIN_DELAY_BETWEEN_REQUESTS !== 'undefined' ? MIN_DELAY_BETWEEN_REQUESTS : 2000;
        if (lastRequestTime > 0 && timeSinceLastRequest < minDelay) {
            setTimeout(processVisibleQueue, minDelay - timeSinceLastRequest);
            return;
        }
        var blockquote = visibleQueue.shift();
        processBlockquote(blockquote);
    }

    function processBlockquote(blockquote) {
        processing = true;
        lastRequestTime = Date.now();
        var indicator = addLoadingIndicator(blockquote);
        stats.total++;

        var itemStartTime = Date.now();
        var processStart = performance.now();
        var loadedCount = document.querySelectorAll('blockquote[data-embed-loaded="true"]').length;

        console.log('[載入] 載入中 (' + (loadedCount + 1) + '/' + allBlockquotes.length + ') - 延遲: ' + (currentDelay / 1000) + '秒');

        blockquote.dataset.embedLoading = 'true';

        var container = document.getElementById('posts-container');
        if (container) container.classList.add('is-loading');

        var postItem = blockquote.closest('.post-item');
        if (postItem) postItem.classList.add('current-loading');

        scheduleIdle(function () {
            try {
                if (window.threadsEmbed && typeof window.threadsEmbed.process === 'function') {
                    window.threadsEmbed.process();
                }
            } catch (e) {
                console.error('[錯誤] threadsEmbed.process 錯誤:', e);
            }
        });

        function restoreState() {
            var container = document.getElementById('posts-container');
            if (container) container.classList.remove('is-loading');
            var postItem = blockquote.closest('.post-item');
            if (postItem) postItem.classList.remove('current-loading');
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
                    consecutiveErrors = Math.max(0, consecutiveErrors - 1);

                    if (consecutiveErrors === 0 && currentDelay > LOAD_DELAY) {
                        currentDelay = Math.max(LOAD_DELAY, currentDelay * 0.9);
                    }

                    console.log('[成功] 載入成功 #' + stats.loaded + ' (耗時: ' + loadTime.toFixed(2) + '秒)');
                } else {
                    stats.failed++;
                    consecutiveErrors++;

                    if (consecutiveErrors >= 2) {
                        currentDelay = Math.min(currentDelay * 1.3, MAX_DELAY);
                        console.warn('[警告] 連續超時，延遲增加到 ' + (currentDelay / 1000).toFixed(1) + ' 秒');
                    }

                    console.warn('[警告] 載入超時');

                    if (postItem) {
                        postItem.classList.add('error');
                        postItem.style.display = 'none';
                    }
                }

                removeLoadingIndicator(indicator);
                processing = false;

                var processElapsed = performance.now() - processStart;
                if (processElapsed > 150) {
                    console.warn('[性能] processBlockquote took ' + processElapsed.toFixed(1) + 'ms');
                }

                if (visibleQueue.length > 0) {
                    setTimeout(processVisibleQueue, currentDelay);
                } else {

                    if (stats.total > 0 && stats.loaded + stats.failed === stats.total) {
                        logStats();
                    }
                }
            })
            .catch(function (error) {
                console.error('[錯誤] 處理錯誤:', error);

                blockquote.dataset.embedLoading = 'false';
                blockquote.dataset.inQueue = 'false';
                stats.failed++;

                restoreState();

                var postItem = blockquote.closest('.post-item');
                if (postItem) {
                    postItem.style.display = 'none';
                }

                removeLoadingIndicator(indicator);
                processing = false;


                if (visibleQueue.length > 0) {
                    setTimeout(processVisibleQueue, currentDelay);
                }
            });
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
        var processStart = performance.now();
        console.log('[載入] 載入中 (' + (currentIndex + 1) + '/' + allBlockquotes.length + ') - 延遲: ' + (currentDelay / 1000) + '秒');
        blockquote.dataset.embedLoading = 'true';
        var hiddenBlockquotes = [];
        var container = document.getElementById('posts-container');
        if (container) container.classList.add('is-loading');
        var postItem = blockquote.closest('.post-item');
        if (postItem) postItem.classList.add('current-loading');
        scheduleIdle(function () {
            try {
                if (window.threadsEmbed && typeof window.threadsEmbed.process === 'function') {
                    window.threadsEmbed.process();
                }
            } catch (e) {
                console.error('[錯誤] threadsEmbed.process 錯誤:', e);
            }
        });
        function restoreHiddenBlockquotes() {
            var container = document.getElementById('posts-container');
            if (container) container.classList.remove('is-loading');
            var postItem = blockquote.closest('.post-item');
            if (postItem) postItem.classList.remove('current-loading');
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
                        currentDelay = Math.max(LOAD_DELAY, currentDelay * 0.9);
                    }
                    console.log('[成功] 載入成功 #' + stats.loaded + ' (耗時: ' + loadTime.toFixed(2) + '秒)');
                } else {
                    stats.failed++;
                    consecutiveErrors++;
                    if (consecutiveErrors >= 2) {
                        currentDelay = Math.min(currentDelay * 1.3, MAX_DELAY);
                        console.warn('[警告] 連續超時，延遲增加到 ' + (currentDelay / 1000).toFixed(1) + ' 秒');
                    }
                    console.warn('[警告] 載入超時 #' + (currentIndex + 1));
                    var postItem = blockquote.closest('.post-item');
                    if (postItem) {
                        postItem.classList.add('error');
                        postItem.style.display = 'none';
                    }
                }
                removeLoadingIndicator(indicator);
                processing = false;
                var processElapsed = performance.now() - processStart;
                if (processElapsed > 150) console.warn('[性能] processSingleEmbed total took ' + processElapsed.toFixed(1) + 'ms');
                currentIndex++;
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
                var processElapsed = performance.now() - processStart;
                if (processElapsed > 150) console.warn('[性能] processSingleEmbed total took ' + processElapsed.toFixed(1) + 'ms');
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
        var CHUNK_APPEND_SIZE = 20;
        function appendPostsInChunks(done) {
            if (!posts || posts.length === 0) return done();
            if (posts.length <= CHUNK_APPEND_SIZE) {
                var frag = document.createDocumentFragment();
                for (var i = 0; i < posts.length; i++) {
                    var item = document.createElement('div');
                    item.className = 'post-item';
                    item.innerHTML = posts[i];
                    frag.appendChild(item);
                }
                container.appendChild(frag);
                return done();
            }
            var idx = 0;
            function loop() {
                var start = performance.now();
                var frag = document.createDocumentFragment();
                var end = Math.min(idx + CHUNK_APPEND_SIZE, posts.length);
                for (; idx < end; idx++) {
                    var item = document.createElement('div');
                    item.className = 'post-item';
                    item.innerHTML = posts[idx];
                    frag.appendChild(item);
                }
                container.appendChild(frag);
                var elapsed = performance.now() - start;
                if (idx < posts.length) {
                    if (elapsed > 30) scheduleIdle(loop); else loop();
                } else {
                    done();
                }
            }
            loop();
        }
        appendPostsInChunks(function () {
            if (typeof window.requestAnimationFrame === 'function') {
                requestAnimationFrame(function () {
                });
            } else {
                setTimeout(function () { }, 0);
            }
            var blockquotes = container.querySelectorAll('blockquote.text-post-media');
            allBlockquotes = Array.prototype.slice.call(blockquotes);
            console.log('[資訊] 共找到 ' + allBlockquotes.length + ' 個 Threads 貼文');

            if (allBlockquotes.length === 0) return;

            loadEmbedScript(function () {
                console.log('[開始] 開始載入貼文...');

                // 嘗試啟用 lazy loading
                if (lazyLoadEnabled) {
                    setupIntersectionObserver();
                }

                if (lazyLoadEnabled && observer) {
                    // 使用 Lazy Loading 模式
                    console.log('[資訊] 載入策略: Lazy Loading (僅載入可見貼文)');
                    console.log('[資訊] 視窗預載範圍: 200px');

                    // 觀察所有 post-item 元素
                    var postItems = container.querySelectorAll('.post-item');
                    postItems.forEach(function (item) {
                        observer.observe(item);
                    });

                    console.log('[Lazy] 已開始監控 ' + postItems.length + ' 個貼文元素');
                } else {
                    // Fallback: 使用傳統逐一載入模式
                    console.log('[資訊] 載入策略: 逐一載入,每個間隔 ' + (LOAD_DELAY / 1000) + ' 秒');
                    processSingleEmbed();
                }
            });
        });
    }
})();