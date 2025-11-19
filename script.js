(function appScope(global) {
    'use strict';

    const App = {};

    // 通用工具
    const scheduleMicrotask = typeof queueMicrotask === 'function' ? queueMicrotask : cb => Promise.resolve().then(cb);

    function throttle(fn, wait = 100) {
        let last = 0;
        let timeout;
        return function(...args) {
            const now = Date.now();
            const remaining = wait - (now - last);
            if (remaining <= 0) {
                if (timeout) { clearTimeout(timeout); timeout = null; }
                last = now;
                fn.apply(this, args);
            } else if (!timeout) {
                timeout = setTimeout(() => {
                    last = Date.now();
                    timeout = null;
                    fn.apply(this, args);
                }, remaining);
            }
        };
    }

    function debounce(fn, wait = 100) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    // 主題切換
    (function(){
        const THEME_KEY = 'theme';
        App.getTheme = () => {
            const stored = localStorage.getItem(THEME_KEY);
            if (stored) return stored;
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
            return 'light';
        };
        App.setTheme = (t) => {
            document.body.setAttribute('data-theme', t);
            localStorage.setItem(THEME_KEY, t);
        };

        App.toggleTheme = () => {
            const current = App.getTheme();
            App.setTheme(current === 'dark' ? 'light' : 'dark');
            renderThemeToggle();
        };

        function renderThemeToggle() {
            let btn = document.querySelector('.theme-toggle');
            if (!btn) return;
            const t = App.getTheme();
            btn.setAttribute('aria-pressed', t === 'dark');
            btn.title = t === 'dark' ? '切換到淺色模式' : '切換到深色模式';
        }

        // lazy-create UI if missing
        App.ensureThemeToggle = function() {
            if (document.querySelector('.theme-toggle')) return;
            const btn = document.createElement('button');
            btn.className = 'theme-toggle';
            btn.setAttribute('aria-label', '切換主題');
            btn.setAttribute('aria-pressed', App.getTheme() === 'dark');
            btn.innerHTML = '☾';
            btn.addEventListener('click', App.toggleTheme);
            // 放在 header 右上角（若有 header），否則放到 body
            const header = document.querySelector('.header');
            (header || document.body).appendChild(btn);
            scheduleMicrotask(renderThemeToggle);
        };
    })();

    // 回到頂端
    (function(){
        App.initBackToTop = function () {
            let btn = document.querySelector('.back-to-top');
            if (!btn) {
                btn = document.createElement('button');
                btn.className = 'back-to-top';
                btn.setAttribute('aria-label', '返回頂部');
                btn.innerHTML = '↑';
                document.body.appendChild(btn);
            }
            const onScroll = throttle(() => {
                if (window.pageYOffset > 300) btn.classList.add('visible'); else btn.classList.remove('visible');
            }, 80);
            window.addEventListener('scroll', onScroll, { passive: true });
            btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
        };
    })();

    // 卡片顯示 + 互動: 使用事件代理，減少事件數量
    App.initCardInteractions = function() {
        const grid = document.querySelector('.grid');
        if (!grid) return;
        grid.addEventListener('click', function(e) {
            const card = e.target.closest('.card');
            if (!card) return;
            // ignore link clicks
            if (e.target.closest('a')) return;
            card.classList.add('pulse');
            setTimeout(() => card.classList.remove('pulse'), 300);
        });
    };

    // 滾動顯示動畫（IntersectionObserver）
    App.initScrollAnimation = function() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    // 如果希望只在第一次顯示取消觀察，可取代下面註解
                    // observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -48px 0px' });

        document.querySelectorAll('.card').forEach(card => observer.observe(card));
    };

    // Video autoplay tracking (Shadow DOM aware)
    (function(){
        const pendingVideoRoots = new Set();
        const trackedVideoRoots = new Set();
        const videoRootObservers = new Map();
        let videoAutoplayReady = false;

        function trackVideoRoot(root) {
            if (!root || trackedVideoRoots.has(root) || typeof root.querySelectorAll !== 'function') return;
            trackedVideoRoots.add(root);
            scanVideosInRoot(root);
            const observer = new MutationObserver(debounce(() => scanVideosInRoot(root), 100));
            observer.observe(root, { childList: true, subtree: true });
            videoRootObservers.set(root, observer);
        }

        function scanVideosInRoot(root) {
            if (!root || typeof root.querySelectorAll !== 'function') return;
            const videos = root.querySelectorAll('video');
            videos.forEach(setupVideo);
        }

        function tryPlayVideo(video) {
            if (!video) return;
            const promise = video.play();
            if (promise && typeof promise.then === 'function') {
                promise.catch(() => {});
            }
        }

        function setupVideo(video) {
            if (typeof HTMLVideoElement !== 'undefined' && !(video instanceof HTMLVideoElement)) return;
            if (video.dataset.autoplaySetup) return;
            video.dataset.autoplaySetup = 'true';
            video.muted = true; video.defaultMuted = true; video.autoplay = true; video.playsInline = true; video.loop = true;
            ['pointerdown','touchstart','click'].forEach(evt => video.addEventListener(evt, () => tryPlayVideo(video), { once: true }));
            if (video.readyState >= 2) tryPlayVideo(video); else video.addEventListener('loadeddata', () => tryPlayVideo(video), { once: true });
        }

        // Hook Shadow DOM attach
        if (typeof Element !== 'undefined' && Element.prototype.attachShadow) {
            const original = Element.prototype.attachShadow;
            Element.prototype.attachShadow = function(init) {
                const sr = original.call(this, init);
                const isOpen = !init || init.mode === 'open';
                if (isOpen) scheduleMicrotask(() => videoAutoplayReady ? trackVideoRoot(sr) : pendingVideoRoots.add(sr));
                return sr;
            };
        }

        App.initVideoAutoplay = function() {
            if (videoAutoplayReady) return;
            videoAutoplayReady = true;
            trackVideoRoot(document);
            if (pendingVideoRoots.size) { pendingVideoRoots.forEach(r => trackVideoRoot(r)); pendingVideoRoots.clear(); }
            setInterval(() => trackedVideoRoots.forEach(scanVideosInRoot), 2_000);
        };
    })();

    // 載入 Threads embed script
    App.loadThreadsEmbed = function() {
        const selector = 'script[src="https://www.threads.com/embed.js"]';
        if (!document.querySelector(selector)) {
            const tag = document.createElement('script');
            tag.src = 'https://www.threads.com/embed.js';
            tag.async = true;
            tag.onload = () => setTimeout(App.initVideoAutoplay, 800);
            document.body.appendChild(tag);
        } else {
            App.initVideoAutoplay();
        }
    };

    // 效能/統計
    App.countLoadedCards = function() {
        const count = document.querySelectorAll('.card').length;
        console.log('載入卡片數：', count);
        return count;
    };

    App.logPerformance = function() {
        if (!window.performance || !window.performance.timing) return;
        const p = window.performance.timing; const t = p.loadEventEnd - p.navigationStart; console.log('頁面載入時間:', t, 'ms');
    };

    // 初始化入口
    document.addEventListener('DOMContentLoaded', function() {
        App.setTheme(App.getTheme());
        App.ensureThemeToggle();
        App.initBackToTop();
        App.initCardInteractions();
        App.initScrollAnimation();
        App.loadThreadsEmbed();
    });

    // Window load hooks
    window.addEventListener('load', () => {
        setTimeout(() => { App.logPerformance(); App.countLoadedCards(); }, 120);
    });

    // Export functions for testing if needed
    if (typeof module !== 'undefined' && module.exports) { module.exports = App; }
    global.App = App;
})(this);
