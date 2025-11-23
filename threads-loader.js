(function () {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    var embedScriptLoaded = false;
    var pendingEmbeds = [];
    var processing = false;
    var currentDelay = LOAD_DELAY;
    var rateLimitDetected = false;
    var stats = {
        total: 0,
        loaded: 0,
        failed: 0,
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
            成功率: ((stats.loaded / stats.total) * 100).toFixed(1) + '%',
            耗時: ((Date.now() - stats.startTime) / 1000).toFixed(1) + '秒',
            當前延遲: (currentDelay / 1000).toFixed(1) + '秒',
            平均載入時間: avgLoadTime + '秒'
        });
    }
    window.addEventListener('error', function (e) {
        if (e.message && (e.message.includes('429') || e.message.includes('rate limit'))) {
            rateLimitDetected = true;
            currentDelay = Math.min(currentDelay * 2, 30000);
            console.warn('[警告] 偵測到速率限制,延遲時間調整為 ' + (currentDelay / 1000) + ' 秒');
            setTimeout(function () {
                rateLimitDetected = false;
                currentDelay = LOAD_DELAY;
                console.log('[成功] 速率限制解除,恢復正常延遲');
            }, 600000);
        }
    }, true);
    (function () {
        var originalFetch = window.fetch;
        if (originalFetch) {
            window.fetch = function () {
                return originalFetch.apply(this, arguments).catch(function (error) {
                    if (error.message && error.message.includes('429')) {
                        rateLimitDetected = true;
                        currentDelay = Math.min(currentDelay * 2, 30000);
                        console.error('[錯誤] 偵測到 429 錯誤,暫停載入並增加延遲至 ' + (currentDelay / 1000) + ' 秒');
                        processing = false;
                        setTimeout(function () {
                            console.log('[重試] 重新開始載入...');
                            rateLimitDetected = false;
                            currentDelay = LOAD_DELAY;
                            processNextEmbed();
                        }, 600000);
                    }
                    throw error;
                });
            };
        }
    })();
    function loadEmbedScript(callback) {
        if (embedScriptLoaded) {
            if (callback) callback();
            return;
        }

        if (window.threadsEmbed && typeof window.threadsEmbed.process === 'function') {
            embedScriptLoaded = true;
            console.log('[資訊] Threads embed script 已存在(快取)');
            if (callback) callback();
            return;
        }

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
                        document.body.removeChild(script);
                        attemptLoad();
                    }, Math.pow(2, retryCount) * 1000);
                } else {
                    console.error('[錯誤] Threads embed script 載入失敗,已達最大重試次數');
                    stats.failed++;
                }
            };
            script.onload = function () {
                embedScriptLoaded = true;
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
    function waitForIframeLoad(blockquote) {
        return new Promise(function (resolve) {
            var timeout, observer;
            function cleanup() {
                if (timeout) clearTimeout(timeout);
                if (observer) observer.disconnect();
            }
            function triggerRelayouts() {
                window.dispatchEvent(new Event('masonry:render-ready'));
                setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 100);
                setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 300);
                setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 600);
                setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 1000);
                setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 1500);
                setTimeout(function () { window.dispatchEvent(new Event('masonry:render-ready')); }, 2500);
            }
            timeout = setTimeout(function () {
                console.warn('[警告] iframe 載入超時');
                cleanup();
                resolve(false);
            }, IFRAME_TIMEOUT);
            if (!('MutationObserver' in window)) {
                cleanup();
                setTimeout(function () {
                    triggerRelayouts();
                    resolve(true);
                }, 2000);
                return;
            }
            observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    mutation.addedNodes.forEach(function (node) {
                        if (node.tagName === 'IFRAME') {
                            node.addEventListener('load', function () {
                                cleanup();
                                triggerRelayouts();
                                resolve(true);
                            }, { once: true });
                            if (node.contentWindow) {
                                try {
                                    if (node.contentWindow.document.readyState === 'complete') {
                                        cleanup();
                                        triggerRelayouts();
                                        resolve(true);
                                    }
                                } catch (e) {
                                    cleanup();
                                    triggerRelayouts();
                                    resolve(true);
                                }
                            }
                        }
                    });
                });
            });
            observer.observe(blockquote.parentNode, {
                childList: true,
                subtree: true
            });
        });
    }
    function processNextEmbed() {
        if (processing || pendingEmbeds.length === 0) return;
        processing = true;
        var blockquote = pendingEmbeds.shift();
        var indicator = addLoadingIndicator(blockquote);
        stats.total++;
        var itemStartTime = Date.now();
        var remaining = pendingEmbeds.length;
        console.log('[載入] 載入中 (' + stats.total + '/' + (stats.total + remaining) + ')');
        try {
            if (window.threadsEmbed && typeof window.threadsEmbed.process === 'function') {
                window.threadsEmbed.process();
                waitForIframeLoad(blockquote)
                    .then(function (success) {
                        var loadTime = (Date.now() - itemStartTime) / 1000;
                        stats.loadTimes.push(loadTime);
                        if (success) {
                            stats.loaded++;
                            console.log('[成功] 載入成功 #' + stats.loaded + ' (耗時: ' + loadTime.toFixed(2) + '秒)');
                        } else {
                            stats.failed++;
                            var postItem = blockquote.closest('.post-item');
                            if (postItem) {
                                postItem.classList.add('error');
                            }
                        }
                        removeLoadingIndicator(indicator);
                        processing = false;
                        window.dispatchEvent(new Event('masonry:render-ready'));
                        if (pendingEmbeds.length > 0) {
                            setTimeout(processNextEmbed, currentDelay);
                        } else {
                            logStats();
                        }
                    })
                    .catch(function (error) {
                        console.error('[錯誤] Promise 錯誤:', error);
                        stats.failed++;
                        removeLoadingIndicator(indicator);
                        processing = false;
                        if (pendingEmbeds.length > 0) {
                            setTimeout(processNextEmbed, currentDelay);
                        } else {
                            logStats();
                        }
                    });
                return;
            }
        } catch (e) {
            console.error('[錯誤] 處理錯誤:', e);
            stats.failed++;
        }
        removeLoadingIndicator(indicator);
        processing = false;
        if (pendingEmbeds.length > 0) {
            setTimeout(processNextEmbed, currentDelay);
        } else {
            logStats();
        }
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
        console.log('[資訊] 共找到 ' + blockquotes.length + ' 個 Threads 貼文');

        if ('IntersectionObserver' in window) {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting && !entry.target.dataset.processed) {
                        entry.target.dataset.processed = 'true';

                        var priority = entry.intersectionRatio > 0.5 ? 'high' : 'low';
                        entry.target.dataset.priority = priority;

                        if (priority === 'high') {
                            pendingEmbeds.unshift(entry.target);
                            console.log('[載入] 高優先級貼文 (可見度: ' + (entry.intersectionRatio * 100).toFixed(0) + '%)');
                        } else {
                            pendingEmbeds.push(entry.target);
                        }

                        observer.unobserve(entry.target);

                        if (!embedScriptLoaded) {
                            loadEmbedScript(processNextEmbed);
                        } else {
                            processNextEmbed();
                        }
                    }
                });
            }, {
                rootMargin: '200px',
                threshold: [0.1, 0.5]
            });

            for (var j = 0; j < blockquotes.length; j++) {
                observer.observe(blockquotes[j]);
            }
        } else {
            console.log('[警告] 不支援 Intersection Observer,使用降級方案');
            loadEmbedScript(function () {
                var index = 0;
                function processBatch() {
                    if (index >= blockquotes.length) {
                        logStats();
                        return;
                    }

                    var endIdx = Math.min(index + BATCH_SIZE, blockquotes.length);
                    console.log('[批次] 批次載入中 (' + (index + 1) + '-' + endIdx + '/' + blockquotes.length + ')');

                    for (var k = index; k < endIdx; k++) {
                        blockquotes[k].dataset.processed = 'true';
                        stats.total++;
                    }

                    try {
                        if (window.threadsEmbed && typeof window.threadsEmbed.process === 'function') {
                            window.threadsEmbed.process();
                            stats.loaded += (endIdx - index);
                            console.log('[完成] 批次載入成功');
                        }
                    } catch (e) {
                        console.error('[錯誤] 批次處理時發生錯誤:', e);
                        stats.failed += (endIdx - index);
                    }

                    window.dispatchEvent(new Event('masonry:render-ready'));

                    index = endIdx;
                    if (index < blockquotes.length) {
                        setTimeout(processBatch, currentDelay);
                    } else {
                        logStats();
                    }
                }
                processBatch();
            });
        }
    }
})();
